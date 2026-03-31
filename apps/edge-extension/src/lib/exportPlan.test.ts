import { describe, expect, it } from "vitest";
import { deriveBoardExportPlan } from "./exportPlan";

describe("deriveBoardExportPlan", () => {
  it("runs only PDF zone and board backup passes when zones exist", () => {
    expect(deriveBoardExportPlan(["pdf", "klx", "zip"], true)).toEqual({
      runZonePdf: true,
      runZonePicture: false,
      runBoardFitPdf: true,
      runBoardFitPicture: false,
      runBoardSelectionPdf: true,
      runBoardSelectionPicture: false,
      boardFormats: ["klx", "zip"]
    });
  });

  it("runs only PDF board backup passes even when no zones exist", () => {
    expect(deriveBoardExportPlan(["pdf", "klx"], false)).toEqual({
      runZonePdf: false,
      runZonePicture: false,
      runBoardFitPdf: true,
      runBoardFitPicture: false,
      runBoardSelectionPdf: true,
      runBoardSelectionPicture: false,
      boardFormats: ["klx"]
    });
  });

  it("does not schedule PDF backup passes when pdf is not requested", () => {
    expect(deriveBoardExportPlan(["klx", "zip"], false)).toEqual({
      runZonePdf: false,
      runZonePicture: false,
      runBoardFitPdf: false,
      runBoardFitPicture: false,
      runBoardSelectionPdf: false,
      runBoardSelectionPicture: false,
      boardFormats: ["klx", "zip"]
    });
  });
});
