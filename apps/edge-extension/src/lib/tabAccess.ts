export function isKlaxoonUrl(url: string | undefined): boolean {
  return typeof url === "string" && /^https:\/\/[^/]*klaxoon\.com\//i.test(url);
}

export function isHostPermissionErrorMessage(message: string | undefined): boolean {
  if (typeof message !== "string") {
    return false;
  }

  return /cannot access contents of (?:url|the page)|permission to access (?:the )?respective host|missing host permission/i.test(message);
}

export function formatPageAccessErrorMessage(tabUrl: string | undefined): string {
  if (!isKlaxoonUrl(tabUrl)) {
    return "Open a https://*.klaxoon.com board or Recent page first. The extension cannot read the enterprise SSO page or other non-Klaxoon tabs.";
  }

  return "The browser blocked access to this Klaxoon page. Reload the tab and try again.";
}

export function normalizeExtensionActionErrorMessage(message: string, tabUrl: string | undefined): string {
  if (message === "ACTIVE_TAB_NOT_KLAXOON_BOARD") {
    return formatPageAccessErrorMessage(tabUrl);
  }

  if (message === "NOT_SIGNED_IN_TO_KLAXOON") {
    return "Finish signing in on a https://*.klaxoon.com page, then retry the export.";
  }

  if (isHostPermissionErrorMessage(message)) {
    return formatPageAccessErrorMessage(tabUrl);
  }

  return message;
}
