import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  ChevronDown,
  FolderOpen,
  Gauge,
  LayoutGrid,
  Mic2,
  Monitor,
  MonitorUp,
  MoreHorizontal,
  Pause,
  Play,
  RefreshCw,
  Settings,
  Sparkles,
  Square,
  Volume2
} from 'lucide-react'
import appIconUrl from './app-icon.png'
import { APP_NAME } from '../../shared/brand'
import {
  createDefaultPreferences,
  type AppPreferences,
  type CaptureMode,
  type CaptureSource,
  type PermissionSnapshot
} from '../../shared/contracts'
import {
  audioModePatch,
  getAudioCaptureMode,
  type AudioCaptureMode
} from '../../shared/audio-capture'
import {
  getCompatibleCodecs,
  getEncodingPreview,
  QUALITY_PRESETS,
  type CodecPreference,
  type CountdownSeconds,
  type QualityPresetId,
  type RecordingFormatPreference,
  type StorageModeId
} from '../../shared/recording-settings'
import {
  canStopRecorder,
  controlsAreLocked,
  initialRecorderState,
  isRecorderActive,
  RECORDER_STATUS_LABELS,
  transitionRecorder
} from '../../shared/recorder-machine'
import { SettingsModal } from './components/SettingsModal'
import { formatEstimatedSize } from './lib/formatting'
import {
  shouldClearSourcesForPermissionChange,
  shouldRefreshSourcesForPermissionChange
} from './lib/permission-refresh'
import { normalizeError, RecordingController } from './lib/recording-controller'
import { startRecordingWithPreview } from './lib/recording-start'
import { LivePreviewController } from './lib/live-preview'
import { SingleFlight } from './lib/single-flight'

const placeholderPreferences: AppPreferences = createDefaultPreferences('불러오는 중…')

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return [hours, minutes, remainder].map((part) => String(part).padStart(2, '0')).join(':')
}

