import type { ExportCapabilities } from "@klaxoon/shared";

export function detectCapabilities(documentRoot: Document, selectors: Record<keyof ExportCapabilities, string[]>): ExportCapabilities {
  const hasAny = (entries: string[]) => entries.some((selector) => Boolean(documentRoot.querySelector(selector)));
  return {
    pdf: hasAny(selectors.pdf),
    klx: hasAny(selectors.klx),
    zip: hasAny(selectors.zip),
    docx: hasAny(selectors.docx)
  };
}
