import {
  CheckCircle2,
  ChevronRight,
  Cpu,
  FileVideo2,
  FolderOpen,
  Gauge,
  HardDrive,
  Mic2,
  MonitorUp,
  RotateCcw,
  Timer,
  Volume2,
  X
} from 'lucide-react'
import type {
  AppPreferences,
  PermissionSettingsKind,
  PermissionSnapshot
} from '../../../shared/contracts'
import {
  CODEC_PROFILES,
  COUNTDOWN_SECONDS,
  getCompatibleCodecs,
  getEncodingPreview,
  isCodecSupported,
  RECORDING_FORMAT_OPTIONS,
  RECORDING_FORMATS,
  STORAGE_MODE_IDS,
  STORAGE_MODES,
  type CodecPreference,
  type CountdownSeconds,
  type RecordingFormatPreference,
  type StorageModeId
} from '../../../shared/recording-settings'
import { formatEstimatedSize } from '../lib/formatting'

interface SettingsModalProps {
  preferences: AppPreferences
  permissions: PermissionSnapshot | null
  recordingActive: boolean
  onClose: () => void
  onChooseDirectory: () => void
  onOpenDirectory: () => void
  onChangeFormat: (format: RecordingFormatPreference) => void
  onChangeCodec: (codec: CodecPreference) => void
  onChangeStorageMode: (mode: StorageModeId) => void
  onChangeCountdown: (seconds: CountdownSeconds) => void
  onOpenPermission: (kind: PermissionSettingsKind) => void
  onResetScreenPermission: () => void
}

function permissionLabel(status: PermissionSnapshot['screen'] | undefined): string {
  if (status === 'granted') return '허용됨'
  if (status === 'not-determined') return '확인 필요'
  if (status === 'denied' || status === 'restricted') return '허용 필요'
  return '운영체제 관리'
}

