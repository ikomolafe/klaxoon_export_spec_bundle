import { describe, expect, it } from "vitest";
import type { RunManifest } from "./index";

describe("RunManifest", () => {
  it("supports the required schema version and board file mapping", () => {
    const manifest: RunManifest = {
      schemaVersion: "1.0.0",
      runId: "2026-03-12_143000",
      startedAt: "2026-03-12T14:30:00Z",
      outputRoot: "C:\\Exports\\Klaxoon_Bulk_Export",
      boards: [
        {
          workspaceName: "Delivery",
          boardName: "Quarterly Planning",
          boardKey: "board-12345",
          statuses: { pdf: "done", klx: "skipped", zip: "done" },
          files: [
            "workspaces/delivery/quarterly-planning__board-12345/board-zones.pdf",
            "workspaces/delivery/quarterly-planning__board-12345/board-fit.pdf",
            "workspaces/delivery/quarterly-planning__board-12345/board.zip"
          ],
          artifacts: [
            {
              id: "zone-pdf",
              label: "Zone PDF",
              format: "pdf",
              mode: "zones",
              status: "done",
              file: "workspaces/delivery/quarterly-planning__board-12345/board-zones.pdf",
              delivery: "replay"
            },
            {
              id: "board-fit-pdf",
              label: "Board fit PDF",
              format: "pdf",
              mode: "board-fit",
              status: "done",
              file: "workspaces/delivery/quarterly-planning__board-12345/board-fit.pdf",
              delivery: "trigger"
            }
          ],
          zones: [
            {
              zoneName: "Overview",
              zoneKey: "zone-001",
              statuses: { pdf: "done" },
              files: ["workspaces/delivery/quarterly-planning__board-12345/zones/00-overview/board.pdf"]
            }
          ]
        }
      ]
    };

    expect(manifest.boards[0].statuses.pdf).toBe("done");
    expect(manifest.boards[0].zones?.[0].files[0]).toContain("zones/00-overview/board.pdf");
  });
});
