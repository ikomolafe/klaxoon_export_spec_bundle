import { describe, expect, it } from "vitest";
import { inferBoardKey, normalizeBoardRecord } from "./discovery";

describe("discovery", () => {
  it("derives the participated board access code from the board URL", () => {
    const boardUrl = "https://europa.klaxoon.com/participate/board/NU2RXFX";

    expect(inferBoardKey(boardUrl)).toBe("NU2RXFX");
    expect(
      normalizeBoardRecord({
        workspaceName: "participated",
        boardName: "Example Board",
        boardUrl
      }).boardKey
    ).toBe("NU2RXFX");
  });
});
