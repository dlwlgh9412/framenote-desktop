# Meeting Capture

Google Meet, Zoom 같은 화상회의와 일반 화면 작업을 저장하는 macOS/Windows 데스크톱 녹화 앱입니다. 화면 또는 창, 시스템 오디오, 마이크를 한 번에 녹화하고 장시간 녹화에서도 메모리가 계속 늘지 않도록 데이터를 즉시 디스크로 기록합니다.

## 주요 기능

- 전체 화면 또는 앱 창 선택과 실시간 미리보기
- 회의 모드: 시스템 오디오 + 소음 억제 마이크가 기본값
- 화면 모드: 화면 + 시스템 오디오가 기본값
- 자동 코덱: MP4(H.264/AAC) → WebM(VP9/Opus) → WebM(VP8/Opus) 순서로 현재 OS가 지원하는 형식 선택
- 효율(720p), 균형(1080p), 고화질(1440p), 부드럽게(1080p 60fps) 프리셋
- 녹화 일시정지/재개, 저장 폴더 선택, 완료 파일 바로 보기
- macOS 화면/마이크 권한 상태와 설정 바로가기
- macOS Intel/Apple Silicon 및 Windows x64/ARM64 패키징

## 빠른 시작

Node.js 24 이상을 권장합니다.

```bash
npm install
npm run dev
```

프로덕션 코드와 테스트를 확인하려면:

```bash
npm run build
```

설치 파일은 각 운영체제에서 빌드하는 것이 가장 안정적입니다.

```bash
# macOS: 범용 DMG + ZIP (Intel + Apple Silicon)
npm run package:mac

# Windows: NSIS 설치 프로그램 (x64, ARM64)
npm run package:win
```

태그를 푸시하거나 GitHub Actions의 `Build desktop installers` 워크플로를 수동 실행하면 macOS와 Windows 러너가 각각 설치 파일을 만듭니다. 배포용 macOS 앱은 Developer ID 서명과 공증, Windows 앱은 코드 서명을 별도로 구성해야 합니다.

## 첫 실행 권한

### macOS

1. DMG에서 Meeting Capture를 실행하고 `응용 프로그램으로 이동`을 누릅니다. 앱이 설치된 위치에서 자동으로 다시 실행됩니다.
2. 시스템 설정 → 개인정보 보호 및 보안 → 화면 및 시스템 오디오 기록에서 Meeting Capture를 허용합니다.
3. 마이크 녹음을 사용한다면 마이크 권한도 허용합니다.
4. 권한을 바꾼 후 앱을 완전히 종료하고 다시 실행합니다.

macOS 14.2 이상에서는 첫 시스템 오디오 녹화 때 별도의 오디오 캡처 권한 창이 나타납니다. 앱 설정의 `macOS 권한 → 시스템 오디오`에서 해당 설정 화면을 다시 열 수 있습니다.

macOS 13 이상을 주 지원합니다. 12.7.6 이하는 Apple API 제약 때문에 BlackHole 같은 가상 오디오 장치 없이 시스템 오디오를 가져올 수 없습니다. macOS 14.2 이상용 `NSAudioCaptureUsageDescription`도 패키지에 포함되어 있습니다.

### Windows

Windows 10 이상을 지원합니다. 시스템 오디오에는 Electron/Chromium의 loopback 캡처를 사용합니다. Windows 설정에서 데스크톱 앱의 마이크 접근이 꺼져 있으면 켜야 합니다.

## 성능과 메모리 설계

- 캡처와 MediaRecorder 인코딩은 Chromium의 미디어 스레드와 가능한 경우 하드웨어 가속을 사용합니다.
- React UI와 비동기 파일 기록은 renderer/main 프로세스로 분리했습니다.
- 녹화는 1초 청크로 기록하고 전체 파일 Blob을 메모리에 보관하지 않습니다.
- 파일 기록 대기량이 32MB를 넘으면 내용을 조용히 누락하지 않도록 녹화를 종료하고 현재까지의 데이터를 안전하게 마무리한 뒤 사용자에게 알립니다.
- 파일을 기록하는 동안 디스플레이 절전을 방지해 장시간 회의가 끊기지 않게 합니다.

상세 구조는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), 요구사항은 [docs/SPEC.md](docs/SPEC.md)를 참고하세요.

## 알려진 제약

- DRM 보호 영상, 회사 관리 정책, 일부 보안 앱은 화면 또는 오디오 캡처를 막을 수 있습니다.
- MP4 MediaRecorder 지원 여부는 운영체제의 Chromium 미디어 기능에 따라 달라집니다. 미지원 장치에서는 자동으로 WebM을 사용합니다.
- 서명하지 않았거나 ad-hoc 서명한 macOS 개발 빌드는 앱을 다시 빌드하면 권한을 다시 물을 수 있습니다. 공개 배포 빌드는 고정된 번들 ID와 Developer ID로 서명하고 공증해야 합니다.

## 품질 확인

```bash
npm run typecheck
npm test
npm run build
```
