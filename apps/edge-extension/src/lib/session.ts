import type { ReadinessResponse } from "@klaxoon/shared";

export type KlaxoonAuthStatus = NonNullable<ReadinessResponse["authStatus"]>;

export type KlaxoonAuthProbe = {
  signedIn: boolean;
  authStatus: KlaxoonAuthStatus;
  authMessage: string;
  authTabId?: number;
  tabUrl?: string;
  detail?: string;
};

type ProbeDependencies = {
  tabsApi: typeof chrome.tabs;
  scriptingApi: typeof chrome.scripting;
};

type ProbeOptions = {
  preferredTabId?: number;
};

type TabProbeResult = {
  signedIn: boolean;
  loginPage: boolean;
  currentUrl: string;
  responseUrl?: string;
  statusCode?: number;
  detail: string;
};

export const klaxoonEntryUrl = "https://europa.klaxoon.com/userspace/recent";

export async function probeKlaxoonSession(
  dependencies: ProbeDependencies,
  options: ProbeOptions = {}
): Promise<KlaxoonAuthProbe> {
  const preferredTab = await loadPreferredTab(dependencies.tabsApi, options.preferredTabId);
  let pendingProbe: KlaxoonAuthProbe | null = null;

  if (preferredTab) {
    if (isKlaxoonUrl(preferredTab.url)) {
      const preferredProbe = await probeKlaxoonTab(dependencies.scriptingApi, preferredTab.id!);
      if (preferredProbe.signedIn) {
        return {
          signedIn: true,
          authStatus: "authenticated",
          authMessage: "Klaxoon session verified.",
          authTabId: preferredTab.id,
          tabUrl: preferredProbe.currentUrl,
          detail: preferredProbe.detail
        };
      }

      pendingProbe = {
        signedIn: false,
        authStatus: "login_in_progress",
        authMessage: preferredProbe.loginPage
          ? "Continue the Klaxoon sign-in flow in the opened browser tab."
          : "Waiting for Klaxoon sign-in to complete in the opened browser tab.",
        authTabId: preferredTab.id,
        tabUrl: preferredTab.url,
        detail: preferredProbe.detail
      };
    } else {
      pendingProbe = {
        signedIn: false,
        authStatus: "login_in_progress",
        authMessage: "Continue the enterprise SSO flow in the opened browser tab.",
        authTabId: preferredTab.id,
        tabUrl: preferredTab.url,
        detail: `preferred-tab-non-klaxoon:${preferredTab.url ?? "unknown"}`
      };
    }
  }

  const tabs = await dependencies.tabsApi.query({ url: ["https://*.klaxoon.com/*"] });
  for (const tab of tabs) {
    if (typeof tab.id !== "number") {
      continue;
    }

    const probe = await probeKlaxoonTab(dependencies.scriptingApi, tab.id);
    if (probe.signedIn) {
      return {
        signedIn: true,
        authStatus: "authenticated",
        authMessage: "Klaxoon session verified.",
        authTabId: tab.id,
        tabUrl: probe.currentUrl,
        detail: probe.detail
      };
    }
  }

  if (pendingProbe) {
    return pendingProbe;
  }

  return {
    signedIn: false,
    authStatus: "login_required",
    authMessage: "Open Klaxoon sign-in to continue through the normal enterprise SSO page.",
    detail: "no-authenticated-klaxoon-tabs-found"
  };
}

async function loadPreferredTab(tabsApi: typeof chrome.tabs, preferredTabId: number | undefined) {
  if (typeof preferredTabId !== "number") {
    return undefined;
  }

  try {
    return await tabsApi.get(preferredTabId);
  } catch {
    return undefined;
  }
}

async function probeKlaxoonTab(scriptingApi: typeof chrome.scripting, tabId: number): Promise<TabProbeResult> {
  try {
    const [result] = await scriptingApi.executeScript({
      target: { tabId },
      world: "MAIN",
      func: async () => {
        const loginPage = /\/login\b/i.test(location.pathname) || /signin|login/i.test(location.href);
        const probeTargets = [
          {
            label: "recent",
            url: `${location.origin}/userspace/recent`,
            accept: "text/html,application/xhtml+xml"
          },
          {
            label: "activities",
            url: `${location.origin}/manager/api/v1/activities?limit=1&offset=0`,
            accept: "application/json"
          }
        ];

        let lastResult = {
          signedIn: false,
          loginPage,
          currentUrl: location.href,
          detail: "probe-unavailable"
        };

        for (const target of probeTargets) {
          try {
            const response = await fetch(target.url, {
              method: "GET",
              credentials: "include",
              headers: {
                accept: target.accept
              }
            });

            const landedOnLogin = /\/login\b/i.test(response.url) || /signin|login/i.test(response.url);
            const signedIn = response.ok && !landedOnLogin;
            const candidate = {
              signedIn,
              loginPage,
              currentUrl: location.href,
              responseUrl: response.url,
              statusCode: response.status,
              detail: `${target.label}:${response.status} ${response.ok ? "ok" : "not-ok"} ${response.url}`
            };

            if (signedIn) {
              return candidate;
            }

            lastResult = candidate;
          } catch (error) {
            lastResult = {
              signedIn: false,
              loginPage,
              currentUrl: location.href,
              detail: `${target.label}: ${error instanceof Error ? error.message : String(error)}`
            };
          }
        }

        return lastResult;
      }
    });

    return result?.result ?? {
      signedIn: false,
      loginPage: false,
      currentUrl: "",
      detail: "probe-unavailable"
    };
  } catch (error) {
    return {
      signedIn: false,
      loginPage: false,
      currentUrl: "",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

function isKlaxoonUrl(url: string | undefined): boolean {
  return typeof url === "string" && /^https:\/\/[^/]*klaxoon\.com\//i.test(url);
}
