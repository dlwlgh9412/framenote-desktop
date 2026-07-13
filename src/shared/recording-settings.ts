export const RECORDING_FORMATS = ['auto', 'mp4', 'webm'] as const
export type RecordingFormatPreference = (typeof RECORDING_FORMATS)[number]
export const RECORDING_EXTENSIONS = ['mp4', 'webm'] as const
export type RecordingExtension = (typeof RECORDING_EXTENSIONS)[number]

export const CODEC_PREFERENCES = ['auto', 'h264', 'vp9', 'vp8'] as const
export type CodecPreference = (typeof CODEC_PREFERENCES)[number]
export type ConcreteCodec = Exclude<CodecPreference, 'auto'>

export const STORAGE_MODE_IDS = ['compact', 'balanced', 'quality'] as const
export type StorageModeId = (typeof STORAGE_MODE_IDS)[number]

export const AUDIO_QUALITY_IDS = ['standard', 'high'] as const
export type AudioQualityId = (typeof AUDIO_QUALITY_IDS)[number]

export const COUNTDOWN_SECONDS = [0, 3, 5] as const
export type CountdownSeconds = (typeof COUNTDOWN_SECONDS)[number]

export interface CodecProfile {
  id: ConcreteCodec
  label: string
  detail: string
  mimeTypes: readonly string[]
  extension: RecordingExtension
  bitrateFactor: number
}

export interface ResolvedCodecProfile extends CodecProfile {
  mimeType: string
}

export interface RecordingFormatOption {
  id: RecordingFormatPreference
  label: string
  detail: string
}

export interface StorageMode {
  id: StorageModeId
  label: string
  detail: string
  bitrateMultiplier: number
}

export interface AudioQualityOption {
  id: AudioQualityId
  label: string
  detail: string
  minimumBitsPerSecond?: number
}

export const QUALITY_PRESET_IDS = [
  'efficient',
  'balanced',
  'detailed',
  'smooth',
  'ultra',
  'ultraSmooth'
] as const
export type QualityPresetId = (typeof QUALITY_PRESET_IDS)[number]

export interface QualityPreset {
  id: QualityPresetId
  label: string
  detail: string
  width: number
  height: number
  frameRate: number
  videoBitsPerSecond: number
  audioBitsPerSecond: number
}

export interface EncodingPlan extends QualityPreset {
  estimatedMegabytesPerHour: number
}

export interface EncodingPreferences {
  recordingFormat: RecordingFormatPreference
  codecPreference: CodecPreference
  qualityPreset: QualityPresetId
  storageMode: StorageModeId
  audioQuality?: AudioQualityId
}

export interface EncodingPreview {
  codec: ConcreteCodec
  plan: EncodingPlan
  supported: boolean
}

export const RECORDING_FORMAT_OPTIONS: Record<RecordingFormatPreference, RecordingFormatOption> = {
  auto: {
    id: 'auto',
    label: '자동 · 권장',
    detail: 'MP4 우선, 미지원 시 WebM'
  },
  mp4: {
    id: 'mp4',
    label: 'MP4',
    detail: '가장 넓은 재생 호환성'
  },
  webm: {
    id: 'webm',
    label: 'WebM',
    detail: '효율적인 웹·장시간 녹화'
  }
}

const H264_COMPATIBILITY_MIME_TYPES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1.42001E,mp4a.40.2',
  'video/mp4',
  'video/mp4;codecs=avc1.4D4033,mp4a.40.2',
  'video/mp4;codecs=avc1.640033,mp4a.40.2'
] as const

const H264_HIGH_QUALITY_MIME_TYPES = [
  'video/mp4;codecs=avc1.640033,mp4a.40.2',
  'video/mp4;codecs=avc1.4D4033,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1.42001E,mp4a.40.2',
  'video/mp4'
] as const

export const CODEC_PROFILES: Record<ConcreteCodec, CodecProfile> = {
  h264: {
    id: 'h264',
    label: 'H.264 / AAC',
    detail: 'MP4용 범용 코덱',
    mimeTypes: H264_COMPATIBILITY_MIME_TYPES,
    extension: 'mp4',
    bitrateFactor: 1
  },
  vp9: {
    id: 'vp9',
    label: 'VP9 / Opus',
    detail: '같은 체감 화질에서 작은 용량',
    mimeTypes: [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp09.00.10.08,opus'
    ],
    extension: 'webm',
    bitrateFactor: 0.72
  },
  vp8: {
    id: 'vp8',
    label: 'VP8 / Opus',
    detail: '오래된 장치용 WebM 대체 코덱',
    mimeTypes: ['video/webm;codecs=vp8,opus'],
    extension: 'webm',
    bitrateFactor: 1.05
  }
}

