import { describe, expect, it, vi } from "vitest";
import { probeKlaxoonSession } from "./session";

type ProbeResult = {
  signedIn: boolean;
  loginPage: boolean;
  currentUrl: string;
  responseUrl?: string;
  statusCode?: number;
  detail: string;
};

function createTabsApi(options: {
  preferredTab?: chrome.tabs.Tab;
  queryTabs?: chrome.tabs.Tab[];
}) {
  return {
    get: vi.fn(async (tabId: number) => {
      if (options.preferredTab?.id === tabId) {
        return options.preferredTab;
      }

      throw new Error(`unknown-tab-${tabId}`);
    }),
    query: vi.fn(async () => options.queryTabs ?? [])
  } as unknown as typeof chrome.tabs;
}

function createTab(id: number, url: string): chrome.tabs.Tab {
  return {
    id,
    url
  } as chrome.tabs.Tab;
}

function createScriptingApi(resultsByTabId: Record<number, ProbeResult>) {
  return {
    executeScript: vi.fn(async (injection: { target: { tabId: number } }) => [{
      result: resultsByTabId[injection.target.tabId]
    }])
  } as unknown as typeof chrome.scripting;
}

describe("probeKlaxoonSession", () => {
  it("keeps scanning Klaxoon tabs when the preferred tab is on the SSO provider", async () => {
    const tabsApi = createTabsApi({
      preferredTab: createTab(11, "https://login.microsoftonline.com/example"),
      queryTabs: [createTab(22, "https://europa.klaxoon.com/userspace/recent")]
    });
    const scriptingApi = createScriptingApi({
      22: {
        signedIn: true,
        loginPage: false,
        currentUrl: "https://europa.klaxoon.com/userspace/recent",
        responseUrl: "https://europa.klaxoon.com/manager/api/v1/activities?limit=1&offset=0",
        statusCode: 200,
        detail: "200 ok"
      }
    });

    const probe = await probeKlaxoonSession(
      { tabsApi, scriptingApi },
      { preferredTabId: 11 }
    );

    expect(probe).toMatchObject({
      signedIn: true,
      authStatus: "authenticated",
      authTabId: 22,
      tabUrl: "https://europa.klaxoon.com/userspace/recent"
    });
  });

  it("prefers an authenticated Klaxoon tab over a stale Klaxoon login tab", async () => {
    const tabsApi = createTabsApi({
      preferredTab: createTab(31, "https://europa.klaxoon.com/login"),
      queryTabs: [
        createTab(31, "https://europa.klaxoon.com/login"),
        createTab(32, "https://europa.klaxoon.com/participate/board/NU2RXFX")
      ]
    });
    const scriptingApi = createScriptingApi({
      31: {
        signedIn: false,
        loginPage: true,
        currentUrl: "https://europa.klaxoon.com/login",
        responseUrl: "https://europa.klaxoon.com/login",
        statusCode: 401,
        detail: "401 not-ok"
      },
      32: {
        signedIn: true,
        loginPage: false,
        currentUrl: "https://europa.klaxoon.com/participate/board/NU2RXFX",
        responseUrl: "https://europa.klaxoon.com/manager/api/v1/activities?limit=1&offset=0",
        statusCode: 200,
        detail: "200 ok"
      }
    });

    const probe = await probeKlaxoonSession(
      { tabsApi, scriptingApi },
      { preferredTabId: 31 }
    );

    expect(probe).toMatchObject({
      signedIn: true,
      authStatus: "authenticated",
      authTabId: 32,
      tabUrl: "https://europa.klaxoon.com/participate/board/NU2RXFX"
    });
  });

  it("returns login required when no preferred or open Klaxoon tab is authenticated", async () => {
    const tabsApi = createTabsApi({
      queryTabs: []
    });
    const scriptingApi = createScriptingApi({});

    const probe = await probeKlaxoonSession({ tabsApi, scriptingApi });

    expect(probe).toMatchObject({
      signedIn: false,
      authStatus: "login_required"
    });
  });
});
