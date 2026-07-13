#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <mmdeviceapi.h>
#include <wrl.h>
#include <wrl/implements.h>

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cwchar>
#include <fcntl.h>
#include <io.h>
#include <limits>
#include <utility>
#include <vector>

using Microsoft::WRL::ClassicCom;
using Microsoft::WRL::ComPtr;
using Microsoft::WRL::FtmBase;
using Microsoft::WRL::Make;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;

namespace {

constexpr DWORD kActivationTimeoutMs = 15'000;
constexpr WORD kOutputChannels = 2;
constexpr DWORD kOutputSampleRate = 48'000;

class ActivationHandler final
    : public RuntimeClass<
          RuntimeClassFlags<ClassicCom>,
          FtmBase,
          IActivateAudioInterfaceCompletionHandler> {
 public:
  ActivationHandler() : completed_(CreateEventW(nullptr, FALSE, FALSE, nullptr)) {}

  ~ActivationHandler() override {
    if (completed_) CloseHandle(completed_);
  }

  STDMETHODIMP ActivateCompleted(
      IActivateAudioInterfaceAsyncOperation* operation) override {
    HRESULT activationResult = E_UNEXPECTED;
    ComPtr<IUnknown> activatedInterface;
    result_ = operation->GetActivateResult(
        &activationResult,
        &activatedInterface);
    if (SUCCEEDED(result_)) result_ = activationResult;
    if (SUCCEEDED(result_)) result_ = activatedInterface.As(&audioClient_);
    SetEvent(completed_);
    return S_OK;
  }

  HANDLE completed() const { return completed_; }
  HRESULT result() const { return result_; }
  IAudioClient* audioClient() const { return audioClient_.Get(); }

 private:
  HANDLE completed_ = nullptr;
  HRESULT result_ = E_PENDING;
  ComPtr<IAudioClient> audioClient_;
};

void ReportError(const char* message, HRESULT result = S_OK) {
  if (FAILED(result)) {
    std::fprintf(
        stderr,
        "ERROR:%s (HRESULT 0x%08lX)\n",
        message,
        static_cast<unsigned long>(result));
  } else {
    std::fprintf(stderr, "ERROR:%s\n", message);
  }
  std::fflush(stderr);
}

bool WriteFrame(const std::vector<float>& samples) {
  const std::size_t byteCount = samples.size() * sizeof(float);
  if (byteCount > std::numeric_limits<std::uint32_t>::max()) return false;
  const auto length = static_cast<std::uint32_t>(byteCount);
  return std::fwrite(&length, sizeof(length), 1, stdout) == 1 &&
         (samples.empty() ||
          std::fwrite(samples.data(), sizeof(float), samples.size(), stdout) ==
              samples.size());
}

bool ParseWindowId(int argc, wchar_t** argv, std::uintptr_t* windowId) {
  bool typeIsWindow = false;
  const wchar_t* idText = nullptr;
  for (int index = 1; index + 1 < argc; ++index) {
    if (std::wcscmp(argv[index], L"--type") == 0) {
      typeIsWindow = std::wcscmp(argv[index + 1], L"window") == 0;
    } else if (std::wcscmp(argv[index], L"--id") == 0) {
      idText = argv[index + 1];
    }
  }
  if (!typeIsWindow || !idText) return false;

  wchar_t* end = nullptr;
  const unsigned long long value = std::wcstoull(idText, &end, 10);
  if (value == 0 || !end || *end != L'\0' ||
      value > std::numeric_limits<std::uintptr_t>::max()) {
    return false;
  }
  *windowId = static_cast<std::uintptr_t>(value);
  return true;
}

HRESULT ActivateProcessLoopback(
    DWORD processId,
    ComPtr<ActivationHandler>* handlerOut) {
  AUDIOCLIENT_ACTIVATION_PARAMS activationParams{};
  activationParams.ActivationType =
      AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  activationParams.ProcessLoopbackParams.TargetProcessId = processId;
  activationParams.ProcessLoopbackParams.ProcessLoopbackMode =
      PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;

  PROPVARIANT parameters{};
  parameters.vt = VT_BLOB;
  parameters.blob.cbSize = sizeof(activationParams);
  parameters.blob.pBlobData =
      reinterpret_cast<BYTE*>(&activationParams);

  auto handler = Make<ActivationHandler>();
  if (!handler || !handler->completed()) return E_OUTOFMEMORY;

  ComPtr<IActivateAudioInterfaceAsyncOperation> operation;
  HRESULT result = ActivateAudioInterfaceAsync(
      VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
      __uuidof(IAudioClient),
      &parameters,
      handler.Get(),
      &operation);
  if (FAILED(result)) return result;

  const DWORD waitResult =
      WaitForSingleObject(handler->completed(), kActivationTimeoutMs);
  if (waitResult == WAIT_TIMEOUT) return HRESULT_FROM_WIN32(WAIT_TIMEOUT);
  if (waitResult != WAIT_OBJECT_0) return HRESULT_FROM_WIN32(GetLastError());
  if (FAILED(handler->result())) return handler->result();

  *handlerOut = std::move(handler);
  return S_OK;
}

HRESULT CaptureProcessAudio(DWORD processId) {
  ComPtr<ActivationHandler> activation;
  HRESULT result = ActivateProcessLoopback(processId, &activation);
  if (FAILED(result)) return result;

  WAVEFORMATEX format{};
  format.wFormatTag = WAVE_FORMAT_PCM;
  format.nChannels = kOutputChannels;
  format.nSamplesPerSec = kOutputSampleRate;
  format.wBitsPerSample = 16;
  format.nBlockAlign =
      format.nChannels * format.wBitsPerSample / 8;
  format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;

  const DWORD streamFlags =
      AUDCLNT_STREAMFLAGS_LOOPBACK |
      AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
      AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM |
      AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
  result = activation->audioClient()->Initialize(
      AUDCLNT_SHAREMODE_SHARED,
      streamFlags,
      0,
      0,
      &format,
      nullptr);
  if (FAILED(result)) return result;

  ComPtr<IAudioCaptureClient> captureClient;
  result = activation->audioClient()->GetService(IID_PPV_ARGS(&captureClient));
  if (FAILED(result)) return result;

  HANDLE sampleReady = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (!sampleReady) return HRESULT_FROM_WIN32(GetLastError());
  result = activation->audioClient()->SetEventHandle(sampleReady);
  if (FAILED(result)) {
    CloseHandle(sampleReady);
    return result;
  }

  result = activation->audioClient()->Start();
  if (FAILED(result)) {
    CloseHandle(sampleReady);
    return result;
  }

  std::fprintf(stderr, "READY\n");
  std::fflush(stderr);

  bool outputOpen = true;
  while (outputOpen) {
    const DWORD waitResult = WaitForSingleObject(sampleReady, 1'000);
    if (waitResult == WAIT_TIMEOUT) continue;
    if (waitResult != WAIT_OBJECT_0) {
      result = HRESULT_FROM_WIN32(GetLastError());
      break;
    }

    UINT32 packetFrames = 0;
    result = captureClient->GetNextPacketSize(&packetFrames);
    while (SUCCEEDED(result) && packetFrames > 0) {
      BYTE* bytes = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      result = captureClient->GetBuffer(
          &bytes,
          &frames,
          &flags,
          nullptr,
          nullptr);
      if (FAILED(result)) break;

      std::vector<float> samples(
          static_cast<std::size_t>(frames) * kOutputChannels,
          0.0f);
      if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) == 0 && bytes) {
        const auto* pcm = reinterpret_cast<const std::int16_t*>(bytes);
        std::transform(
            pcm,
            pcm + samples.size(),
            samples.begin(),
            [](std::int16_t sample) {
              return static_cast<float>(sample) / 32768.0f;
            });
      }

      outputOpen = WriteFrame(samples);
      const HRESULT releaseResult = captureClient->ReleaseBuffer(frames);
      if (FAILED(releaseResult)) {
        result = releaseResult;
        break;
      }
      if (!outputOpen) break;
      result = captureClient->GetNextPacketSize(&packetFrames);
    }
  }

  activation->audioClient()->Stop();
  CloseHandle(sampleReady);
  return outputOpen ? result : S_OK;
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  _setmode(_fileno(stdout), _O_BINARY);
  setvbuf(stdout, nullptr, _IONBF, 0);

  std::uintptr_t windowId = 0;
  if (!ParseWindowId(argc, argv, &windowId)) {
    ReportError("Usage: --type window --id <HWND>");
    return 1;
  }

  const HWND window = reinterpret_cast<HWND>(windowId);
  if (!IsWindow(window)) {
    ReportError("The selected window is no longer available.");
    return 1;
  }

  DWORD processId = 0;
  GetWindowThreadProcessId(window, &processId);
  if (processId == 0) {
    ReportError("Unable to resolve the selected window process.");
    return 1;
  }

  const HRESULT comResult = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(comResult)) {
    ReportError("Unable to initialize Windows audio capture.", comResult);
    return 1;
  }

  const HRESULT captureResult = CaptureProcessAudio(processId);
  CoUninitialize();
  if (FAILED(captureResult)) {
    ReportError(
        "Selected-application audio capture requires Windows 10 build 20348 or newer and an active audio session.",
        captureResult);
    return 2;
  }
  return 0;
}