export const STORAGE_MODES: Record<StorageModeId, StorageMode> = {
  compact: {
    id: 'compact',
    label: '절약',
    detail: '정적인 회의 화면과 장시간 녹화',
    bitrateMultiplier: 0.7
  },
  balanced: {
    id: 'balanced',
    label: '균형 · 권장',
    detail: '화질과 용량의 균형',
    bitrateMultiplier: 1
  },
  quality: {
    id: 'quality',
    label: '최상',
    detail: '작은 글자와 빠른 움직임 보존',
    bitrateMultiplier: 1.35
  }
}

export const AUDIO_QUALITY_OPTIONS: Record<AudioQualityId, AudioQualityOption> = {
  standard: {
    id: 'standard',
    label: '기본',
    detail: '기존 프리셋과 용량 전략에 맞춤'
  },
  high: {
    id: 'high',
    label: '고음질',
    detail: '48kHz · 최대 320kbps 목표',
    minimumBitsPerSecond: 320_000
  }
}

const compatibilityOrder: ConcreteCodec[] = ['h264', 'vp9', 'vp8']

export const QUALITY_PRESETS: Record<QualityPresetId, QualityPreset> = {
  efficient: {
    id: 'efficient',
    label: '효율',
    detail: '긴 회의와 작은 용량',
    width: 1280,
    height: 720,
    frameRate: 30,
    videoBitsPerSecond: 3_000_000,
    audioBitsPerSecond: 128_000
  },
  balanced: {
    id: 'balanced',
    label: '균형',
    detail: '회의 녹화 권장',
    width: 1920,
    height: 1080,
    frameRate: 30,
    videoBitsPerSecond: 6_000_000,
    audioBitsPerSecond: 192_000
  },
  detailed: {
    id: 'detailed',
    label: '고화질',
    detail: '작은 글자와 발표 자료',
    width: 2560,
    height: 1440,
    frameRate: 30,
    videoBitsPerSecond: 16_000_000,
    audioBitsPerSecond: 192_000
  },
  smooth: {
    id: 'smooth',
    label: '부드럽게',
    detail: '움직임이 많은 화면',
    width: 1920,
    height: 1080,
    frameRate: 60,
    videoBitsPerSecond: 12_000_000,
    audioBitsPerSecond: 192_000
  },
  ultra: {
    id: 'ultra',
    label: '4K',
    detail: '4K 발표·디자인 검토',
    width: 3840,
    height: 2160,
    frameRate: 30,
    videoBitsPerSecond: 32_000_000,
    audioBitsPerSecond: 192_000
  },
  ultraSmooth: {
    id: 'ultraSmooth',
    label: '4K 60',
    detail: '4K 화면의 빠른 움직임',
    width: 3840,
    height: 2160,
    frameRate: 60,
    videoBitsPerSecond: 50_000_000,
    audioBitsPerSecond: 256_000
  }
}

export function getCompatibleCodecs(format: RecordingFormatPreference): ConcreteCodec[] {
  if (format === 'mp4') return ['h264']
  if (format === 'webm') return ['vp9', 'vp8']
  return [...compatibilityOrder]
}

export function isCodecSupported(
  codec: ConcreteCodec,
  isSupported: (mimeType: string) => boolean
): boolean {
  return CODEC_PROFILES[codec].mimeTypes.some(isSupported)
}

export function getPreferredCodec(
  format: RecordingFormatPreference,
  preference: CodecPreference
): ConcreteCodec {
  if (preference !== 'auto' && getCompatibleCodecs(format).includes(preference)) return preference
  return getCompatibleCodecs(format)[0]
}

