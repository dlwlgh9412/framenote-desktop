import {
  CheckCircle2,
  ChevronRight,
  FolderOpen,
  HardDrive,
  KeyRound,
  Mic2,
  MonitorUp,
  Volume2,
  X
} from 'lucide-react'
import type {
  AppPreferences,
  PermissionSettingsKind,
  PermissionSnapshot
} from '../../../shared/contracts'
import { CODEC_PROFILES, type CodecPreference } from '../../../shared/recording-settings'

interface SettingsModalProps {
  preferences: AppPreferences
  permissions: PermissionSnapshot | null
  onClose: () => void
  onChooseDirectory: () => void
  onOpenDirectory: () => void
  onChangeCodec: (codec: CodecPreference) => void
  onOpenPermission: (kind: PermissionSettingsKind) => void
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
  onClose,
  onChooseDirectory,
  onOpenDirectory,
  onChangeCodec,
  onOpenPermission
}: SettingsModalProps): React.JSX.Element {
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
            <p className="eyebrow">환경 설정</p>
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
            <KeyRound size={18} />
            <div>
              <strong>파일 형식과 코덱</strong>
              <span>자동은 재생 호환성을 먼저 고려합니다.</span>
            </div>
          </div>
          <div className="codec-list">
            <button
              type="button"
              className={`codec-option ${preferences.codecPreference === 'auto' ? 'selected' : ''}`}
              onClick={() => onChangeCodec('auto')}
            >
              <span className="codec-option__mark">
                {preferences.codecPreference === 'auto' && <CheckCircle2 size={17} />}
              </span>
              <span><strong>자동 · 권장</strong><small>MP4 우선, 미지원 시 WebM 자동 전환</small></span>
            </button>
            {Object.values(CODEC_PROFILES).map((codec) => {
              const supported = MediaRecorder.isTypeSupported(codec.mimeType)
              return (
                <button
                  key={codec.id}
                  type="button"
                  className={`codec-option ${preferences.codecPreference === codec.id ? 'selected' : ''}`}
                  onClick={() => onChangeCodec(codec.id)}
                  disabled={!supported}
                >
                  <span className="codec-option__mark">
                    {preferences.codecPreference === codec.id && <CheckCircle2 size={17} />}
                  </span>
                  <span><strong>{codec.label}</strong><small>{supported ? codec.detail : '현재 기기에서 지원하지 않음'}</small></span>
                </button>
              )
            })}
          </div>
        </div>

        {permissions?.platform === 'darwin' && (
          <div className="settings-section settings-section--last">
            <div className="settings-section__title">
              <MonitorUp size={18} />
              <div>
                <strong>macOS 권한</strong>
                <span>변경 후 앱을 다시 열어야 할 수 있습니다.</span>
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
              <em>{permissions.systemAudio === 'unknown' ? '상태 확인 불가 · 녹화 시 요청' : permissionLabel(permissions.systemAudio)}</em>
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
