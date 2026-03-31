import type { SelectorSet } from "./selectorRegistry";

export type ZoomMenuAction = "fit-board" | "detect-selection";

export type ZoomMenuActionResult = {
  ok: boolean;
  detail: string;
};

// Keep this self-contained because chrome.scripting.executeScript serializes the function into the page.
export async function runZoomMenuActionInPage(
  selectors: SelectorSet,
  action: ZoomMenuAction
): Promise<ZoomMenuActionResult> {
  const interactiveSelector = [
    "button",
    "[role='button']",
    "[role='menuitem']",
    "[role='menuitemradio']",
    "[role='option']",
    "[role='combobox']",
    "[aria-haspopup='menu']",
    "[aria-haspopup='listbox']",
    "[tabindex]:not([tabindex='-1'])",
    "a"
  ].join(", ");
  const contentSelector = `${interactiveSelector}, div, span, li`;
  const delay = (timeoutMs: number) => new Promise((resolve) => window.setTimeout(resolve, timeoutMs));
  const actionSpec =
    action === "fit-board"
      ? {
          label: "zoom-to-fit-board",
          missingDetail: "zoom-to-fit-option-not-found",
          selectors: selectors.zoomToFitBoardOption,
          hints: ["zoom to fit board", "fit board"]
        }
      : {
          label: "zoom-to-selection-detected",
          missingDetail: "zoom-to-selection-option-not-found",
          selectors: selectors.zoomToSelectionOption,
          hints: ["zoom to selection"]
        };

  const normalize = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

  const containsHint = (content: string, hints: string[]) => hints.some((hint) => content.includes(hint));

  const isVisible = (element: HTMLElement | null) => {
    if (!element || !element.isConnected || element.closest("[hidden], [aria-hidden='true']")) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width >= 6 && rect.height >= 6;
  };

  const getContent = (element: HTMLElement | null) =>
    normalize(
      [
        element?.innerText,
        element?.textContent,
        element?.getAttribute("aria-label"),
        element?.getAttribute("title"),
        element?.getAttribute("data-testid")
      ]
        .filter(Boolean)
        .join(" ")
    );

  const getRect = (element: HTMLElement | null) => element?.getBoundingClientRect();

  const isToolbarLike = (element: HTMLElement | null) => {
    if (!element) {
      return false;
    }

    if (element.closest("header, nav, [role='toolbar'], [class*='toolbar'], [data-testid*='toolbar']")) {
      return true;
    }

    const rect = getRect(element);
    return Boolean(rect && rect.top < Math.max(window.innerHeight * 0.35, 220));
  };

  const isActionableElement = (element: HTMLElement | null) =>
    Boolean(
      element &&
        (element.matches(interactiveSelector) ||
          element.tabIndex >= 0 ||
          element.hasAttribute("onclick") ||
          element.hasAttribute("role") ||
          element.hasAttribute("aria-haspopup"))
    );

  const toClickable = (candidate: HTMLElement | null) => {
    if (!candidate) {
      return null;
    }

    if (candidate.matches(interactiveSelector) && isVisible(candidate)) {
      return candidate;
    }

    const closestInteractive = candidate.closest<HTMLElement>(interactiveSelector);
    if (isVisible(closestInteractive)) {
      return closestInteractive;
    }

    const zoomContainer = candidate.closest<HTMLElement>("[data-testid*='zoom'], [class*='zoom'], [class*='Zoom']");
    if (isVisible(zoomContainer) && isActionableElement(zoomContainer)) {
      return zoomContainer;
    }

    return isVisible(candidate) && isActionableElement(candidate) ? candidate : null;
  };

  const collectMatches = (entries: string[], root: ParentNode = document) => {
    const matches: HTMLElement[] = [];
    const seen = new Set<HTMLElement>();

    for (const selector of entries) {
      for (const match of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
        const clickable = toClickable(match) ?? match;
        if (!seen.has(clickable) && isVisible(clickable)) {
          seen.add(clickable);
          matches.push(clickable);
        }
      }
    }

    return matches;
  };

  const describeElement = (element: HTMLElement) => {
    const tag = element.tagName.toLowerCase();
    const role = normalize(element.getAttribute("role"));
    const popup = normalize(element.getAttribute("aria-haspopup"));
    const testId = normalize(element.getAttribute("data-testid"));
    const content = getContent(element).slice(0, 60);
    return [tag, role && `role=${role}`, popup && `popup=${popup}`, testId && `testid=${testId}`, content]
      .filter(Boolean)
      .join(" ");
  };

  const collectDiagnostics = () => {
    const seen = new Set<HTMLElement>();
    const diagnostics: string[] = [];
    const toolbarCandidates = Array.from(document.querySelectorAll<HTMLElement>(contentSelector))
      .filter((candidate) => isVisible(candidate))
      .map((candidate) => toClickable(candidate) ?? candidate)
      .filter((candidate): candidate is HTMLElement => Boolean(candidate) && isVisible(candidate))
      .filter((candidate) => isToolbarLike(candidate));

    for (const candidate of toolbarCandidates) {
      if (seen.has(candidate)) {
        continue;
      }

      seen.add(candidate);
      diagnostics.push(describeElement(candidate));
      if (diagnostics.length >= 12) {
        break;
      }
    }

    return diagnostics.join(" | ").slice(0, 700);
  };

  const getInteractiveCandidates = () => {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(interactiveSelector)).filter((candidate) => isVisible(candidate));
    const seen = new Set<HTMLElement>();
    return candidates.filter((candidate) => {
      if (seen.has(candidate)) {
        return false;
      }

      seen.add(candidate);
      return true;
    });
  };

  const scoreTriggerCandidate = (candidate: HTMLElement) => {
    const clickable = toClickable(candidate);
    if (!clickable) {
      return -1;
    }

    const content = normalize(`${getContent(candidate)} ${getContent(clickable)}`);
    const role = normalize(clickable.getAttribute("role"));
    const popup = normalize(clickable.getAttribute("aria-haspopup"));
    const testId = normalize(clickable.getAttribute("data-testid"));
    let score = 0;

    if (containsHint(content, ["zoom"])) {
      score += 10;
    }
    if (/\b\d{1,3}\s*%/.test(content)) {
      score += 8;
    }
    if (containsHint(content, ["zoom level", "zoom menu"])) {
      score += 4;
    }
    if (popup === "menu" || popup === "listbox") {
      score += 4;
    }
    if (clickable.tagName.toLowerCase() === "button" || role === "button" || role === "combobox") {
      score += 3;
    }
    if (containsHint(testId, ["zoom"])) {
      score += 3;
    }
    if (isToolbarLike(clickable)) {
      score += 2;
    }
    if (containsHint(content, ["zoom to fit board", "zoom to selection", "fit board", "selection"])) {
      score -= 8;
    }
    if (containsHint(content, ["zoom in", "zoom out"])) {
      score -= 4;
    }
    if (containsHint(content, ["share", "profile", "comment", "participant", "present", "interaction", "undo"])) {
      score -= 3;
    }

    return score;
  };

  const getTriggerCandidates = () => {
    const ranked: Array<{ candidate: HTMLElement; score: number }> = [];
    const seen = new Set<HTMLElement>();
    const push = (candidate: HTMLElement | null, score: number) => {
      const clickable = toClickable(candidate);
      if (!clickable || seen.has(clickable) || !isVisible(clickable)) {
        return;
      }

      seen.add(clickable);
      ranked.push({ candidate: clickable, score });
    };

    for (const direct of collectMatches(selectors.zoomMenuButton)) {
      push(direct, 100);
    }

    for (const candidate of getInteractiveCandidates()) {
      const score = scoreTriggerCandidate(candidate);
      if (score >= 10) {
        push(candidate, score);
      }
    }

    for (const candidate of Array.from(document.querySelectorAll<HTMLElement>(contentSelector)).filter((item) => isVisible(item))) {
      const score = scoreTriggerCandidate(candidate);
      if (score >= 12) {
        push(candidate, score);
      }
    }

    return ranked
      .sort((left, right) => right.score - left.score)
      .map((entry) => entry.candidate)
      .slice(0, 8);
  };

  const scoreOptionCandidate = (candidate: HTMLElement) => {
    const clickable = toClickable(candidate);
    if (!clickable) {
      return -1;
    }

    const content = normalize(`${getContent(candidate)} ${getContent(clickable)}`);
    const role = normalize(clickable.getAttribute("role"));
    let score = 0;

    if (containsHint(content, actionSpec.hints)) {
      score += 16;
    }
    if (containsHint(content, ["zoom"])) {
      score += 4;
    }
    if (clickable.tagName.toLowerCase() === "button" || role === "menuitem" || role === "menuitemradio" || role === "option") {
      score += 4;
    }
    if (clickable.closest("[role='menu'], [role='listbox'], [role='dialog'], [class*='menu'], [class*='popover'], [class*='dropdown']")) {
      score += 4;
    }
    if (containsHint(content, ["share", "profile", "comment", "participant", "present"])) {
      score -= 4;
    }

    return score;
  };

  const findBestOptionCandidate = () => {
    const direct = collectMatches(actionSpec.selectors)[0];
    if (direct) {
      return direct;
    }

    const ranked: Array<{ candidate: HTMLElement; score: number }> = [];
    const seen = new Set<HTMLElement>();
    const allCandidates = Array.from(document.querySelectorAll<HTMLElement>(contentSelector)).filter((candidate) => isVisible(candidate));

    for (const candidate of allCandidates) {
      const clickable = toClickable(candidate);
      const score = scoreOptionCandidate(candidate);
      if (!clickable || score < 16 || seen.has(clickable)) {
        continue;
      }

      seen.add(clickable);
      ranked.push({ candidate: clickable, score });
    }

    return ranked.sort((left, right) => right.score - left.score)[0]?.candidate ?? null;
  };

  const waitForOption = async (timeoutMs: number) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const option = findBestOptionCandidate();
      if (option) {
        return option;
      }

      await delay(100);
    }

    return null;
  };

  const dismissTransientUi = async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await delay(120);
  };

  const activateCandidate = (candidate: HTMLElement) => {
    candidate.scrollIntoView({ block: "center", inline: "center" });
    candidate.focus?.();
    candidate.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    candidate.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    candidate.click();
  };

  const triggerCandidates = getTriggerCandidates();
  if (triggerCandidates.length === 0) {
    const diagnostics = collectDiagnostics();
    return {
      ok: false,
      detail: diagnostics ? `zoom-trigger-not-found; ${diagnostics}` : "zoom-trigger-not-found"
    };
  }

  for (const trigger of triggerCandidates) {
    activateCandidate(trigger);
    const option = await waitForOption(1_200);
    if (!option) {
      await dismissTransientUi();
      continue;
    }

    if (action === "fit-board") {
      activateCandidate(option);
      await delay(300);
      return { ok: true, detail: actionSpec.label };
    }

    await dismissTransientUi();
    return { ok: true, detail: actionSpec.label };
  }

  const diagnostics = collectDiagnostics();
  return {
    ok: false,
    detail: diagnostics ? `${actionSpec.missingDetail}; ${diagnostics}` : actionSpec.missingDetail
  };
}
