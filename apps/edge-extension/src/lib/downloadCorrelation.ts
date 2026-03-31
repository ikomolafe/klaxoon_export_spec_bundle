import type { DownloadCandidate, DownloadCorrelationInput } from "@klaxoon/shared";

export function correlateDownload(
  input: DownloadCorrelationInput,
  downloads: DownloadCandidate[]
): DownloadCandidate | undefined {
  const windowStart = input.triggeredAtMs - input.windowBeforeMs;
  const windowEnd = input.triggeredAtMs + input.windowAfterMs;

  return downloads
    .filter((item) => item.startedAtMs >= windowStart && item.startedAtMs <= windowEnd)
    .filter((item) => item.tabId === input.tabId)
    .sort((left, right) => left.startedAtMs - right.startedAtMs)
    .find((item) => input.filenameHints.some((hint) => item.filename.toLowerCase().includes(hint.toLowerCase())));
}
