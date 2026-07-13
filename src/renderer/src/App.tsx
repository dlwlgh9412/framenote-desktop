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
  Radio,
  RefreshCw,
  Settings,
  Sparkles,
  Square,
  Volume2
} from 'lucide-react'
import {
  createDefaultPreferences,
  type AppPreferences,
  type CaptureMode,
  type CaptureSource,
  type PermissionSnapshot
} from '../../shared/contracts'
import {
  QUALITY_PRESETS,
  type CodecPreference,
  type QualityPresetId
} from '../../shared/recording-settings'
import {
  canStopRecorder,
  controlsAreLocked,
  initialRecorderState,
  isRecorderActive,
  RECORDER_STATUS_LABELS,
  transitionRecorder
} from '../../shared/recorder-machine'
import { Toggle } from './components/Toggle'
import { SettingsModal } from './components/SettingsModal'
import { normalizeError, RecordingController } from './lib/recording-controller'

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
  const [activeCodec, setActiveCodec] = useState('')
  const [audioWarning, setAudioWarning] = useState('')
  const [recorderState, dispatch] = useReducer(transitionRecorder, initialRecorderState)
  const controllerRef = useRef<RecordingController | null>(null)
  const previewRef = useRef<HTMLVideoElement>(null)
  const stopRecordingRef = useRef<() => Promise<void>>(async () => undefined)

  const filteredSources = useMemo(
    () => sources.filter((source) => source.type === sourceTab),
    [sourceTab, sources]
  )
  const selectedSource = sources.find((source) => source.id === selectedSourceId)
  const isActive = isRecorderActive(recorderState)
  const controlsLocked = controlsAreLocked(recorderState)

  const refreshSources = useCallback(async () => {
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
  }, [isActive])

  const refreshAudioDevices = useCallback(async () => {
    const devices = await navigator.mediaDevices.enumerateDevices()
    setAudioDevices(devices.filter(({ kind }) => kind === 'audioinput'))
  }, [])

  useEffect(() => {
    void Promise.all([
      window.recordingApi.getPreferences().then(setPreferences),
      window.recordingApi.getPermissions().then(setPermissions),
      refreshSources(),
      refreshAudioDevices()
    ])
  }, []) // Initial native state only.

  useEffect(() => {
    if (recorderState.status !== 'recording') return
    const timer = window.setInterval(() => setElapsedSeconds((value) => value + 1), 1_000)
    return () => window.clearInterval(timer)
  }, [recorderState.status])

  const updatePreferences = useCallback(async (patch: Partial<AppPreferences>) => {
    setPreferences((current) => ({ ...current, ...patch }))
    const saved = await window.recordingApi.updatePreferences(patch)
    setPreferences(saved)
  }, [])

  const changeMode = (mode: CaptureMode): void => {
    const modeDefaults = mode === 'meeting'
      ? { captureMode: mode, includeSystemAudio: true, includeMicrophone: true }
      : { captureMode: mode, includeSystemAudio: true, includeMicrophone: false }
    void updatePreferences(modeDefaults)
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
    if (!selectedSourceId) return
    if (recorderState.status === 'completed' || recorderState.status === 'error') {
      dispatch({ type: 'reset' })
    }
    setElapsedSeconds(0)
    setAudioWarning('')
    dispatch({ type: 'start_requested' })

    let controller: RecordingController
    controller = new RecordingController({
      onCaptureEnded: () => void stopRecordingRef.current(),
      onStoragePressure: () => {
        setAudioWarning('저장 장치의 응답이 느려 녹화를 종료하고 현재까지의 내용을 저장했습니다.')
        void stopRecordingRef.current()
      },
      onSystemAudioMuted: () => {
        setAudioWarning('시스템 오디오가 음소거되었습니다. macOS 오디오 캡처 권한을 확인해 주세요.')
      },
      onWriteError: (error) => {
        dispatch({ type: 'failed', message: error.message })
        void controller.stop().catch(() => undefined)
        controllerRef.current = null
      }
    })
    controllerRef.current = controller

    try {
      const result = await controller.start(selectedSourceId, preferences)
      if (previewRef.current) {
        previewRef.current.srcObject = result.previewStream
        await previewRef.current.play()
      }
      setActiveCodec(result.codec.label)
      if (preferences.includeSystemAudio && !result.hasSystemAudio) {
        setAudioWarning('시스템 오디오 트랙이 감지되지 않았습니다. 권한을 확인해 주세요.')
      }
      dispatch({ type: 'capture_ready' })
      setPermissions(await window.recordingApi.getPermissions())
      await refreshAudioDevices()
    } catch (error) {
      controllerRef.current = null
      dispatch({ type: 'failed', message: normalizeError(error).message })
      setPermissions(await window.recordingApi.getPermissions())
    }
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
    setPermissions(await window.recordingApi.getPermissions())
    await refreshAudioDevices()
  }

  const chooseDirectory = async (): Promise<void> => {
    setPreferences(await window.recordingApi.chooseOutputDirectory())
  }

  const quality = QUALITY_PRESETS[preferences.qualityPreset]
  const statusText = RECORDER_STATUS_LABELS[recorderState.status]

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark"><Radio size={20} strokeWidth={2.3} /></span>
          <div><strong>Meeting Capture</strong><span>회의와 화면을 또렷하게</span></div>
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

          <div className={`preview ${isActive ? 'preview--live' : ''}`}>
            {isActive ? (
              <video ref={previewRef} muted playsInline />
            ) : selectedSource ? (
              <img src={selectedSource.thumbnailDataUrl} alt={`${selectedSource.name} 미리보기`} />
            ) : (
              <div className="preview__empty"><MonitorUp size={32} /><span>사용 가능한 화면을 찾고 있습니다.</span></div>
            )}
            <div className="preview__shade" />
            <div className="preview__badge">
              {isActive && <span className="live-dot" />}
              {isActive ? statusText : selectedSource ? sourceType(selectedSource) : '대기 중'}
            </div>
            {isActive && (
              <div className="preview__timer">
                <strong>{formatDuration(elapsedSeconds)}</strong>
                <span>{activeCodec}</span>
              </div>
            )}
          </div>

          {!isActive && (
            <div className="source-browser">
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
                    onClick={() => setSelectedSourceId(source.id)}
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
            <div className="option-row">
              <span className="option-row__icon"><Volume2 size={18} /></span>
              <span className="option-row__copy"><strong>시스템 오디오</strong><small>Meet, Zoom과 앱 소리</small></span>
              <Toggle
                label="시스템 오디오"
                checked={preferences.includeSystemAudio}
                disabled={isActive || permissions?.systemAudioSupported === false}
                onChange={(value) => void updatePreferences({ includeSystemAudio: value })}
              />
            </div>
            <div className="option-row option-row--stacked">
              <span className="option-row__icon"><Mic2 size={18} /></span>
              <span className="option-row__copy"><strong>마이크</strong><small>내 목소리 · 소음 억제</small></span>
              <Toggle
                label="마이크"
                checked={preferences.includeMicrophone}
                disabled={isActive}
                onChange={(value) => void updatePreferences({ includeMicrophone: value })}
              />
              {preferences.includeMicrophone && (
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
              )}
            </div>
            {permissions?.platform === 'darwin' && permissions.microphone !== 'granted' && preferences.includeMicrophone && (
              <button className="permission-hint" type="button" onClick={() => void requestMicrophone()}>
                <AlertCircle size={15} /> 마이크 권한 확인
              </button>
            )}
            {permissions?.systemAudioSupported === false && (
              <p className="inline-warning">이 macOS 버전은 가상 오디오 장치 없이 시스템 소리를 녹음할 수 없습니다.</p>
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
              <em>약 {Math.round((quality.videoBitsPerSecond + quality.audioBitsPerSecond) * 3600 / 8 / 1_000_000)}MB/시간</em>
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
                onClick={() => void startRecording()}
                disabled={!selectedSourceId || controlsLocked}
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
          onClose={() => setSettingsOpen(false)}
          onChooseDirectory={() => void chooseDirectory()}
          onOpenDirectory={() => void window.recordingApi.openOutputDirectory()}
          onChangeCodec={(codec: CodecPreference) => void updatePreferences({ codecPreference: codec })}
          onOpenPermission={(kind) => void window.recordingApi.openPermissionSettings(kind)}
        />
      )}
    </div>
  )
}
