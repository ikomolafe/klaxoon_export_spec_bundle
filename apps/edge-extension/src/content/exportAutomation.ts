import { selectorRegistry } from "../lib/selectorRegistry";

function firstMatch(selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const match = document.querySelector<HTMLElement>(selector);
    if (match) {
      return match;
    }
  }
  return null;
}

export async function waitForBoardReady(timeoutMs = 15_000): Promise<boolean> {
  const selectors = selectorRegistry.default.boardReady;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (firstMatch(selectors)) {
      return true;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }

  return false;
}

export async function openExportMenu(): Promise<boolean> {
  const trigger = firstMatch(selectorRegistry.default.exportMenuButton);
  trigger?.click();
  return Boolean(trigger);
}
