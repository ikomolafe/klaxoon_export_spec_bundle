export type SelectorSet = {
  boardReady: string[];
  zoomMenuButton: string[];
  zoomToSelectionOption: string[];
  zoomToFitBoardOption: string[];
  selectToolButton: string[];
  presentButton: string[];
  stopPresentingButton: string[];
  exportMenuButton: string[];
  exportZonesOption: string[];
  zonesDialog: string[];
  zoneSelectAllButton: string[];
  zoneCheckboxLabel: string[];
  zoneDialogFormatButton: string[];
  zoneDialogFormatSelect: string[];
  zoneDialogPdfOption: string[];
  zoneDialogPictureOption: string[];
  zoneDialogExportButton: string[];
  pdfOption: string[];
  pictureOption: string[];
  klxOption: string[];
  zipOption: string[];
  docxOption: string[];
};

// Keep selectors centralized because Klaxoon UI changes are the highest breakage risk.
export const selectorRegistry: Record<string, SelectorSet> = {
  default: {
    boardReady: ["[data-testid='board-root']", "main"],
    zoomMenuButton: [
      "button[aria-label*='Zoom']",
      "button[title*='Zoom']"
    ],
    zoomToSelectionOption: [
      "[role='menuitem'][aria-label*='Zoom to selection']",
      "[role='option'][aria-label*='Zoom to selection']"
    ],
    zoomToFitBoardOption: [
      "[role='menuitem'][aria-label*='Zoom to fit board']",
      "[role='option'][aria-label*='Zoom to fit board']"
    ],
    selectToolButton: [
      "button[aria-label*='Select']",
      "button[title*='Select']"
    ],
    presentButton: [
      "button[aria-label*='Present']",
      "button[title*='Present']"
    ],
    stopPresentingButton: [
      "button[aria-label*='Stop']",
      "button[title*='Stop']"
    ],
    exportMenuButton: [
      "button[aria-label*='Export']",
      "button[aria-label*='Download']",
      "button[title*='Export']",
      "button[title*='Download']",
      "[data-testid='export-menu-trigger']"
    ],
    exportZonesOption: [
      "[role='menuitem'][aria-label*='Zone']",
      "[role='menuitem'][aria-label*='Zones']",
      "[role='option'][aria-label*='Zone']",
      "[role='option'][aria-label*='Zones']",
      "[role='menuitem'][title*='Zone']",
      "[role='menuitem'][title*='Zones']",
      "[role='option'][title*='Zone']",
      "[role='option'][title*='Zones']"
    ],
    zonesDialog: [
      "[role='dialog']",
      "[aria-modal='true']",
      "[data-testid*='zone'][role='dialog']",
      "[data-testid*='export'][role='dialog']"
    ],
    zoneSelectAllButton: [
      "button[aria-label*='Select all']",
      "[role='button'][aria-label*='Select all']",
      "button[title*='Select all']"
    ],
    zoneCheckboxLabel: [
      "label.ui-toggle.ui-toggle--checkbox",
      ".checkbox-group label.ui-toggle--checkbox"
    ],
    zoneDialogFormatButton: [
      ".ui-select__button[aria-haspopup='listbox']",
      "button.ui-select__button"
    ],
    zoneDialogFormatSelect: [
      ".ui-select select",
      "select"
    ],
    zoneDialogPdfOption: [
      "[role='menuitem'][aria-label*='PDF']",
      "[role='option'][aria-label*='PDF']",
      "button[aria-label*='PDF']",
      "button[title*='PDF']"
    ],
    zoneDialogPictureOption: [
      "[role='menuitem'][aria-label*='Picture']",
      "[role='option'][aria-label*='Picture']",
      "[role='menuitem'][aria-label*='Snapshot']",
      "[role='option'][aria-label*='Snapshot']",
      "button[aria-label*='Picture']",
      "button[title*='Picture']",
      "button[aria-label*='Snapshot']",
      "button[title*='Snapshot']"
    ],
    zoneDialogExportButton: [
      "button[aria-label*='Export']",
      "[role='button'][aria-label*='Export']",
      "button[title*='Export']",
      "button[type='submit']"
    ],
    pdfOption: [
      "[role='menuitem'][data-format='pdf']",
      "button[data-format='pdf']",
      "[role='menuitemradio'][data-format='pdf']"
    ],
    pictureOption: [
      "[role='menuitem'][data-format='picture']",
      "button[data-format='picture']",
      "[role='menuitemradio'][data-format='picture']",
      "[role='menuitem'][data-format='image']",
      "button[data-format='image']",
      "[role='menuitemradio'][data-format='image']",
      "[role='menuitem'][data-format='snapshot']",
      "button[data-format='snapshot']",
      "[role='menuitemradio'][data-format='snapshot']"
    ],
    klxOption: [
      "[role='menuitem'][data-format='klx']",
      "button[data-format='klx']",
      "[role='menuitemradio'][data-format='klx']"
    ],
    zipOption: [
      "[role='menuitem'][data-format='zip']",
      "button[data-format='zip']",
      "[role='menuitemradio'][data-format='zip']"
    ],
    docxOption: [
      "[role='menuitem'][data-format='docx']",
      "button[data-format='docx']",
      "[role='menuitemradio'][data-format='docx']"
    ]
  }
};
