import { describe, expect, it } from "vitest";
import { correlateDownload } from "./downloadCorrelation";

describe("correlateDownload", () => {
  it("matches the nearest eligible download in the tab and time window", () => {
    const match = correlateDownload(
      {
        tabId: 4,
        triggeredAtMs: 1_000,
        windowBeforeMs: 100,
        windowAfterMs: 500,
        filenameHints: ["pdf", "board"]
      },
      [
        { id: 1, tabId: 4, filename: "board.pdf", startedAtMs: 1_050 },
        { id: 2, tabId: 3, filename: "board.pdf", startedAtMs: 1_020 }
      ]
    );

    expect(match?.id).toBe(1);
  });
});
