export const errorCodes = {
  helperUnavailable: "HELPER_UNAVAILABLE",
  notSignedIn: "NOT_SIGNED_IN",
  exportMenuMissing: "EXPORT_MENU_MISSING",
  pdfUnavailable: "PDF_UNAVAILABLE",
  downloadTimeout: "DOWNLOAD_TIMEOUT",
  invalidHelperResponse: "INVALID_HELPER_RESPONSE"
} as const;

export type ErrorCode = (typeof errorCodes)[keyof typeof errorCodes];
