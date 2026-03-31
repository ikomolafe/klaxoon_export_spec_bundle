/*
Copyright © 2026 KD Computers Ltd. All rights reserved.

This software and associated source code are proprietary and confidential to KD Computers Ltd.
Use, reproduction, modification, distribution, sublicensing, disclosure, or reverse engineering
is prohibited except as expressly permitted under a valid written licence agreement.

Governing law: England and Wales.
*/

export type ExportFormat = "pdf" | "klx" | "zip";

export function deriveBoardExportPlan(selectedFormats: ExportFormat[], hasZones: boolean) {
  const wantsPdf = selectedFormats.includes("pdf");

  return {
    runZonePdf: hasZones && wantsPdf,
    runZonePicture: false,
    runBoardFitPdf: wantsPdf,
    runBoardFitPicture: false,
    runBoardSelectionPdf: wantsPdf,
    runBoardSelectionPicture: false,
    boardFormats: selectedFormats.filter((format) => format !== "pdf")
  };
}
