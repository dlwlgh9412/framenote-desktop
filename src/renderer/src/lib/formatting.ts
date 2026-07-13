export function formatEstimatedSize(megabytes: number): string {
  return megabytes >= 1_000
    ? `약 ${(megabytes / 1_000).toFixed(1)}GB/시간`
    : `약 ${megabytes}MB/시간`
}
