import type { CaptureSource, PrepareCaptureRequest } from '../../../shared/contracts'

interface LivePreviewDependencies {
  prepareCapture: (request: PrepareCaptureRequest) => Promise<void>
  getDisplayMedia: (constraints: DisplayMediaStreamOptions) => Promise<MediaStream>
  onStream: (stream: MediaStream | null) => void
}

export class LivePreviewController {
  private generation = 0
  private tail: Promise<void> = Promise.resolve()
  private currentStream: MediaStream | null = null

  constructor(private readonly dependencies: LivePreviewDependencies) {}

  show(source: CaptureSource): Promise<void> {
    const generation = ++this.generation
    const operation = this.tail.catch(() => undefined).then(async () => {
      this.releaseCurrentStream()
      if (generation !== this.generation) return

      await this.dependencies.prepareCapture({
        sourceId: source.id,
        sourceType: source.type,
        displayId: source.displayId,
        includeSystemAudio: false
      })
      const stream = await this.dependencies.getDisplayMedia({
        video: {
          width: { ideal: 1_280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 }
        },
        audio: false
      })

      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      this.currentStream = stream
      this.dependencies.onStream(stream)
    })
    this.tail = operation
    return operation
  }

  stop(): Promise<void> {
    ++this.generation
    const operation = this.tail.catch(() => undefined).then(() => this.releaseCurrentStream())
    this.tail = operation
    return operation
  }

  private releaseCurrentStream(): void {
    this.currentStream?.getTracks().forEach((track) => track.stop())
    this.currentStream = null
    this.dependencies.onStream(null)
  }
}