function sourceType(source: CaptureSource): string {
  return source.type === 'screen' ? '전체 화면' : '창'
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

export default function App(): React.JSX.Element {
  const [preferences, setPreferences] = useState(placeholderPreferences)
  const [sources, setSources] = useState<CaptureSource[]>([])
  const [sourceTab, setSourceTab] = useState<'screen' | 'window'>('screen')
  const [selectedSourceId, setSelectedSourceId] = useState('')
  const [permissions, setPermissions] = useState<PermissionSnapshot | null>(null)
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loadingSources, setLoadingSources] = useState(true)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [countdownRemaining, setCountdownRemaining] = useState<number | null>(null)
  const [activeCodec, setActiveCodec] = useState('')
  const [audioWarning, setAudioWarning] = useState('')
  const [livePreviewStream, setLivePreviewStream] = useState<MediaStream | null>(null)
  const [livePreviewError, setLivePreviewError] = useState('')
  const [recorderState, dispatch] = useReducer(transitionRecorder, initialRecorderState)
  const controllerRef = useRef<RecordingController | null>(null)
  const previewRef = useRef<HTMLVideoElement>(null)
  const stopRecordingRef = useRef<() => Promise<void>>(async () => undefined)
  const permissionsRef = useRef<PermissionSnapshot | null>(null)
  const nativeStateLoadedRef = useRef(false)
  const sourceRefreshGateRef = useRef(new SingleFlight())
  const focusRefreshGateRef = useRef(new SingleFlight())
  const startRecordingGateRef = useRef(new SingleFlight())
  const livePreviewControllerRef = useRef<LivePreviewController | null>(null)

  if (!livePreviewControllerRef.current) {
    livePreviewControllerRef.current = new LivePreviewController({
      prepareCapture: (request) => window.recordingApi.prepareCapture(request),
      getDisplayMedia: (constraints) => navigator.mediaDevices.getDisplayMedia(constraints),
      onStream: setLivePreviewStream
    })
  }

  const filteredSources = useMemo(
    () => sources.filter((source) => source.type === sourceTab),
    [sourceTab, sources]
  )
  const selectedSource = sources.find((source) => source.id === selectedSourceId)
  const isActive = isRecorderActive(recorderState)
  const controlsLocked = controlsAreLocked(recorderState)
  const needsScreenPermission = permissions?.platform === 'darwin' && permissions.screen !== 'granted'
  const selectedApplicationAudioUnavailable = selectedSource?.type === 'window' &&
    permissions?.selectedApplicationAudioSupported === false
  const audioMode = getAudioCaptureMode(
    preferences.includeSystemAudio,
    preferences.includeMicrophone
  )

  const updatePermissionSnapshot = useCallback((snapshot: PermissionSnapshot) => {
    permissionsRef.current = snapshot
    setPermissions(snapshot)
  }, [])

  const refreshSources = useCallback(() => sourceRefreshGateRef.current.run(async () => {
    if (isActive) return
    setLoadingSources(true)
    try {
      const nextSources = await window.recordingApi.listSources()
      setSources(nextSources)
      setSelectedSourceId((current) => {
        if (nextSources.some(({ id }) => id === current)) return current
        return nextSources.find(({ type }) => type === 'screen')?.id ?? nextSources[0]?.id ?? ''
      })
    } finally {
      setLoadingSources(false)
    }
  }), [isActive])

  const refreshAudioDevices = useCallback(async () => {
    const devices = await navigator.mediaDevices.enumerateDevices()
    setAudioDevices(devices.filter(({ kind }) => kind === 'audioinput'))
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const [savedPreferences, permissionSnapshot] = await Promise.all([
          window.recordingApi.getPreferences(),
          window.recordingApi.getPermissions()
        ])
        setPreferences(savedPreferences)
        updatePermissionSnapshot(permissionSnapshot)
        await refreshAudioDevices().catch(() => undefined)

        if (permissionSnapshot.platform !== 'darwin' || permissionSnapshot.screen === 'granted') {
          await refreshSources()
        } else {
          setLoadingSources(false)
        }
      } catch {
        setLoadingSources(false)
      } finally {
        nativeStateLoadedRef.current = true
      }
    })()
  }, []) // Initial native state only.

  useEffect(() => {
    const refreshAfterSettings = (): void => {
      if (!nativeStateLoadedRef.current) return
      void focusRefreshGateRef.current.run(async () => {
        const previous = permissionsRef.current
        const next = await window.recordingApi.getPermissions()
        updatePermissionSnapshot(next)
        if (!isActive && shouldClearSourcesForPermissionChange(previous?.screen, next.screen)) {
          setSources([])
          setSelectedSourceId('')
        } else if (
          !isActive &&
          shouldRefreshSourcesForPermissionChange(previous?.screen, next.screen)
        ) {
          await refreshSources()
        }
        if (previous && previous.microphone !== next.microphone && next.microphone === 'granted') {
          await refreshAudioDevices()
        }
      }).catch(() => undefined)
    }
    window.addEventListener('focus', refreshAfterSettings)
    return () => window.removeEventListener('focus', refreshAfterSettings)
  }, [isActive, refreshAudioDevices, refreshSources, updatePermissionSnapshot])

  useEffect(() => {
    const refreshAfterDeviceChange = (): void => {
      void refreshAudioDevices().catch(() => undefined)
    }
    navigator.mediaDevices.addEventListener('devicechange', refreshAfterDeviceChange)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refreshAfterDeviceChange)
  }, [refreshAudioDevices])

  useEffect(() => {
    if (recorderState.status !== 'recording') return
    const timer = window.setInterval(() => setElapsedSeconds((value) => value + 1), 1_000)
    return () => window.clearInterval(timer)
  }, [recorderState.status])

  useEffect(() => {
    const livePreview = livePreviewControllerRef.current!
    if (isActive || !selectedSource || needsScreenPermission) {
      void livePreview.stop()
      return
    }

    setLivePreviewError('')
    void livePreview.show(selectedSource).catch((error: unknown) => {
      setLivePreviewError(normalizeError(error).message)
    })
    return () => {
      void livePreview.stop()
    }
  }, [isActive, needsScreenPermission, selectedSourceId])

  useEffect(() => {
    if (isActive || !livePreviewStream || !previewRef.current) return
    const preview = previewRef.current
    preview.srcObject = livePreviewStream
    void preview.play().catch((error: unknown) => {
      setLivePreviewError(normalizeError(error).message)
    })
    return () => {
      if (preview.srcObject === livePreviewStream) preview.srcObject = null
    }
  }, [isActive, livePreviewStream])

  useEffect(() => window.recordingApi.onQuitRequested(() => {
    void (async () => {
      const controller = controllerRef.current
      if (controller) {
        dispatch({ type: 'stop' })
        try {
          await controller.stop()
        } catch (error) {
          dispatch({ type: 'failed', message: normalizeError(error).message })
          controllerRef.current = null
          return
        }
        controllerRef.current = null
      }
      await livePreviewControllerRef.current?.stop()
      window.recordingApi.confirmReadyToQuit()
    })()
  }), [])

  const updatePreferences = useCallback(async (patch: Partial<AppPreferences>) => {
    setPreferences((current) => ({ ...current, ...patch }))
    const saved = await window.recordingApi.updatePreferences(patch)
    setPreferences(saved)
  }, [])

  const changeMode = (mode: CaptureMode): void => {
    const selectedWindowAudioSupported = selectedSource?.type !== 'window' ||
      permissions?.selectedApplicationAudioSupported !== false
    const modeDefaults = mode === 'meeting'
      ? {
          captureMode: mode,
          includeSystemAudio: selectedWindowAudioSupported,
          includeMicrophone: true
        }
      : {
          captureMode: mode,
          includeSystemAudio: selectedWindowAudioSupported,
          includeMicrophone: false
        }
    if (!selectedWindowAudioSupported) {
      setAudioWarning(
        '이 운영체제 버전에서는 선택 앱 소리 분리를 지원하지 않아 시스템 소리를 끈 상태로 적용했습니다.'
      )
    }
    void updatePreferences(modeDefaults)
  }

  const changeAudioMode = (mode: AudioCaptureMode): void => {
    void updatePreferences(audioModePatch(mode))
  }

  const selectSource = (source: CaptureSource): void => {
    setSelectedSourceId(source.id)
    if (source.type === 'window' &&
      permissions?.selectedApplicationAudioSupported === false &&
      preferences.includeSystemAudio) {
      void updatePreferences({ includeSystemAudio: false })
      setAudioWarning(
        '이 운영체제 버전에서는 선택 앱 소리 분리를 지원하지 않아 마이크/영상 모드로 전환했습니다.'
      )
    }
  }

  const stopRecording = useCallback(async () => {
    const controller = controllerRef.current
    if (!controller || !canStopRecorder(recorderState)) return
    dispatch({ type: 'stop' })
    try {
      const filePath = await controller.stop()
      controllerRef.current = null
      if (previewRef.current) previewRef.current.srcObject = null
      dispatch({ type: 'saved', filePath })
    } catch (error) {
      dispatch({ type: 'failed', message: normalizeError(error).message })
    }
  }, [recorderState.status])

  stopRecordingRef.current = stopRecording

  const startRecording = async (): Promise<void> => {
    if (!selectedSource) return
    if (recorderState.status === 'completed' || recorderState.status === 'error') {
      dispatch({ type: 'reset' })
    }
    setElapsedSeconds(0)
    setAudioWarning('')
    dispatch({ type: 'start_requested' })

    let controller: RecordingController | null = null
    let captureStarted = false
    let systemAudioFailure: Error | null = null
    let systemAudioFailureHandled = false

    try {
      for (let remaining = preferences.countdownSeconds; remaining > 0; remaining -= 1) {
        setCountdownRemaining(remaining)
        await delay(1_000)
      }
      setCountdownRemaining(null)

      await livePreviewControllerRef.current?.stop()

      controller = new RecordingController({
        onCaptureEnded: () => void stopRecordingRef.current(),
        onStoragePressure: () => {
          setAudioWarning('저장 장치의 응답이 느려 녹화를 종료하고 현재까지의 내용을 저장했습니다.')
          void stopRecordingRef.current()
        },
        onSystemAudioMuted: () => {
          setAudioWarning('앱/시스템 소리가 중단되어 녹화를 종료하고 현재까지의 내용을 저장합니다.')
          void stopRecordingRef.current()
        },
        onSystemAudioError: (error) => {
          systemAudioFailure ??= error
          setAudioWarning(`${error.message} 녹화를 종료하고 현재까지의 내용을 저장합니다.`)
          if (!captureStarted || systemAudioFailureHandled || !controller) return
          systemAudioFailureHandled = true
          const failedController = controller
          dispatch({ type: 'stop' })
          void failedController.stop()
            .then((filePath) => {
              if (controllerRef.current === failedController) controllerRef.current = null
              if (previewRef.current) previewRef.current.srcObject = null
              dispatch(filePath
                ? { type: 'saved', filePath }
                : { type: 'failed', message: error.message })
            })
            .catch((stopError) => {
              dispatch({ type: 'failed', message: normalizeError(stopError).message })
            })
        },
        onWriteError: (error) => {
          dispatch({ type: 'failed', message: error.message })
          const failedController = controller
          void failedController?.abort()
            .catch(() => undefined)
            .finally(() => {
              if (controllerRef.current === failedController) controllerRef.current = null
              if (previewRef.current) previewRef.current.srcObject = null
            })
        }
      })
      controllerRef.current = controller

      const result = await startRecordingWithPreview(
        controller,
        selectedSource,
        preferences,
        () => previewRef.current
      )
      if (systemAudioFailure) throw systemAudioFailure
      captureStarted = true
      setActiveCodec(`${result.codec.extension.toUpperCase()} · ${result.codec.label}`)
      if (preferences.includeSystemAudio && !result.hasSystemAudio) {
        setAudioWarning('시스템 오디오 트랙이 감지되지 않았습니다. 권한을 확인해 주세요.')
      }
      dispatch({ type: 'capture_ready' })
    } catch (error) {
      setCountdownRemaining(null)
      await controller?.abort().catch(() => undefined)
      if (controllerRef.current === controller) controllerRef.current = null
      dispatch({ type: 'failed', message: normalizeError(error).message })
      try {
        updatePermissionSnapshot(await window.recordingApi.getPermissions())
      } catch {
        // The capture error above is the actionable failure.
      }
      return
    }

    void window.recordingApi.getPermissions()
      .then(updatePermissionSnapshot)
      .catch(() => undefined)
    void refreshAudioDevices().catch(() => undefined)
  }

  const pauseOrResume = (): void => {
    if (recorderState.status === 'recording') {
      controllerRef.current?.pause()
      dispatch({ type: 'pause' })
    } else if (recorderState.status === 'paused') {
      controllerRef.current?.resume()
      dispatch({ type: 'resume' })
    }
  }

  const requestMicrophone = async (): Promise<void> => {
    await window.recordingApi.requestMicrophonePermission()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      stream.getTracks().forEach((track) => track.stop())
    } catch {
      // Permission state below gives the actionable result.
    }
    updatePermissionSnapshot(await window.recordingApi.getPermissions())
    await refreshAudioDevices()
  }

  const chooseDirectory = async (): Promise<void> => {
    setPreferences(await window.recordingApi.chooseOutputDirectory())
  }

  const quality = QUALITY_PRESETS[preferences.qualityPreset]
  const encodingPreview = useMemo(
    () => getEncodingPreview(preferences, MediaRecorder.isTypeSupported),
    [
      preferences.codecPreference,
      preferences.qualityPreset,
      preferences.recordingFormat,
      preferences.storageMode
    ]
  )
  const statusText = RECORDER_STATUS_LABELS[recorderState.status]
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark"><img src={appIconUrl} alt="" /></span>
          <div><strong>{APP_NAME}</strong><span>회의와 화면을 또렷하게</span></div>
        </div>
        <div className={`status-pill status-pill--${recorderState.status}`}>
          <span />{statusText}
        </div>
        <button className="icon-button topbar__settings" type="button" onClick={() => setSettingsOpen(true)} aria-label="설정 열기">
          <Settings size={19} />
        </button>
      </header>

      <main className="workspace">
        <section className="capture-stage">
          <header className="section-heading">
            <div>
              <p className="eyebrow">녹화할 화면</p>
              <h1>{isActive ? selectedSource?.name : '화면 또는 창을 선택하세요'}</h1>
            </div>
            {!isActive && (
              <button className="quiet-button" type="button" onClick={() => void refreshSources()} disabled={loadingSources}>
                <RefreshCw size={16} className={loadingSources ? 'spin' : ''} /> 새로고침
              </button>
            )}
          </header>

          <div className={`preview ${isActive || livePreviewStream ? 'preview--live' : ''}`}>
            {isActive || livePreviewStream ? (
              <video ref={previewRef} muted playsInline autoPlay />
            ) : selectedSource ? (
              <img src={selectedSource.thumbnailDataUrl} alt={`${selectedSource.name} 미리보기`} />
            ) : (
              <div className="preview__empty"><MonitorUp size={32} /><span>사용 가능한 화면을 찾고 있습니다.</span></div>
            )}
            <div className="preview__shade" />
            {countdownRemaining !== null && (
              <div className="countdown-overlay" aria-live="assertive">
                <span>곧 녹화를 시작합니다</span>
                <strong>{countdownRemaining}</strong>
              </div>
            )}
            <div className="preview__badge">
              {(isActive || livePreviewStream) && <span className="live-dot" />}
              {isActive
                ? statusText
                : livePreviewStream && selectedSource
                  ? `실시간 · ${sourceType(selectedSource)}`
                  : selectedSource ? sourceType(selectedSource) : '대기 중'}
            </div>
            {!isActive && livePreviewError && (
              <div className="preview__notice">실시간 미리보기를 열지 못했습니다 · {livePreviewError}</div>
            )}
            {isActive && (
              <div className="preview__timer">
                <strong>{formatDuration(elapsedSeconds)}</strong>
                <span>{activeCodec}</span>
              </div>
            )}
          </div>

          {!isActive && (
            <div className="source-browser">
              {needsScreenPermission && (
                <div className="permission-banner">
                  <span className="permission-banner__icon"><MonitorUp size={18} /></span>
                  <span className="permission-banner__copy">
                    <strong>화면 기록 권한이 필요합니다</strong>
                    <small>자동으로 팝업을 띄우지 않습니다. 아래 버튼을 눌러 연결해 주세요.</small>
                  </span>
                  {permissions.screen === 'not-determined' ? (
                    <button type="button" onClick={() => void refreshSources()}>화면 접근 허용</button>
                  ) : (
                    <button type="button" onClick={() => void window.recordingApi.openPermissionSettings('screen')}>시스템 설정</button>
                  )}
                  <button className="permission-banner__reset" type="button" onClick={() => void window.recordingApi.resetScreenPermission()}>
                    <RefreshCw size={13} /> 다시 연결
                  </button>
                </div>
              )}
              <div className="source-tabs" role="tablist" aria-label="캡처 소스 종류">
                <button className={sourceTab === 'screen' ? 'active' : ''} type="button" onClick={() => setSourceTab('screen')}>
                  <Monitor size={16} /> 전체 화면
                </button>
                <button className={sourceTab === 'window' ? 'active' : ''} type="button" onClick={() => setSourceTab('window')}>
                  <LayoutGrid size={16} /> 앱 창
                </button>
              </div>
              <div className="source-list">
                {filteredSources.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    className={`source-card ${selectedSourceId === source.id ? 'selected' : ''}`}
                    onClick={() => selectSource(source)}
                  >
                    <span className="source-card__image"><img src={source.thumbnailDataUrl} alt="" /></span>
                    <span className="source-card__name">
                      {source.appIconDataUrl && <img src={source.appIconDataUrl} alt="" />}
                      <span>{source.name}</span>
                    </span>
                    {selectedSourceId === source.id && <span className="source-card__check"><Check size={13} /></span>}
                  </button>
                ))}
                {!loadingSources && filteredSources.length === 0 && (
                  <div className="source-list__empty">표시할 {sourceTab === 'screen' ? '화면' : '창'}이 없습니다.</div>
                )}
              </div>
            </div>
          )}
        </section>

        <aside className="control-panel">
          <div className="control-panel__intro">
            <p className="eyebrow">녹화 방식</p>
            <div className="mode-switch">
              <button type="button" className={preferences.captureMode === 'meeting' ? 'active' : ''} onClick={() => changeMode('meeting')} disabled={isActive}>
                <Sparkles size={17} /><span><strong>회의</strong><small>화면 + 양쪽 음성</small></span>
              </button>
              <button type="button" className={preferences.captureMode === 'screen' ? 'active' : ''} onClick={() => changeMode('screen')} disabled={isActive}>
                <Monitor size={17} /><span><strong>화면</strong><small>화면 중심 녹화</small></span>
              </button>
            </div>
          </div>

          <div className="control-group">
            <p className="control-label">오디오</p>
            <div className="audio-mode-grid" role="radiogroup" aria-label="녹음할 소리">
              {([
                ['all', '전체 소리', '앱/시스템 + 마이크'],
                ['system', selectedSource?.type === 'window' ? '선택 앱 소리' : '시스템 소리', 'Meet, Zoom과 재생 소리'],
                ['microphone', '마이크만', '내 목소리만'],
                ['none', '소리 없음', '영상만 녹화']
              ] as const).map(([mode, label, detail]) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={audioMode === mode}
                  className={audioMode === mode ? 'active' : ''}
                  disabled={
                    isActive ||
                    ((mode === 'all' || mode === 'system') &&
                      (permissions?.systemAudioSupported === false || selectedApplicationAudioUnavailable))
                  }
                  onClick={() => changeAudioMode(mode)}
                >
                  {mode === 'microphone' ? <Mic2 size={15} /> : <Volume2 size={15} />}
                  <span><strong>{label}</strong><small>{detail}</small></span>
                  <Check size={13} className="audio-mode-grid__check" />
                </button>
              ))}
            </div>
            {preferences.includeMicrophone && (
              <div className="option-row option-row--stacked">
                <span className="option-row__icon"><Mic2 size={18} /></span>
                <span className="option-row__copy"><strong>마이크 입력</strong><small>회의에서 내 목소리</small></span>
                <div className="device-select-wrap">
                  <select
                    aria-label="마이크 선택"
                    value={preferences.microphoneDeviceId}
                    disabled={isActive}
                    onChange={(event) => void updatePreferences({ microphoneDeviceId: event.target.value })}
                  >
                    <option value="">시스템 기본 마이크</option>
                    {audioDevices.map((device, index) => (
                      <option key={device.deviceId} value={device.deviceId}>{device.label || `마이크 ${index + 1}`}</option>
                    ))}
                  </select>
                  <ChevronDown size={15} />
                </div>
              </div>
            )}
            {permissions?.platform === 'darwin' && permissions.microphone !== 'granted' && preferences.includeMicrophone && (
              <button className="permission-hint" type="button" onClick={() => void requestMicrophone()}>
                <AlertCircle size={15} /> 마이크 권한 확인
              </button>
            )}
            {permissions?.systemAudioSupported === false && (
              <p className="inline-warning">이 macOS 버전은 가상 오디오 장치 없이 시스템 소리를 녹음할 수 없습니다.</p>
            )}
            {selectedApplicationAudioUnavailable && (
              <p className="inline-warning">
                선택 앱 소리 분리는 macOS 14.2+ 또는 Windows 10 빌드 20348+에서 사용할 수 있습니다.
              </p>
            )}
          </div>

          <div className="control-group">
            <p className="control-label">화질</p>
            <div className="quality-grid">
              {(Object.keys(QUALITY_PRESETS) as QualityPresetId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  className={preferences.qualityPreset === id ? 'active' : ''}
                  disabled={isActive}
                  onClick={() => void updatePreferences({ qualityPreset: id })}
                >
                  <strong>{QUALITY_PRESETS[id].label}</strong>
                  <span>{QUALITY_PRESETS[id].height}p · {QUALITY_PRESETS[id].frameRate}fps</span>
                </button>
              ))}
            </div>
            <div className="quality-summary">
              <Gauge size={16} />
              <span>{quality.detail}</span>
              <em>{formatEstimatedSize(encodingPreview.plan.estimatedMegabytesPerHour)}</em>
            </div>
          </div>

          <div className="record-area">
            {recorderState.status === 'recording' || recorderState.status === 'paused' ? (
              <div className="active-controls">
                <button className="secondary-control" type="button" onClick={pauseOrResume}>
                  {recorderState.status === 'paused' ? <Play size={20} fill="currentColor" /> : <Pause size={20} fill="currentColor" />}
                  <span>{recorderState.status === 'paused' ? '계속' : '일시정지'}</span>
                </button>
                <button className="stop-control" type="button" onClick={() => void stopRecording()}>
                  <Square size={19} fill="currentColor" />
                  <span>녹화 종료</span>
                </button>
              </div>
            ) : (
              <button
                className="record-button"
                type="button"
                onClick={() => void startRecordingGateRef.current.run(startRecording)}
                disabled={!selectedSourceId || controlsLocked || needsScreenPermission}
              >
                <span className="record-button__dot" />
                <span>{recorderState.status === 'preparing' ? '준비 중…' : recorderState.status === 'finalizing' ? '저장 중…' : '녹화 시작'}</span>
              </button>
            )}
            <div className="destination-row">
              <FolderOpen size={15} />
              <button type="button" title={preferences.outputDirectory} onClick={() => void chooseDirectory()} disabled={isActive}>
                {preferences.outputDirectory}
              </button>
              <button className="more-button" type="button" onClick={() => setSettingsOpen(true)} aria-label="저장 설정">
                <MoreHorizontal size={17} />
              </button>
            </div>
          </div>

          {audioWarning && <div className="result-banner result-banner--warning"><AlertCircle size={18} /><span>{audioWarning}</span></div>}
          {recorderState.status === 'completed' && recorderState.filePath && (
            <div className="result-banner result-banner--success">
              <span className="result-banner__icon"><Check size={17} /></span>
              <span><strong>안전하게 저장했습니다</strong><small>{formatDuration(elapsedSeconds)} 녹화 파일</small></span>
              <button type="button" onClick={() => void window.recordingApi.revealRecording(recorderState.filePath!)}>파일 보기</button>
            </div>
          )}
          {recorderState.status === 'error' && (
            <div className="result-banner result-banner--error">
              <AlertCircle size={18} />
              <span><strong>녹화하지 못했습니다</strong><small>{recorderState.error}</small></span>
              <button type="button" onClick={() => dispatch({ type: 'reset' })}>확인</button>
            </div>
          )}
        </aside>
      </main>

      {settingsOpen && (
        <SettingsModal
          preferences={preferences}
          permissions={permissions}
          recordingActive={isActive}
          onClose={() => setSettingsOpen(false)}
          onChooseDirectory={() => void chooseDirectory()}
          onOpenDirectory={() => void window.recordingApi.openOutputDirectory()}
          onChangeFormat={(format: RecordingFormatPreference) => {
            const compatible = getCompatibleCodecs(format)
            const codecPreference = preferences.codecPreference !== 'auto' &&
              !compatible.includes(preferences.codecPreference)
              ? 'auto'
              : preferences.codecPreference
            void updatePreferences({ recordingFormat: format, codecPreference })
          }}
          onChangeCodec={(codec: CodecPreference) => void updatePreferences({ codecPreference: codec })}
          onChangeStorageMode={(storageMode: StorageModeId) => void updatePreferences({ storageMode })}
          onChangeCountdown={(countdownSeconds: CountdownSeconds) => void updatePreferences({ countdownSeconds })}
          onOpenPermission={(kind) => void window.recordingApi.openPermissionSettings(kind)}
          onResetScreenPermission={() => void window.recordingApi.resetScreenPermission()}
        />
      )}
    </div>
  )
}
