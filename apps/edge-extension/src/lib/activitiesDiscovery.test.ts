import { describe, expect, it } from "vitest";
import { buildActivitiesApiUrl, extractParticipatedBoardsFromActivityPages } from "./activitiesDiscovery";

describe("activitiesDiscovery", () => {
  it("builds the recents backend URL", () => {
    expect(buildActivitiesApiUrl("https://europa.klaxoon.com", 3, 25)).toBe(
      "https://europa.klaxoon.com/manager/api/v1/activities?page=3&perPage=25&hasSeen=true&sort=-lastAccessAt%2C%2Btitle"
    );
  });

  it("extracts unique board URLs from paginated activity payloads", () => {
    const boards = extractParticipatedBoardsFromActivityPages(
      [
        {
          items: [
            {
              id: "activity-1",
              type: "board",
              title: "EMC IT branch head",
              accessCode: "nu2rxfx",
              author: { displayName: "Arnaud P." }
            },
            {
              id: "activity-2",
              type: "quiz",
              title: "Ignore me",
              accessCode: "ABC123"
            },
            {
              id: "activity-3",
              type: "board",
              title: "Fallback board",
              webUrl: "https://europa.klaxoon.com/participate/board/GBKJJCQ",
              workspace: { name: "Delivery" }
            }
          ]
        },
        {
          items: [
            {
              id: "activity-1-duplicate",
              type: "board",
              title: "EMC IT branch head",
              accessCode: "NU2RXFX",
              author: { displayName: "Arnaud P." }
            }
          ]
        }
      ],
      "https://europa.klaxoon.com"
    );

    expect(boards).toEqual([
      {
        workspaceName: "Arnaud P.",
        boardName: "EMC IT branch head",
        boardUrl: "https://europa.klaxoon.com/participate/board/NU2RXFX",
        boardKey: "NU2RXFX",
        experienceType: "new",
        exportCapabilitiesDetected: false
      },
      {
        workspaceName: "Delivery",
        boardName: "Fallback board",
        boardUrl: "https://europa.klaxoon.com/participate/board/GBKJJCQ",
        boardKey: "GBKJJCQ",
        experienceType: "new",
        exportCapabilitiesDetected: false
      }
    ]);
  });
});