export function chooseCodec(
  format: RecordingFormatPreference,
  preference: CodecPreference,
  isSupported: (mimeType: string) => boolean,
  options: { preferHighQualityH264?: boolean } = {}
): ResolvedCodecProfile {
  const compatible = getCompatibleCodecs(format)
  if (preference !== 'auto' && !compatible.includes(preference)) {
    if (format === 'mp4') throw new Error('MP4 파일 형식에서는 H.264 코덱만 사용할 수 있습니다.')
    if (format === 'webm') throw new Error('WebM 파일 형식에서는 VP9 또는 VP8 코덱을 사용해야 합니다.')
  }

  const candidates = preference === 'auto' ? compatible : [preference]
  for (const codec of candidates) {
    const profile = CODEC_PROFILES[codec]
    const mimeTypes = codec === 'h264' && options.preferHighQualityH264
      ? H264_HIGH_QUALITY_MIME_TYPES
      : profile.mimeTypes
    const mimeType = mimeTypes.find(isSupported)
    if (mimeType) return { ...profile, mimeType }
  }

  if (preference !== 'auto') {
    throw new Error(`선택한 ${CODEC_PROFILES[preference].label} 코덱을 현재 기기에서 사용할 수 없습니다.`)
  }
  const formatLabel = format === 'auto' ? '' : `${RECORDING_FORMAT_OPTIONS[format].label} `
  throw new Error(`현재 기기에서 지원되는 ${formatLabel}녹화 코덱을 찾을 수 없습니다.`)
}

export function estimateMegabytesPerHour(
  videoBitsPerSecond: number,
  audioBitsPerSecond: number
): number {
  return Math.round((videoBitsPerSecond + audioBitsPerSecond) * 3_600 / 8 / 1_000_000)
}

export function getEncodingPlan(
  qualityId: QualityPresetId,
  storageModeId: StorageModeId,
  codec: ConcreteCodec,
  audioQualityId: AudioQualityId = 'standard'
): EncodingPlan {
  const quality = QUALITY_PRESETS[qualityId]
  const storageMode = STORAGE_MODES[storageModeId]
  const videoBitsPerSecond = Math.round(
    quality.videoBitsPerSecond * storageMode.bitrateMultiplier * CODEC_PROFILES[codec].bitrateFactor / 100_000
  ) * 100_000
  const strategyAudioBitsPerSecond = storageModeId === 'compact'
    ? Math.min(quality.audioBitsPerSecond, 128_000)
    : storageModeId === 'quality'
      ? Math.max(quality.audioBitsPerSecond, 256_000)
      : quality.audioBitsPerSecond
  const audioBitsPerSecond = Math.max(
    strategyAudioBitsPerSecond,
    AUDIO_QUALITY_OPTIONS[audioQualityId].minimumBitsPerSecond ?? 0
  )

  return {
    ...quality,
    videoBitsPerSecond,
    audioBitsPerSecond,
    estimatedMegabytesPerHour: estimateMegabytesPerHour(videoBitsPerSecond, audioBitsPerSecond)
  }
}

export function getEncodingPreview(
  preferences: EncodingPreferences,
  isSupported: (mimeType: string) => boolean
): EncodingPreview {
  let codec = getPreferredCodec(preferences.recordingFormat, preferences.codecPreference)
  let supported = false
  try {
    codec = chooseCodec(
      preferences.recordingFormat,
      preferences.codecPreference,
      isSupported
    ).id
    supported = true
  } catch {
    // Keep estimates visible while the UI explains that the selected encoder is unavailable.
  }
  return {
    codec,
    plan: getEncodingPlan(
      preferences.qualityPreset,
      preferences.storageMode,
      codec,
      preferences.audioQuality
    ),
    supported
  }
}

export function getQualityPreset(id: QualityPresetId): QualityPreset {
  return QUALITY_PRESETS[id]
}

export function shouldPreferHighQualityH264(id: QualityPresetId): boolean {
  const preset = QUALITY_PRESETS[id]
  return preset.width > 1920 || preset.frameRate > 30
}

export function isRecordingFormatPreference(value: unknown): value is RecordingFormatPreference {
  return typeof value === 'string' && RECORDING_FORMATS.includes(value as RecordingFormatPreference)
}

export function isCodecPreference(value: unknown): value is CodecPreference {
  return typeof value === 'string' && CODEC_PREFERENCES.includes(value as CodecPreference)
}

export function isStorageModeId(value: unknown): value is StorageModeId {
  return typeof value === 'string' && STORAGE_MODE_IDS.includes(value as StorageModeId)
}

export function isAudioQualityId(value: unknown): value is AudioQualityId {
  return typeof value === 'string' && AUDIO_QUALITY_IDS.includes(value as AudioQualityId)
}

export function isCountdownSeconds(value: unknown): value is CountdownSeconds {
  return typeof value === 'number' && COUNTDOWN_SECONDS.includes(value as CountdownSeconds)
}

export function isQualityPresetId(value: unknown): value is QualityPresetId {
  return typeof value === 'string' && QUALITY_PRESET_IDS.includes(value as QualityPresetId)
}