export function SettingsModal({
  preferences,
  permissions,
  recordingActive,
  onClose,
  onChooseDirectory,
  onOpenDirectory,
  onChangeFormat,
  onChangeCodec,
  onChangeStorageMode,
  onChangeCountdown,
  onOpenPermission,
  onResetScreenPermission
}: SettingsModalProps): React.JSX.Element {
  const encodingPreview = getEncodingPreview(preferences, MediaRecorder.isTypeSupported)
  const preferredCodec = encodingPreview.codec

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-modal__header">
          <div>
            <p className="eyebrow">MinuteFrame 환경 설정</p>
            <h2 id="settings-title">녹화 설정</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="설정 닫기">
            <X size={18} />
          </button>
        </header>

        <div className="settings-section">
          <div className="settings-section__title">
            <HardDrive size={18} />
            <div>
              <strong>저장 위치</strong>
              <span>녹화가 끝나면 이 폴더에 바로 저장됩니다.</span>
            </div>
          </div>
          <button className="path-card" type="button" onClick={onChooseDirectory}>
            <FolderOpen size={18} />
            <span title={preferences.outputDirectory}>{preferences.outputDirectory}</span>
            <ChevronRight size={18} />
          </button>
          <button className="text-button" type="button" onClick={onOpenDirectory}>
            현재 폴더 열기
          </button>
        </div>

        <div className="settings-section">
          <div className="settings-section__title">
            <FileVideo2 size={18} />
            <div>
              <strong>파일 형식</strong>
              <span>파일 확장자와 재생 호환성을 선택합니다.</span>
            </div>
          </div>
          <div className="format-list">
            {RECORDING_FORMATS.map((format) => {
              const option = RECORDING_FORMAT_OPTIONS[format]
              const available = getCompatibleCodecs(format)
                .some((codec) => isCodecSupported(codec, MediaRecorder.isTypeSupported))
              return (
                <button
                  key={format}
                  type="button"
                  className={`choice-card ${preferences.recordingFormat === format ? 'selected' : ''}`}
                  onClick={() => onChangeFormat(format)}
                  disabled={!available}
                >
                  <span className="choice-card__mark">
                    {preferences.recordingFormat === format && <CheckCircle2 size={17} />}
                  </span>
                  <span>
                    <strong>{option.label}</strong>
                    <small>{available ? option.detail : '현재 기기에서 직접 녹화 미지원'}</small>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section__title">
            <Cpu size={18} />
            <div>
              <strong>비디오·오디오 코덱</strong>
              <span>선택한 파일 형식에서 사용할 압축 방식을 정합니다.</span>
            </div>
          </div>
          <div className="codec-list">
            <button
              type="button"
              className={`choice-card ${preferences.codecPreference === 'auto' ? 'selected' : ''}`}
              onClick={() => onChangeCodec('auto')}
            >
              <span className="choice-card__mark">
                {preferences.codecPreference === 'auto' && <CheckCircle2 size={17} />}
              </span>
              <span>
                <strong>자동 · 권장</strong>
                <small>현재 조합에서는 {CODEC_PROFILES[preferredCodec].label}</small>
              </span>
            </button>
            {Object.values(CODEC_PROFILES).map((codec) => {
              const compatible = getCompatibleCodecs(preferences.recordingFormat).includes(codec.id)
              const supported = isCodecSupported(codec.id, MediaRecorder.isTypeSupported)
              const detail = !compatible
                ? `${RECORDING_FORMAT_OPTIONS[preferences.recordingFormat].label} 형식과 함께 사용할 수 없음`
                : supported ? codec.detail : '현재 기기에서 지원하지 않음'
              return (
                <button
                  key={codec.id}
                  type="button"
                  className={`choice-card ${preferences.codecPreference === codec.id ? 'selected' : ''}`}
                  onClick={() => onChangeCodec(codec.id)}
                  disabled={!compatible || !supported}
                >
                  <span className="choice-card__mark">
                    {preferences.codecPreference === codec.id && <CheckCircle2 size={17} />}
                  </span>
                  <span><strong>{codec.label}</strong><small>{detail}</small></span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section__title settings-section__title--with-value">
            <Gauge size={18} />
            <div>
              <strong>용량 전략</strong>
              <span>화질 프리셋은 유지하고 목표 비트레이트를 조절합니다.</span>
            </div>
            <em>{formatEstimatedSize(encodingPreview.plan.estimatedMegabytesPerHour)}</em>
          </div>
          <div className="storage-mode-list">
            {STORAGE_MODE_IDS.map((mode) => (
              <button
                key={mode}
                type="button"
                className={preferences.storageMode === mode ? 'selected' : ''}
                onClick={() => onChangeStorageMode(mode)}
              >
                <strong>{STORAGE_MODES[mode].label}</strong>
                <small>{STORAGE_MODES[mode].detail}</small>
              </button>
            ))}
          </div>
          {preferredCodec === 'vp9' && (
            <p className="settings-note">VP9은 화면 변화가 적은 회의·문서 녹화에서 용량 효율이 가장 좋습니다.</p>
          )}
        </div>

        <div className="settings-section">
          <div className="settings-section__title">
            <Timer size={18} />
            <div>
              <strong>시작 카운트다운</strong>
              <span>녹화 버튼을 누른 뒤 준비할 시간을 둡니다.</span>
            </div>
          </div>
          <div className="countdown-options">
            {COUNTDOWN_SECONDS.map((seconds) => (
              <button
                key={seconds}
                type="button"
                className={preferences.countdownSeconds === seconds ? 'selected' : ''}
                onClick={() => onChangeCountdown(seconds)}
              >
                {seconds === 0 ? '바로 시작' : `${seconds}초`}
              </button>
            ))}
          </div>
        </div>

        {permissions?.platform === 'darwin' && (
          <div className="settings-section settings-section--last">
            <div className="settings-section__title">
              <MonitorUp size={18} />
              <div>
                <strong>macOS 권한</strong>
                <span>설정에서 변경하면 앱으로 돌아올 때 상태를 다시 확인합니다.</span>
              </div>
            </div>
            <button className="permission-row" type="button" onClick={() => onOpenPermission('screen')}>
              <MonitorUp size={17} />
              <span>화면 기록</span>
              <em className={permissions.screen === 'granted' ? 'granted' : ''}>
                {permissionLabel(permissions.screen)}
              </em>
              <ChevronRight size={16} />
            </button>
            <button className="permission-row" type="button" onClick={() => onOpenPermission('microphone')}>
              <Mic2 size={17} />
              <span>마이크</span>
              <em className={permissions.microphone === 'granted' ? 'granted' : ''}>
                {permissionLabel(permissions.microphone)}
              </em>
              <ChevronRight size={16} />
            </button>
            <button className="permission-row" type="button" onClick={() => onOpenPermission('systemAudio')}>
              <Volume2 size={17} />
              <span>시스템 오디오</span>
              <em>{permissions.systemAudio === 'unknown' ? '녹화 시 확인' : permissionLabel(permissions.systemAudio)}</em>
              <ChevronRight size={16} />
            </button>
            <div className="permission-recovery">
              <div>
                <strong>허용했는데도 작동하지 않나요?</strong>
                <span>{recordingActive
                  ? '녹화를 끝낸 뒤 권한 연결을 초기화할 수 있습니다.'
                  : '업데이트 전 권한 항목을 지우고 현재 앱을 다시 등록합니다.'}</span>
              </div>
              <button type="button" onClick={onResetScreenPermission} disabled={recordingActive}>
                <RotateCcw size={15} /> 권한 연결 초기화
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
