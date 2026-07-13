export type CodecPreference = 'auto' | 'h264' | 'vp9' | 'vp8'
export type ConcreteCodec = Exclude<CodecPreference, 'auto'>

export interface CodecProfile {
  id: ConcreteCodec
  label: string
  detail: string
  mimeType: string
  extension: 'mp4' | 'webm'
}

export type QualityPresetId = 'efficient' | 'balanced' | 'detailed' | 'smooth'

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

export const CODEC_PROFILES: Record<ConcreteCodec, CodecProfile> = {
  h264: {
    id: 'h264',
    label: 'MP4 · H.264/AAC',
    detail: '가장 넓은 재생 호환성',
    mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    extension: 'mp4'
  },
  vp9: {
    id: 'vp9',
    label: 'WebM · VP9/Opus',
    detail: '작은 용량과 높은 화질',
    mimeType: 'video/webm;codecs=vp9,opus',
    extension: 'webm'
  },
  vp8: {
    id: 'vp8',
    label: 'WebM · VP8/Opus',
    detail: '오래된 장치용 대체 형식',
    mimeType: 'video/webm;codecs=vp8,opus',
    extension: 'webm'
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
    videoBitsPerSecond: 10_000_000,
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
  }
}

export function chooseCodec(
  preference: CodecPreference,
  isSupported: (mimeType: string) => boolean
): CodecProfile {
  const order = preference === 'auto'
    ? compatibilityOrder
    : [preference, ...compatibilityOrder.filter((codec) => codec !== preference)]

  return CODEC_PROFILES[order.find((codec) => isSupported(CODEC_PROFILES[codec].mimeType)) ?? 'vp8']
}

export function getQualityPreset(id: QualityPresetId): QualityPreset {
  return QUALITY_PRESETS[id]
}
