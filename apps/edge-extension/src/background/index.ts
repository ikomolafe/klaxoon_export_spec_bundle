/*
Copyright © 2026 KD Computers Ltd. All rights reserved.

This software and associated source code are proprietary and confidential to KD Computers Ltd.
Use, reproduction, modification, distribution, sublicensing, disclosure, or reverse engineering
is prohibited except as expressly permitted under a valid written licence agreement.

Governing law: England and Wales.
*/

import {
  type ExportCapabilities,
  type ReadinessResponse,
  type RunManifest
} from "@klaxoon/shared";
import { buildActivitiesApiUrl, extractParticipatedBoardsFromActivityPages } from "../lib/activitiesDiscovery";
import { inferBoardKey, isKlaxoonBoardUrl, normalizeBoardRecord } from "../lib/discovery";
import { correlateDownload } from "../lib/downloadCorrelation";
import { deriveBoardExportPlan, type ExportFormat } from "../lib/exportPlan";
import {
  captureExportNetwork,
  deleteLearnedExportRecipe,
  hasLearnedExportRecipe,
  loadLearnedExportRecipe,
  replayLearnedExportRecipe,
  saveLearnedExportRecipe
} from "../lib/exportNetworkRuntime";
import {
  learnExportRecipe,
  type ExportTemplateContext,
  type RuntimeExportFormat,
  type RuntimeExportMode
} from "../lib/exportNetworkRecipe";
import { pingHelper, sendHelperMessage } from "../lib/helperClient";
import { selectorRegistry, type SelectorSet } from "../lib/selectorRegistry";
import { klaxoonEntryUrl, probeKlaxoonSession, type KlaxoonAuthStatus } from "../lib/session";
import { isKlaxoonUrl, normalizeExtensionActionErrorMessage } from "../lib/tabAccess";
import { runZoomMenuActionInPage } from "../lib/zoomMenuAutomation";

type ManifestArtifactEntry = {
  id: string;
  label: string;
  format: "pdf" | "picture";
  mode: "zones" | "board-fit" | "board-selection";
  status: "done" | "failed" | "skipped";
  file?: string;
  reason?: string;
  delivery?: "replay" | "trigger";
};

type ManifestBoardEntry = RunManifest["boards"][number] & {
  artifacts?: ManifestArtifactEntry[];
};

type ExtensionMessage =
  | { type: "readiness_check" }
  | { type: "start_klaxoon_login" }
  | { type: "get_export_session" }
  | { type: "pause_export" }
  | { type: "resume_export" }
  | { type: "stop_export" }
  | { type: "restart_export" }
  | { type: "choose_output_root" }
  | { type: "start_export"; outputRoot?: string; formats?: ExportFormat[]; zipPackage?: boolean }
  | { type: "start_bulk_export"; outputRoot?: string; formats?: ExportFormat[]; zipPackage?: boolean };

type BulkExportBoardProgress = {
  boardKey: string;
  boardName: string;
  workspaceName: string;
  status: "queued" | "running" | "completed" | "failed" | "skipped";
  detail?: string;
};

type BulkExportProgress = {
  runId: string;
  phase: "discovering" | "running" | "paused" | "stopped" | "completed" | "failed";
  totalBoards: number;
  completedBoards: number;
  failedBoards: number;
  currentBoardKey?: string;
  currentBoardName?: string;
  message: string;
  boards: BulkExportBoardProgress[];
};

type ExportSessionPhase = "discovering" | "running" | "paused" | "stopped" | "completed" | "failed";

type ExportSessionState = {
  runId: string;
  scope: "current" | "participated";
  phase: ExportSessionPhase;
  message: string;
  zipPackage: boolean;
  outputRoot: string;
  requestedOutputRoot?: string;
  requestedFormats: ExportFormat[];
  runRoot?: string;
  archivePath?: string;
  totalBoards: number;
  completedBoards: number;
  failedBoards: number;
  currentBoardKey?: string;
  currentBoardName?: string;
  boards: BulkExportBoardProgress[];
  startedAt: string;
  updatedAt: string;
};

type ExtensionActionResponse = {
  ok: boolean;
  message?: string;
  outputRoot?: string;
  archivePath?: string;
  runRoot?: string;
  authTabId?: number;
};

type AuthSessionState = {
  status: KlaxoonAuthStatus;
  message: string;
  tabId?: number;
  tabUrl?: string;
  startedAt: string;
  updatedAt: string;
};

type FormatExecutionResult = {
  format: ExportFormat;
  status: "done" | "failed" | "skipped";
  file?: string;
  reason?: string;
};

type ArtifactExecutionResult = ManifestArtifactEntry;

type TriggerExportResult = {
  ok: boolean;
  reason?: string;
  details?: string;
};

type RunPreparedResponse = {
  ok: true;
  type: "runPrepared";
  runRoot: string;
  outputRoot: string;
};

type PresenterModeState = {
  active: boolean;
  entered: boolean;
};

type PreparedExportRun = {
  selectedFormats: ExportFormat[];
  packageAsZip: boolean;
  requestedOutputRoot?: string;
  runId: string;
  prepared: RunPreparedResponse;
};

type ZoneRecord = {
  zoneName: string;
  zoneKey: string;
  index: number;
};

type ZoneDiscoveryResult = {
  available: boolean;
  zones: ZoneRecord[];
  detail: string;
};

type ZoneExportKind = "pdf" | "picture";
type TriggerableExportFormat = ExportFormat | "picture";

type BoardExportResult = {
  manifestBoard: ManifestBoardEntry;
  results: FormatExecutionResult[];
};

type ExportRunResult = {
  runRoot: string;
  archivePath?: string;
  exportedFormats: ExportFormat[];
  failedFormats: ExportFormat[];
  skippedFormats: ExportFormat[];
  boardCount: number;
  completedBoardCount: number;
  blankBoardCount: number;
};

const exportFormatOrder: ExportFormat[] = ["pdf", "klx", "zip"];
const recentBoardsUrl = "https://europa.klaxoon.com/userspace/recent";
const activeExportSessionStorageKey = "klaxoon-active-export-session";
const authSessionStorageKey = "klaxoon-auth-session";
const exportSessionStorageArea = chrome.storage.local;
const authStatusValues: KlaxoonAuthStatus[] = [
  "checking",
  "login_required",
  "login_in_progress",
  "authenticated",
  "login_failed"
];

const runtimeExportConfig: Record<
  TriggerableExportFormat,
  {
    selectorKey: keyof Pick<SelectorSet, "pdfOption" | "pictureOption" | "klxOption" | "zipOption">;
    extension: string;
    filenameHints: string[];
    optionHints: string[];
  }
> = {
  pdf: {
    selectorKey: "pdfOption",
    extension: "pdf",
    filenameHints: ["pdf"],
    optionHints: ["pdf"]
  },
  picture: {
    selectorKey: "pictureOption",
    extension: "zip",
    filenameHints: ["picture", "snapshot", "gallery", "image", "png", "jpg", "jpeg", "zip"],
    optionHints: ["picture", "snapshot", "gallery", "image"]
  },
  klx: {
    selectorKey: "klxOption",
    extension: "klx",
    filenameHints: ["klx"],
    optionHints: ["klx"]
  },
  zip: {
    selectorKey: "zipOption",
    extension: "zip",
    filenameHints: ["zip"],
    optionHints: ["zip", "archive"]
  }
};

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onStartup.addListener(() => {
  void handleBrowserStartup();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.status && !changeInfo.url) {
    return;
  }

  void reconcileAuthSessionForTab(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void handleAuthTabRemoved(tabId);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "readiness_check") {
    void (async () => {
      sendResponse(await buildReadinessResponse());
    })();

    return true;
  }

  if (message?.type === "start_klaxoon_login") {
    void respondWithAction(async () => {
      const readiness = await buildReadinessResponse();
      if (readiness.signedIn) {
        return {
          ok: true,
          message: readiness.authMessage ?? "Klaxoon session already verified.",
          authTabId: readiness.authTabId
        };
      }

      const authSession = await beginKlaxoonLogin();
      return {
        ok: true,
        message: authSession.message,
        authTabId: authSession.tabId
      };
    }, sendResponse);

    return true;
  }

  if (message?.type === "get_export_session") {
    void (async () => {
      sendResponse(await loadExportSession());
    })();

    return true;
  }

  if (message?.type === "choose_output_root") {
    void respondWithAction(async () => {
      const response = await sendHelperMessage({
        type: "chooseOutputRoot"
      });

      if (!response.ok || response.type !== "outputRootChosen" || typeof response.outputRoot !== "string") {
        throw new Error(response.ok ? "OUTPUT_ROOT_PICK_FAILED" : response.message);
      }

      return {
        ok: true,
        outputRoot: response.outputRoot,
        message: `Output folder selected: ${response.outputRoot}`
      };
    }, sendResponse);

    return true;
  }

  if (message?.type === "pause_export") {
    void respondWithAction(async () => {
      const session = await updateExportSessionPhase("paused");
      if (!session) {
        throw new Error("NO_ACTIVE_EXPORT_SESSION");
      }

      return {
        ok: true,
        message: "Pause requested. The current board will finish before the run pauses.",
        archivePath: session.archivePath,
        runRoot: session.runRoot
      };
    }, sendResponse);

    return true;
  }

  if (message?.type === "resume_export") {
    void respondWithAction(async () => {
      const session = await updateExportSessionPhase("running");
      if (!session) {
        throw new Error("NO_EXPORT_SESSION_TO_RESUME");
      }

      return {
        ok: true,
        message: "Export resumed.",
        archivePath: session.archivePath,
        runRoot: session.runRoot
      };
    }, sendResponse);

    return true;
  }

  if (message?.type === "stop_export") {
    void respondWithAction(async () => {
      const session = await updateExportSessionPhase("stopped");
      if (!session) {
        throw new Error("NO_ACTIVE_EXPORT_SESSION");
      }

      return {
        ok: true,
        message: "Stop requested. The current board will finish before the run stops.",
        archivePath: session.archivePath,
        runRoot: session.runRoot
      };
    }, sendResponse);

    return true;
  }

  if (message?.type === "restart_export") {
    void respondWithAction(async () => {
      const activeSession = await loadActiveExportSession();
      if (activeSession) {
        return mapExportSessionToActionResponse(activeSession);
      }

      const session = await loadExportSession();
      if (!session) {
        throw new Error("NO_EXPORT_SESSION_TO_RESTART");
      }

      const result = session.scope === "participated"
        ? await exportParticipatedBoards(session.requestedOutputRoot, session.requestedFormats, session.zipPackage)
        : await exportCurrentBoard(session.requestedOutputRoot, session.requestedFormats, session.zipPackage);

      return {
        ok: true,
        message: `${session.scope === "participated" ? "Bulk" : "Board"} PDF export restarted: ${result.completedBoardCount}/${result.boardCount} boards${result.archivePath ? "; zip package ready" : ""}`,
        archivePath: result.archivePath,
        runRoot: result.runRoot
      };
    }, sendResponse);

    return true;
  }

  if (message?.type === "start_export") {
    void respondWithAction(async () => {
      const activeSession = await loadActiveExportSession();
      if (activeSession) {
        return mapExportSessionToActionResponse(activeSession);
      }

      const result = await exportCurrentBoard(message.outputRoot, message.formats, message.zipPackage);
      return {
        ok: true,
        message: `PDF export completed: ${result.completedBoardCount}/${result.boardCount} boards${result.failedFormats.length > 0 ? `; failed formats: ${result.failedFormats.join(", ")}` : ""}${result.blankBoardCount > 0 ? `; blank boards skipped: ${result.blankBoardCount}` : ""}${result.archivePath ? "; zip package ready" : "; zip package disabled"}`,
        archivePath: result.archivePath,
        runRoot: result.runRoot
      };
    }, sendResponse);

    return true;
  }

  if (message?.type === "start_bulk_export") {
    void respondWithAction(async () => {
      const activeSession = await loadActiveExportSession();
      if (activeSession) {
        return mapExportSessionToActionResponse(activeSession);
      }

      const result = await exportParticipatedBoards(message.outputRoot, message.formats, message.zipPackage);
      return {
        ok: true,
        message: `Bulk PDF export completed: ${result.completedBoardCount}/${result.boardCount} boards${result.failedFormats.length > 0 ? `; failed formats: ${result.failedFormats.join(", ")}` : ""}${result.blankBoardCount > 0 ? `; blank boards skipped: ${result.blankBoardCount}` : ""}${result.archivePath ? "; zip package ready" : "; zip package disabled"}`,
        archivePath: result.archivePath,
        runRoot: result.runRoot
      };
    }, sendResponse);

    return true;
  }

  return false;
});

async function respondWithAction(
  action: () => Promise<ExtensionActionResponse>,
  sendResponse: (response: ExtensionActionResponse) => void
) {
  try {
    sendResponse(await action());
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "UNKNOWN_HELPER_ERROR";
    const activeTabUrl = (await getActiveWindowTab().catch(() => undefined))?.url;
    const message = normalizeExtensionActionErrorMessage(rawMessage, activeTabUrl);
    await logHelperMessage(message === rawMessage ? rawMessage : `${message} | raw=${rawMessage}`);
    sendResponse({
      ok: false,
      message
    });
  }
}

async function buildReadinessResponse(): Promise<ReadinessResponse> {
  const helperConnected = await pingHelper();
  const existingAuthSession = await loadAuthSession();
  const probe = await probeKlaxoonSession(
    {
      tabsApi: chrome.tabs,
      scriptingApi: chrome.scripting
    },
    {
      preferredTabId: existingAuthSession?.tabId
    }
  );

  const authSession = resolveAuthSessionState(existingAuthSession, probe);
  if (shouldLogAuthSessionTransition(existingAuthSession, authSession)) {
    await logHelperMessage(
      `auth session -> ${authSession.status}: ${probe.detail ?? authSession.message}${authSession.tabUrl ? ` @ ${authSession.tabUrl}` : ""}`
    );
  }
  await saveAuthSession(authSession);

  return {
    helperConnected,
    signedIn: probe.signedIn,
    authStatus: authSession.status,
    authMessage: authSession.message,
    authTabId: authSession.tabId
  };
}

async function beginKlaxoonLogin(): Promise<AuthSessionState> {
  const existing = await loadAuthSession();
  if (typeof existing?.tabId === "number") {
    const existingTab = await chrome.tabs.get(existing.tabId).catch(() => undefined);
    if (existingTab?.id !== undefined) {
      await chrome.tabs.update(existingTab.id, { active: true }).catch(() => undefined);
      const resumedSession: AuthSessionState = {
        ...existing,
        status: "login_in_progress",
        message: isKlaxoonUrl(existingTab.url)
          ? "Continue the Klaxoon sign-in flow in the opened browser tab."
          : "Continue the enterprise SSO flow in the opened browser tab.",
        tabUrl: existingTab.url,
        updatedAt: new Date().toISOString()
      };
      await saveAuthSession(resumedSession);
      return resumedSession;
    }
  }

  const createdTab = await chrome.tabs.create({
    url: klaxoonEntryUrl,
    active: true
  });
  const now = new Date().toISOString();
  const authSession: AuthSessionState = {
    status: "login_in_progress",
    message: "Continue the enterprise SSO flow in the opened browser tab.",
    tabId: createdTab.id,
    tabUrl: createdTab.url,
    startedAt: existing?.startedAt ?? now,
    updatedAt: now
  };

  await saveAuthSession(authSession);
  return authSession;
}

async function loadAuthSession(): Promise<AuthSessionState | null> {
  const stored = await chrome.storage.session.get([authSessionStorageKey]);
  const candidate = stored[authSessionStorageKey];
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const session = candidate as Partial<AuthSessionState>;
  if (!isKlaxoonAuthStatus(session.status) || typeof session.message !== "string") {
    return null;
  }

  return {
    status: session.status,
    message: session.message,
    tabId: typeof session.tabId === "number" ? session.tabId : undefined,
    tabUrl: typeof session.tabUrl === "string" ? session.tabUrl : undefined,
    startedAt: typeof session.startedAt === "string" ? session.startedAt : new Date().toISOString(),
    updatedAt: typeof session.updatedAt === "string" ? session.updatedAt : new Date().toISOString()
  };
}

async function saveAuthSession(session: AuthSessionState | null) {
  if (session) {
    await chrome.storage.session.set({
      [authSessionStorageKey]: session
    });
  } else {
    await chrome.storage.session.remove(authSessionStorageKey);
  }

  try {
    await chrome.runtime.sendMessage({
      type: "auth_session_updated",
      session
    });
  } catch {
    // Ignore when no side panel listener is attached.
  }
}

function resolveAuthSessionState(
  existing: AuthSessionState | null,
  probe: Awaited<ReturnType<typeof probeKlaxoonSession>>
): AuthSessionState {
  const now = new Date().toISOString();
  if (probe.signedIn) {
    return {
      status: "authenticated",
      message: probe.authMessage,
      tabId: probe.authTabId,
      tabUrl: probe.tabUrl,
      startedAt: existing?.startedAt ?? now,
      updatedAt: now
    };
  }

  if (existing?.status === "login_in_progress" && probe.authStatus === "login_required") {
    return {
      status: "login_failed",
      message: "Sign-in tab was closed before authentication completed.",
      startedAt: existing.startedAt,
      updatedAt: now
    };
  }

  return {
    status: probe.authStatus,
    message: probe.authMessage,
    tabId: probe.authTabId,
    tabUrl: probe.tabUrl,
    startedAt: existing?.startedAt ?? now,
    updatedAt: now
  };
}

function isKlaxoonAuthStatus(value: unknown): value is KlaxoonAuthStatus {
  return typeof value === "string" && authStatusValues.includes(value as KlaxoonAuthStatus);
}

function shouldLogAuthSessionTransition(
  previous: AuthSessionState | null,
  next: AuthSessionState
): boolean {
  return (
    previous?.status !== next.status ||
    previous?.message !== next.message ||
    previous?.tabId !== next.tabId ||
    previous?.tabUrl !== next.tabUrl
  );
}

async function reconcileAuthSessionForTab(tabId: number) {
  const authSession = await loadAuthSession();
  if (!authSession) {
    return;
  }

  if (authSession.tabId !== tabId && authSession.status !== "login_in_progress") {
    return;
  }

  await buildReadinessResponse().catch(() => undefined);
}

async function handleAuthTabRemoved(tabId: number) {
  const authSession = await loadAuthSession();
  if (!authSession || authSession.tabId !== tabId) {
    return;
  }

  if (authSession.status === "login_in_progress") {
    await saveAuthSession({
      ...authSession,
      status: "login_failed",
      message: "Sign-in tab was closed before authentication completed.",
      tabId: undefined,
      tabUrl: undefined,
      updatedAt: new Date().toISOString()
    });
    return;
  }

  await saveAuthSession({
    ...authSession,
    tabId: undefined,
    tabUrl: undefined,
    updatedAt: new Date().toISOString()
  });
}

async function handleBrowserStartup() {
  const exportSession = await loadExportSession();
  if (exportSession && !isTerminalExportSessionPhase(exportSession.phase)) {
    await saveExportSession({
      ...exportSession,
      phase: "stopped",
      message: "The previous browser session ended before the export completed. Use Restart from beginning to start a new run.",
      updatedAt: new Date().toISOString()
    });
  }

  const authSession = await loadAuthSession();
  if (authSession?.status === "login_in_progress") {
    await saveAuthSession({
      ...authSession,
      status: "login_failed",
      message: "Browser restart interrupted the sign-in flow. Open Klaxoon sign-in again if needed.",
      tabId: undefined,
      tabUrl: undefined,
      updatedAt: new Date().toISOString()
    });
  }
}

async function exportCurrentBoard(
  outputRoot: string | undefined,
  requestedFormats: ExportFormat[] | undefined,
  zipPackage: boolean | undefined
) {
  const readiness = await buildReadinessResponse();
  if (!readiness.signedIn) {
    throw new Error("NOT_SIGNED_IN_TO_KLAXOON");
  }

  const preparedRun = await prepareExportRun(outputRoot, requestedFormats, zipPackage);
  const tab = await getActiveKlaxoonTab();
  const tabId = tab.id;
  if (tabId === undefined) {
    throw new Error("ACTIVE_TAB_UNAVAILABLE");
  }

  const board = normalizeBoardRecord({
    workspaceName: "klaxoon",
    boardName: deriveBoardName(tab.title, tab.url ?? ""),
    boardUrl: tab.url ?? ""
  });

  await saveExportSession({
    runId: preparedRun.runId,
    scope: "current",
    phase: "running",
    message: `Exporting ${board.boardName}...`,
    zipPackage: preparedRun.packageAsZip,
    outputRoot: preparedRun.prepared.outputRoot,
    requestedOutputRoot: preparedRun.requestedOutputRoot,
    requestedFormats: preparedRun.selectedFormats,
    runRoot: preparedRun.prepared.runRoot,
    totalBoards: 1,
    completedBoards: 0,
    failedBoards: 0,
    currentBoardKey: board.boardKey,
    currentBoardName: board.boardName,
    boards: [{
      boardKey: board.boardKey,
      boardName: board.boardName,
      workspaceName: board.workspaceName,
      status: "running"
    }],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  try {
    await appendHelperLog(preparedRun.runId, preparedRun.prepared.outputRoot, `run started for ${board.boardName}`);
    const boardResult = await exportBoardAtTab({
      tabId,
      runId: preparedRun.runId,
      outputRoot: preparedRun.prepared.outputRoot,
      board,
      selectedFormats: preparedRun.selectedFormats
    });

    const finalized = await finalizeExportRun(preparedRun, [boardResult]);
    await saveExportSession({
      runId: preparedRun.runId,
      scope: "current",
      phase: "completed",
      message: finalized.archivePath
        ? `Export finished. Zip package ready for ${board.boardName}.`
        : `Export finished for ${board.boardName}.`,
      zipPackage: preparedRun.packageAsZip,
      outputRoot: preparedRun.prepared.outputRoot,
      requestedOutputRoot: preparedRun.requestedOutputRoot,
      requestedFormats: preparedRun.selectedFormats,
      runRoot: finalized.runRoot,
      archivePath: finalized.archivePath,
      totalBoards: 1,
      completedBoards: finalized.completedBoardCount,
      failedBoards: finalized.failedFormats.length > 0 ? 1 : 0,
      currentBoardKey: board.boardKey,
      currentBoardName: board.boardName,
      boards: [{
        boardKey: board.boardKey,
        boardName: board.boardName,
        workspaceName: board.workspaceName,
        status: boardResult.results.some((entry) => entry.status === "done") ? "completed" : "failed",
        detail: summarizeFormatResults(boardResult.results)
      }],
      startedAt: (await loadExportSession())?.startedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    return finalized;
  } catch (error) {
    await saveExportSession({
      runId: preparedRun.runId,
      scope: "current",
      phase: "failed",
      message: error instanceof Error ? error.message : "Current board export failed.",
      zipPackage: preparedRun.packageAsZip,
      outputRoot: preparedRun.prepared.outputRoot,
      requestedOutputRoot: preparedRun.requestedOutputRoot,
      requestedFormats: preparedRun.selectedFormats,
      runRoot: preparedRun.prepared.runRoot,
      totalBoards: 1,
      completedBoards: 0,
      failedBoards: 1,
      currentBoardKey: board.boardKey,
      currentBoardName: board.boardName,
      boards: [{
        boardKey: board.boardKey,
        boardName: board.boardName,
        workspaceName: board.workspaceName,
        status: "failed",
        detail: error instanceof Error ? error.message : "Current board export failed."
      }],
      startedAt: (await loadExportSession())?.startedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    throw error;
  }
}

async function exportParticipatedBoards(
  outputRoot: string | undefined,
  requestedFormats: ExportFormat[] | undefined,
  zipPackage: boolean | undefined
) {
  const readiness = await buildReadinessResponse();
  if (!readiness.signedIn) {
    throw new Error("NOT_SIGNED_IN_TO_KLAXOON");
  }

  const preparedRun = await prepareExportRun(outputRoot, requestedFormats, zipPackage);
  const originalTab = await getActiveWindowTab();
  const workerTab = await chrome.tabs.create({
    url: recentBoardsUrl,
    active: true,
    windowId: originalTab?.windowId
  });

  const workerTabId = workerTab.id;
  if (workerTabId === undefined) {
    throw new Error("WORKER_TAB_UNAVAILABLE");
  }

  const syncProgress = async (progress: BulkExportProgress, archivePath?: string) => {
    await saveParticipatedExportSession(preparedRun, progress, archivePath);
    await emitBulkExportProgress(progress);
  };
  let stoppedByUser = false;

  try {
    await syncProgress({
      runId: preparedRun.runId,
      phase: "discovering",
      totalBoards: 0,
      completedBoards: 0,
      failedBoards: 0,
      message: "Opening Recent and discovering participated boards...",
      boards: []
    });

    await waitForTabComplete(workerTabId, recentBoardsUrl);
    const boards = uniqueParticipatedBoards(await discoverParticipatedBoards(workerTabId));
    if (boards.length === 0) {
      await syncProgress({
        runId: preparedRun.runId,
        phase: "failed",
        totalBoards: 0,
        completedBoards: 0,
        failedBoards: 0,
        message: "No participated boards were discovered.",
        boards: []
      });
      throw new Error("NO_PARTICIPATED_BOARDS_DISCOVERED");
    }

    await appendHelperLog(
      preparedRun.runId,
      preparedRun.prepared.outputRoot,
      `bulk discovery found ${boards.length} unique participated boards`
    );

    const progressBoards: BulkExportBoardProgress[] = boards.map((board) => ({
      boardKey: board.boardKey,
      boardName: board.boardName,
      workspaceName: board.workspaceName,
      status: "queued"
    }));
    await syncProgress({
      runId: preparedRun.runId,
      phase: "running",
      totalBoards: progressBoards.length,
      completedBoards: 0,
      failedBoards: 0,
      message: `Discovered ${progressBoards.length} unique participated boards. Starting export...`,
      boards: progressBoards
    });

    const boardResults: BoardExportResult[] = [];
    for (const [index, board] of boards.entries()) {
      const permission = await waitForBulkRunPermission(preparedRun.runId);
      if (permission === "stopped") {
        stoppedByUser = true;
        break;
      }

      const progressBoard = progressBoards.find((entry) => entry.boardKey === board.boardKey);
      if (progressBoard) {
        progressBoard.status = "running";
        delete progressBoard.detail;
      }

      await appendHelperLog(
        preparedRun.runId,
        preparedRun.prepared.outputRoot,
        `opening board ${board.boardName} (${index + 1}/${boards.length})`
      );
      await syncProgress({
        runId: preparedRun.runId,
        phase: "running",
        totalBoards: progressBoards.length,
        completedBoards: countProgressBoards(progressBoards, "completed", "skipped"),
        failedBoards: countProgressBoards(progressBoards, "failed"),
        currentBoardKey: board.boardKey,
        currentBoardName: board.boardName,
        message: `Opening ${board.boardName} (${index + 1}/${boards.length})`,
        boards: progressBoards
      });

      try {
        await chrome.tabs.update(workerTabId, { url: board.boardUrl, active: true });
        await waitForTabComplete(workerTabId, board.boardUrl);

        const boardResult = await exportBoardAtTab({
          tabId: workerTabId,
          runId: preparedRun.runId,
          outputRoot: preparedRun.prepared.outputRoot,
          board,
          selectedFormats: preparedRun.selectedFormats
        });

        boardResults.push(boardResult);
        if (progressBoard) {
          progressBoard.status = boardResult.results.some((entry) => entry.status === "done")
            ? "completed"
            : boardResult.results.every((entry) => entry.status === "skipped")
              ? "skipped"
              : "failed";
          progressBoard.detail = summarizeFormatResults(boardResult.results);
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : "UNKNOWN_BOARD_EXPORT_ERROR";
        await appendHelperLog(
          preparedRun.runId,
          preparedRun.prepared.outputRoot,
          `board failed: ${board.boardName} (${reason})`
        );

        boardResults.push(createFailedBoardResult(board, preparedRun.selectedFormats, reason));
        if (progressBoard) {
          progressBoard.status = "failed";
          progressBoard.detail = reason;
        }
      }

      const currentSession = await loadExportSession();
      const isSameRun = currentSession?.runId === preparedRun.runId;
      if (isSameRun && currentSession.phase === "stopped") {
        stoppedByUser = true;
        break;
      }

      if (index < boards.length - 1 && isSameRun && currentSession.phase === "paused") {
        const postBoardPermission = await waitForBulkRunPermission(preparedRun.runId);
        if (postBoardPermission === "stopped") {
          stoppedByUser = true;
          break;
        }
      }

      await syncProgress({
        runId: preparedRun.runId,
        phase: "running",
        totalBoards: progressBoards.length,
        completedBoards: countProgressBoards(progressBoards, "completed", "skipped"),
        failedBoards: countProgressBoards(progressBoards, "failed"),
        currentBoardKey: board.boardKey,
        currentBoardName: board.boardName,
        message: `Processed ${index + 1}/${boards.length} boards`,
        boards: progressBoards
      });
    }

    if (stoppedByUser) {
      const hasCompletedExports = boardResults.some((result) => result.results.some((entry) => entry.status === "done"));
      const stoppedMessage = hasCompletedExports
        ? "Export stopped. Partial results were kept."
        : "Export stopped before any boards produced files.";

      if (hasCompletedExports) {
        const finalized = await finalizeExportRun(preparedRun, boardResults);
        await syncProgress({
          runId: preparedRun.runId,
          phase: "stopped",
          totalBoards: progressBoards.length,
          completedBoards: countProgressBoards(progressBoards, "completed", "skipped"),
          failedBoards: countProgressBoards(progressBoards, "failed"),
          message: stoppedMessage,
          boards: progressBoards
        }, finalized.archivePath);

        return finalized;
      }

      await syncProgress({
        runId: preparedRun.runId,
        phase: "stopped",
        totalBoards: progressBoards.length,
        completedBoards: countProgressBoards(progressBoards, "completed", "skipped"),
        failedBoards: countProgressBoards(progressBoards, "failed"),
        message: stoppedMessage,
        boards: progressBoards
      });

      return {
        runRoot: preparedRun.prepared.runRoot,
        archivePath: undefined,
        exportedFormats: [],
        failedFormats: [],
        skippedFormats: [],
        boardCount: progressBoards.length,
        completedBoardCount: 0,
        blankBoardCount: 0
      };
    }

    const finalized = await finalizeExportRun(preparedRun, boardResults).catch(async (error) => {
      await syncProgress({
        runId: preparedRun.runId,
        phase: "failed",
        totalBoards: progressBoards.length,
        completedBoards: countProgressBoards(progressBoards, "completed", "skipped"),
        failedBoards: countProgressBoards(progressBoards, "failed"),
        message: error instanceof Error ? error.message : "Bulk export failed.",
        boards: progressBoards
      });
      throw error;
    });

    await syncProgress({
      runId: preparedRun.runId,
      phase: "completed",
      totalBoards: progressBoards.length,
      completedBoards: countProgressBoards(progressBoards, "completed", "skipped"),
      failedBoards: countProgressBoards(progressBoards, "failed"),
      message: `Bulk export finished. ${finalized.completedBoardCount}/${finalized.boardCount} boards produced exports.`,
      boards: progressBoards
    }, finalized.archivePath);

    return finalized;
  } finally {
    if (workerTabId !== undefined) {
      await chrome.tabs.remove(workerTabId).catch(() => undefined);
    }

    if (originalTab?.id !== undefined) {
      await chrome.tabs.update(originalTab.id, { active: true }).catch(() => undefined);
    }
  }
}

function uniqueParticipatedBoards(boards: Array<ReturnType<typeof normalizeBoardRecord>>) {
  const seen = new Set<string>();
  return boards.filter((board) => {
    const key = board.boardUrl.toLowerCase();
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function countProgressBoards(boards: BulkExportBoardProgress[], ...statuses: BulkExportBoardProgress["status"][]) {
  return boards.filter((board) => statuses.includes(board.status)).length;
}

async function emitBulkExportProgress(progress: BulkExportProgress) {
  try {
    await chrome.runtime.sendMessage({
      type: "bulk_export_progress",
      progress
    });
  } catch {
    // Ignore when no side panel listener is attached.
  }
}

async function saveParticipatedExportSession(
  preparedRun: PreparedExportRun,
  progress: BulkExportProgress,
  archivePath?: string
) {
  const existing = await loadExportSession();
  const startedAt = existing?.runId === preparedRun.runId ? existing.startedAt : new Date().toISOString();

  await saveExportSession({
    runId: preparedRun.runId,
    scope: "participated",
    phase: progress.phase,
    message: progress.message,
    zipPackage: preparedRun.packageAsZip,
    outputRoot: preparedRun.prepared.outputRoot,
    requestedOutputRoot: preparedRun.requestedOutputRoot,
    requestedFormats: preparedRun.selectedFormats,
    runRoot: preparedRun.prepared.runRoot,
    archivePath: archivePath ?? (existing?.runId === preparedRun.runId ? existing.archivePath : undefined),
    totalBoards: progress.totalBoards,
    completedBoards: progress.completedBoards,
    failedBoards: progress.failedBoards,
    currentBoardKey: progress.currentBoardKey,
    currentBoardName: progress.currentBoardName,
    boards: progress.boards,
    startedAt,
    updatedAt: new Date().toISOString()
  });
}

function mapExportSessionToActionResponse(session: ExportSessionState): ExtensionActionResponse {
  return {
    ok: true,
    message: `An export is already in progress. ${session.message}`,
    archivePath: session.archivePath,
    runRoot: session.runRoot
  };
}

async function loadExportSession(): Promise<ExportSessionState | null> {
  const stored = await exportSessionStorageArea.get([activeExportSessionStorageKey]);
  const candidate = stored[activeExportSessionStorageKey];
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const session = candidate as Partial<ExportSessionState>;
  if (typeof session.runId !== "string" || typeof session.scope !== "string" || typeof session.phase !== "string" || typeof session.message !== "string") {
    return null;
  }

  return {
    runId: session.runId,
    scope: session.scope === "current" ? "current" : "participated",
    phase: normalizeExportSessionPhase(session.phase),
    message: session.message,
    zipPackage: Boolean(session.zipPackage),
    outputRoot: typeof session.outputRoot === "string" ? session.outputRoot : "",
    requestedOutputRoot: typeof session.requestedOutputRoot === "string" ? session.requestedOutputRoot : undefined,
    requestedFormats: Array.isArray(session.requestedFormats)
      ? session.requestedFormats.filter((format): format is ExportFormat => exportFormatOrder.includes(format as ExportFormat))
      : ["pdf"],
    runRoot: typeof session.runRoot === "string" ? session.runRoot : undefined,
    archivePath: typeof session.archivePath === "string" ? session.archivePath : undefined,
    totalBoards: typeof session.totalBoards === "number" ? session.totalBoards : 0,
    completedBoards: typeof session.completedBoards === "number" ? session.completedBoards : 0,
    failedBoards: typeof session.failedBoards === "number" ? session.failedBoards : 0,
    currentBoardKey: typeof session.currentBoardKey === "string" ? session.currentBoardKey : undefined,
    currentBoardName: typeof session.currentBoardName === "string" ? session.currentBoardName : undefined,
    boards: Array.isArray(session.boards) ? session.boards as BulkExportBoardProgress[] : [],
    startedAt: typeof session.startedAt === "string" ? session.startedAt : new Date().toISOString(),
    updatedAt: typeof session.updatedAt === "string" ? session.updatedAt : new Date().toISOString()
  };
}

async function loadActiveExportSession() {
  const session = await loadExportSession();
  if (!session || isTerminalExportSessionPhase(session.phase)) {
    return null;
  }

  return session;
}

async function saveExportSession(session: ExportSessionState) {
  await exportSessionStorageArea.set({
    [activeExportSessionStorageKey]: session
  });

  try {
    await chrome.runtime.sendMessage({
      type: "export_session_updated",
      session
    });
  } catch {
    // Ignore when no side panel listener is attached.
  }
}

async function updateExportSessionPhase(phase: Extract<ExportSessionPhase, "running" | "paused" | "stopped">) {
  const session = await loadExportSession();
  if (!session || isTerminalExportSessionPhase(session.phase)) {
    return null;
  }

  const updated: ExportSessionState = {
    ...session,
    phase,
    message: phase === "paused"
      ? "Pause requested. The current board will finish before the run pauses."
      : phase === "stopped"
        ? "Stop requested. The current board will finish before the run stops."
        : "Export resumed.",
    updatedAt: new Date().toISOString()
  };

  await saveExportSession(updated);
  return updated;
}

async function waitForBulkRunPermission(runId: string) {
  while (true) {
    const session = await loadExportSession();
    if (!session || session.runId !== runId) {
      return "continue" as const;
    }

    if (session.phase === "stopped") {
      return "stopped" as const;
    }

    if (session.phase === "paused") {
      await sleep(500);
      continue;
    }

    return "continue" as const;
  }
}

function isTerminalExportSessionPhase(phase: ExportSessionPhase) {
  return phase === "completed" || phase === "failed" || phase === "stopped";
}

function normalizeExportSessionPhase(phase: string): ExportSessionPhase {
  if (phase === "discovering" || phase === "running" || phase === "paused" || phase === "stopped" || phase === "completed" || phase === "failed") {
    return phase;
  }

  return "failed";
}

function createFailedBoardResult(
  board: ReturnType<typeof normalizeBoardRecord>,
  selectedFormats: ExportFormat[],
  reason: string
): BoardExportResult {
  const results = selectedFormats.map((format) => ({
    format,
    status: "failed" as const,
    reason
  }));

  const statuses: ManifestBoardEntry["statuses"] = {};
  for (const format of selectedFormats) {
    statuses[format] = "failed";
  }

  return {
    manifestBoard: {
      workspaceName: board.workspaceName,
      boardName: board.boardName,
      boardKey: board.boardKey,
      statuses,
      files: []
    },
    results
  };
}

async function prepareExportRun(
  outputRoot: string | undefined,
  requestedFormats: ExportFormat[] | undefined,
  zipPackage: boolean | undefined
): Promise<PreparedExportRun> {
  const selectedFormats = resolveExportFormats(requestedFormats);
  if (selectedFormats.length === 0) {
    throw new Error("NO_EXPORT_FORMATS_SELECTED");
  }

  const runId = crypto.randomUUID();
  const prepared = await sendHelperMessage<RunPreparedResponse>({
    type: "prepareRun",
    runId,
    outputRoot: sanitizeOptional(outputRoot)
  });

  return {
    selectedFormats,
    packageAsZip: zipPackage === true,
    requestedOutputRoot: sanitizeOptional(outputRoot),
    runId,
    prepared
  };
}

async function exportBoardAtTab(input: {
  tabId: number;
  runId: string;
  outputRoot: string;
  board: ReturnType<typeof normalizeBoardRecord>;
  selectedFormats: ExportFormat[];
}): Promise<BoardExportResult> {
  await waitForBoardReady(input.tabId);

  const relativeBoardRoot = [
    "workspaces",
    slugify(input.board.workspaceName),
    `${slugify(input.board.boardName)}__${slugify(input.board.boardKey)}`
  ].join("/");

  const manifestBoard: ManifestBoardEntry = {
    workspaceName: input.board.workspaceName,
    boardName: input.board.boardName,
    boardKey: input.board.boardKey,
    statuses: {},
    files: []
  };

  await appendHelperLog(input.runId, input.outputRoot, `board started: ${input.board.boardName}`);

  await applyZoomToFitBoardForPass({
    tabId: input.tabId,
    runId: input.runId,
    outputRoot: input.outputRoot,
    label: "board setup"
  });

  const blankCheck = await detectBlankBoard(input.tabId);
  if (blankCheck.isBlank) {
    for (const format of input.selectedFormats) {
      manifestBoard.statuses[format] = "skipped";
    }

    await appendHelperLog(
      input.runId,
      input.outputRoot,
      `board skipped as blank: ${input.board.boardName}${blankCheck.detail ? ` (${blankCheck.detail})` : ""}`
    );

    return {
      manifestBoard,
      results: input.selectedFormats.map((format) => ({
        format,
        status: "skipped" as const,
        reason: "BLANK_BOARD"
      }))
    };
  }

  const zoneDiscovery = await discoverBoardZones(input.tabId);
  const [zonePdfRecipeAvailable, zonePictureRecipeAvailable] = await Promise.all([
    hasLearnedExportRecipe(createExportTemplateContext(input.board, "pdf", "zones")),
    hasLearnedExportRecipe(createExportTemplateContext(input.board, "picture", "zones"))
  ]);
  const zoneExportAvailable = zoneDiscovery.available || zonePdfRecipeAvailable || zonePictureRecipeAvailable;
  await appendHelperLog(
    input.runId,
    input.outputRoot,
    zoneDiscovery.available
      ? `zone discovery found ${zoneDiscovery.zones.length} zones via export menu${zoneDiscovery.detail ? ` (${zoneDiscovery.detail})` : ""}`
      : zonePdfRecipeAvailable || zonePictureRecipeAvailable
        ? `zone discovery did not resolve the live dialog, but a learned backend zone export recipe is available${zoneDiscovery.detail ? ` (${zoneDiscovery.detail})` : ""}`
        : `zone discovery found no zones; board fit and confirmed-selection backup passes will be used${zoneDiscovery.detail ? ` (${zoneDiscovery.detail})` : ""}`
  );

  const results: FormatExecutionResult[] = [];
  const artifacts: ArtifactExecutionResult[] = [];
  const exportPlan = deriveBoardExportPlan(input.selectedFormats, zoneExportAvailable);

  if (exportPlan.runZonePdf) {
    await appendHelperLog(
      input.runId,
      input.outputRoot,
      `zone-based PDF export queued for ${zoneDiscovery.zones.length} zones`
    );
    if (zoneDiscovery.zones.length > 0) {
      await appendHelperLog(
        input.runId,
        input.outputRoot,
        `zone list: ${zoneDiscovery.zones.map((zone) => zone.zoneName).join(" | ")}`
      );
    }

    const zonePdfResult = await executeZonePdfExport({
      tabId: input.tabId,
      runId: input.runId,
      outputRoot: input.outputRoot,
      relativeBoardRoot: relativeBoardRoot,
      board: input.board,
      knownZones: zoneDiscovery.zones
    });

    await appendHelperLog(
      input.runId,
      input.outputRoot,
      `zone pdf: ${zonePdfResult.artifact.status}${zonePdfResult.artifact.reason ? ` (${zonePdfResult.artifact.reason})` : ""}`
    );
    if (zonePdfResult.zones.length > 0) {
      await appendHelperLog(
        input.runId,
        input.outputRoot,
        `zone pdf targeted zones: ${zonePdfResult.zones.map((zone) => zone.zoneName).join(" | ")}`
      );
    }

    artifacts.push(zonePdfResult.artifact);
    if (zonePdfResult.artifact.file) {
      manifestBoard.files.push(zonePdfResult.artifact.file);
    }

    manifestBoard.zones = zonePdfResult.zones.map((zone) => ({
      zoneName: zone.zoneName,
      zoneKey: zone.zoneKey,
      statuses: {
        pdf: zonePdfResult.artifact.status
      },
      files: []
    }));
  }

  if (exportPlan.runZonePicture) {
    const zonePictureResult = await executeZonePictureExport({
      tabId: input.tabId,
      runId: input.runId,
      outputRoot: input.outputRoot,
      relativeBoardRoot: relativeBoardRoot,
      board: input.board,
      knownZones: zoneDiscovery.zones
    });

    await appendHelperLog(
      input.runId,
      input.outputRoot,
      zonePictureResult.artifact.file
        ? `zone picture: done (${zonePictureResult.artifact.file})`
        : `zone picture: ${zonePictureResult.artifact.status}${zonePictureResult.artifact.reason ? ` (${zonePictureResult.artifact.reason})` : ""}`
    );

    artifacts.push(zonePictureResult.artifact);
    if (zonePictureResult.artifact.file) {
      manifestBoard.files.push(zonePictureResult.artifact.file);
    }
  }

  if (exportPlan.runBoardFitPdf) {
    const boardFitPdf = await executeBoardPreparedArtifactExport({
      tabId: input.tabId,
      runId: input.runId,
      outputRoot: input.outputRoot,
      relativeDestination: `${relativeBoardRoot}/board-fit.pdf`,
      board: input.board,
      format: "pdf",
      mode: "board-fit",
      artifactId: "board-fit-pdf",
      artifactLabel: "Board fit PDF",
      preparationLabel: "board fit pdf",
      prepare: async (fitBoard) => {
        return {
          ready: fitBoard.applied,
          detail: fitBoard.detail,
          reason: fitBoard.applied ? undefined : "ZOOM_TO_FIT_BOARD_UNAVAILABLE"
        };
      }
    });

    artifacts.push(boardFitPdf);
    await appendHelperLog(
      input.runId,
      input.outputRoot,
      `board fit pdf: ${boardFitPdf.status}${boardFitPdf.reason ? ` (${boardFitPdf.reason})` : ""}`
    );
    if (boardFitPdf.file) {
      manifestBoard.files.push(boardFitPdf.file);
    }
  }

  if (exportPlan.runBoardFitPicture) {
    const boardFitPicture = await executeBoardPreparedArtifactExport({
      tabId: input.tabId,
      runId: input.runId,
      outputRoot: input.outputRoot,
      relativeDestination: `${relativeBoardRoot}/board-fit-picture`,
      board: input.board,
      format: "picture",
      mode: "board-fit",
      artifactId: "board-fit-picture",
      artifactLabel: "Board fit picture",
      preparationLabel: "board fit picture",
      prepare: async (fitBoard) => {
        return {
          ready: fitBoard.applied,
          detail: fitBoard.detail,
          reason: fitBoard.applied ? undefined : "ZOOM_TO_FIT_BOARD_UNAVAILABLE"
        };
      }
    });

    artifacts.push(boardFitPicture);
    await appendHelperLog(
      input.runId,
      input.outputRoot,
      `board fit picture: ${boardFitPicture.status}${boardFitPicture.reason ? ` (${boardFitPicture.reason})` : ""}`
    );
    if (boardFitPicture.file) {
      manifestBoard.files.push(boardFitPicture.file);
    }
  }

  if (exportPlan.runBoardSelectionPdf) {
    const boardSelectionPdf = await executeBoardPreparedArtifactExport({
      tabId: input.tabId,
      runId: input.runId,
      outputRoot: input.outputRoot,
      relativeDestination: `${relativeBoardRoot}/board-selection.pdf`,
      board: input.board,
      format: "pdf",
      mode: "board-selection",
      artifactId: "board-selection-pdf",
      artifactLabel: "Board selection PDF",
      preparationLabel: "board selection pdf",
      prepare: async (fitBoard) => {
        if (!fitBoard.applied) {
          return {
            ready: false,
            detail: fitBoard.detail,
            reason: "ZOOM_TO_FIT_BOARD_UNAVAILABLE"
          };
        }

        const selectionApplied = await selectAllBoardContent(input.tabId);
        return {
          ready: selectionApplied.confirmed,
          detail: selectionApplied.detail,
          reason: selectionApplied.confirmed ? undefined : "BOARD_SELECTION_NOT_CONFIRMED"
        };
      }
    });

    artifacts.push(boardSelectionPdf);
    await appendHelperLog(
      input.runId,
      input.outputRoot,
      `board selection pdf: ${boardSelectionPdf.status}${boardSelectionPdf.reason ? ` (${boardSelectionPdf.reason})` : ""}`
    );
    if (boardSelectionPdf.file) {
      manifestBoard.files.push(boardSelectionPdf.file);
    }
  }

  if (exportPlan.runBoardSelectionPicture) {
    const boardSelectionPicture = await executeBoardPreparedArtifactExport({
      tabId: input.tabId,
      runId: input.runId,
      outputRoot: input.outputRoot,
      relativeDestination: `${relativeBoardRoot}/board-selection-picture`,
      board: input.board,
      format: "picture",
      mode: "board-selection",
      artifactId: "board-selection-picture",
      artifactLabel: "Board selection picture",
      preparationLabel: "board selection picture",
      prepare: async (fitBoard) => {
        if (!fitBoard.applied) {
          return {
            ready: false,
            detail: fitBoard.detail,
            reason: "ZOOM_TO_FIT_BOARD_UNAVAILABLE"
          };
        }

        const selectionApplied = await selectAllBoardContent(input.tabId);
        return {
          ready: selectionApplied.confirmed,
          detail: selectionApplied.detail,
          reason: selectionApplied.confirmed ? undefined : "BOARD_SELECTION_NOT_CONFIRMED"
        };
      }
    });

    artifacts.push(boardSelectionPicture);
    await appendHelperLog(
      input.runId,
      input.outputRoot,
      `board selection picture: ${boardSelectionPicture.status}${boardSelectionPicture.reason ? ` (${boardSelectionPicture.reason})` : ""}`
    );
    if (boardSelectionPicture.file) {
      manifestBoard.files.push(boardSelectionPicture.file);
    }
  }

  manifestBoard.artifacts = artifacts;

  if (input.selectedFormats.includes("pdf")) {
    const pdfSummary = summarizePdfArtifacts(artifacts);
    results.push(pdfSummary);
    manifestBoard.statuses.pdf = pdfSummary.status;
  }

  if (exportPlan.boardFormats.length > 0) {
    const boardLevelResults = await runFormatExports({
      tabId: input.tabId,
      runId: input.runId,
      outputRoot: input.outputRoot,
      relativeRoot: relativeBoardRoot,
      board: input.board,
      formats: exportPlan.boardFormats,
      logPrefix: "board"
    });

    results.push(...boardLevelResults);
    manifestBoard.files.push(...boardLevelResults.flatMap((result) => (result.file ? [result.file] : [])));
    Object.assign(manifestBoard.statuses, summarizeStatuses(boardLevelResults));
  }

  if (!manifestBoard.zones || manifestBoard.zones.length === 0) {
    delete manifestBoard.zones;
  }

  if (!manifestBoard.artifacts || manifestBoard.artifacts.length === 0) {
    delete manifestBoard.artifacts;
  }

  manifestBoard.files = [...new Set(manifestBoard.files)];

  return { manifestBoard, results };
}

async function finalizeExportRun(preparedRun: PreparedExportRun, boardResults: BoardExportResult[]): Promise<ExportRunResult> {
  const manifest: RunManifest = {
    schemaVersion: "1.0.0",
    runId: preparedRun.runId,
    startedAt: new Date().toISOString(),
    outputRoot: preparedRun.prepared.outputRoot,
    boards: boardResults.map((result) => result.manifestBoard)
  };

  await sendHelperMessage({
    type: "writeManifest",
    runId: preparedRun.runId,
    outputRoot: preparedRun.prepared.outputRoot,
    manifest
  });

  const allResults = boardResults.flatMap((result) => result.results);
  const exportedFormats = uniqueFormats(allResults.filter((result) => result.status === "done").map((result) => result.format));
  const failedFormats = uniqueFormats(allResults.filter((result) => result.status === "failed").map((result) => result.format));
  const skippedFormats = uniqueFormats(allResults.filter((result) => result.status === "skipped").map((result) => result.format));
  const blankBoardCount = boardResults.filter((result) => result.results.every((entry) => entry.reason === "BLANK_BOARD")).length;
  const completedBoardCount = boardResults.filter((result) => result.results.some((entry) => entry.status === "done")).length;

  if (completedBoardCount === 0) {
    const summary = boardResults
      .map((result) => `${result.manifestBoard.boardName}: ${summarizeFormatResults(result.results)}`)
      .join(" | ");
    await appendHelperLog(preparedRun.runId, preparedRun.prepared.outputRoot, `run finished without exports: ${summary}`);
    throw new Error(`NO_EXPORTS_COMPLETED: ${summary}. Run folder: ${preparedRun.prepared.runRoot}`);
  }

  const archivePath = preparedRun.packageAsZip
    ? (
      await sendHelperMessage<{ ok: true; type: "runPackaged"; archivePath: string }>({
        type: "packageRun",
        runId: preparedRun.runId,
        outputRoot: preparedRun.prepared.outputRoot
      })
    ).archivePath
    : undefined;

  return {
    runRoot: preparedRun.prepared.runRoot,
    archivePath,
    exportedFormats,
    failedFormats,
    skippedFormats,
    boardCount: boardResults.length,
    completedBoardCount,
    blankBoardCount
  };
}

async function getActiveKlaxoonTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
    url: ["https://*.klaxoon.com/*"]
  });

  if (!tab?.url || !isKlaxoonBoardUrl(tab.url)) {
    throw new Error("ACTIVE_TAB_NOT_KLAXOON_BOARD");
  }

  return tab;
}

async function getActiveWindowTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });

  return tab;
}

async function waitForTabComplete(tabId: number, expectedUrl: string, timeoutMs = 30_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete" && typeof tab.url === "string" && tab.url.startsWith(expectedUrl)) {
      return;
    }

    await sleep(250);
  }

  throw new Error(`TAB_LOAD_TIMEOUT: ${expectedUrl}`);
}

async function discoverParticipatedBoards(tabId: number) {
  const backendBoards = await discoverParticipatedBoardsViaBackend(tabId);
  if (backendBoards.length > 0) {
    await logHelperMessage(`participated board discovery used backend activities API (${backendBoards.length} boards)`);
    return backendBoards;
  }

  await logHelperMessage("participated board discovery backend returned no boards; falling back to DOM sweep");
  return discoverParticipatedBoardsViaDom(tabId);
}

async function discoverParticipatedBoardsViaBackend(tabId: number) {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  const origin = (() => {
    try {
      return new URL(tab?.url ?? recentBoardsUrl).origin;
    } catch {
      return new URL(recentBoardsUrl).origin;
    }
  })();

  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (initialUrl: string) => {
      const maxPages = 25;
      const serializeText = (value: unknown) => (typeof value === "string" && value.trim().length > 0 ? value.trim() : null);
      const serializeItem = (item: unknown) => {
        if (!item || typeof item !== "object") {
          return null;
        }

        const record = item as Record<string, unknown>;
        const author = record.author && typeof record.author === "object" ? (record.author as Record<string, unknown>) : null;
        const workspace = record.workspace && typeof record.workspace === "object" ? (record.workspace as Record<string, unknown>) : null;
        const network = record.network && typeof record.network === "object" ? (record.network as Record<string, unknown>) : null;
        const team = record.team && typeof record.team === "object" ? (record.team as Record<string, unknown>) : null;

        return {
          id: serializeText(record.id),
          type: serializeText(record.type),
          title: serializeText(record.title),
          accessCode: serializeText(record.accessCode),
          webUrl: serializeText(record.webUrl),
          author: author
            ? {
                id: serializeText(author.id),
                name: serializeText(author.name),
                displayName: serializeText(author.displayName),
                fullName: serializeText(author.fullName)
              }
            : null,
          workspace: workspace ? { name: serializeText(workspace.name) } : null,
          network: network ? { name: serializeText(network.name) } : null,
          team: team ? { name: serializeText(team.name) } : null
        };
      };

      const pages: Array<{ items: Array<ReturnType<typeof serializeItem>>; next: string | null; self: string | null; total: number | null }> =
        [];
      let requestUrl = initialUrl;

      for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
        const response = await fetch(requestUrl, {
          credentials: "include",
          headers: {
            accept: "application/json"
          }
        });

        if (!response.ok) {
          return {
            ok: false,
            errorCode: "ACTIVITIES_FETCH_FAILED",
            details: `${response.status} ${response.statusText}`.trim(),
            requestUrl,
            pages
          };
        }

        const payload = (await response.json()) as Record<string, unknown>;
        const items = Array.isArray(payload.items) ? payload.items.map((item) => serializeItem(item)).filter(Boolean) : [];
        const next = serializeText(payload.next);

        pages.push({
          items,
          next,
          self: serializeText(payload.self),
          total: typeof payload.total === "number" ? payload.total : null
        });

        if (!next) {
          return { ok: true, pages, truncated: false };
        }

        requestUrl = next;
      }

      return { ok: true, pages, truncated: true };
    },
    args: [buildActivitiesApiUrl(origin, 1)]
  });

  const payload = result?.result as
    | {
        ok?: boolean;
        pages?: Array<{ items?: unknown; next?: string | null; self?: string | null; total?: number | null }>;
        truncated?: boolean;
        details?: string;
        errorCode?: string;
      }
    | undefined;

  if (!payload?.ok || !Array.isArray(payload.pages)) {
    await logHelperMessage(
      `participated board discovery backend failed${payload?.errorCode ? ` (${payload.errorCode})` : ""}${payload?.details ? `: ${payload.details}` : ""}`
    );
    return [];
  }

  const boards = extractParticipatedBoardsFromActivityPages(payload.pages, origin);
  if (payload.truncated) {
    await logHelperMessage("participated board discovery backend reached pagination safety limit; DOM fallback remains available");
  }

  return boards;
}

async function discoverParticipatedBoardsViaDom(tabId: number) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async () => {
      const boardUrlPattern = /(?:https?:\/\/[^"'`\s<>]+)?\/(?:participate\/board|boards?|board)\/([^/?#"'`\s<>]+)/i;
      const boardUrlPatternGlobal = /(?:https?:\/\/[^"'`\s<>]+)?\/(?:participate\/board|boards?|board)\/([^/?#"'`\s<>]+)/gi;
      const interactiveSelector = "button, [role='button'], [role='tab'], [role='menuitem'], a";
      const candidateBoardSelector = "a[href], [href], [data-href], [data-url], [data-to], [data-link], [data-path], [routerlink], article, li, [role='listitem'], [data-testid], button, [role='button'], div";
      const metadataContainerSelector = "article, li, [role='listitem'], [data-testid*='card'], [data-testid*='item'], [class*='card'], [class*='tile'], [class*='item'], section, div";
      const ignoredLineHints = [
        "participated",
        "recent",
        "recents",
        "favorites",
        "favourites",
        "search",
        "filter",
        "sort",
        "open",
        "board",
        "activity",
        "workspace",
        "show more",
        "see more",
        "load more"
      ];
      const expansionHints = ["show more", "see more", "load more", "more results", "display more", "next"];

      const isVisible = (element: HTMLElement | null) => {
        if (!element) {
          return false;
        }

        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };

      const getContent = (element: HTMLElement) =>
        [
          element.innerText,
          element.textContent,
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.getAttribute("data-testid")
        ]
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

      const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();

      const containsHint = (content: string, hints: string[]) => hints.some((hint) => content.toLowerCase().includes(hint));

      const delay = (timeoutMs: number) => new Promise((resolve) => window.setTimeout(resolve, timeoutMs));

      const toAbsoluteBoardUrl = (value: string | null | undefined) => {
        const normalized = normalizeText(value ?? "");
        if (!normalized) {
          return null;
        }

        const match = normalized.match(boardUrlPattern);
        if (!match) {
          return null;
        }

        const rawUrl = match[0];
        try {
          if (/^https?:\/\//i.test(rawUrl)) {
            return new URL(rawUrl).href;
          }

          return new URL(rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`, window.location.origin).href;
        } catch {
          return null;
        }
      };

      const extractBoardUrlFromElement = (candidate: Element | null) => {
        if (!candidate) {
          return null;
        }

        const attributeValues = [
          candidate instanceof HTMLAnchorElement ? candidate.href : null,
          candidate.getAttribute("href"),
          candidate.getAttribute("data-href"),
          candidate.getAttribute("data-url"),
          candidate.getAttribute("data-to"),
          candidate.getAttribute("data-link"),
          candidate.getAttribute("data-path"),
          candidate.getAttribute("routerlink"),
          candidate.getAttribute("aria-label"),
          candidate.getAttribute("title"),
          candidate.getAttribute("onclick"),
          candidate.getAttribute("data-testid"),
          candidate.textContent
        ];

        for (const value of attributeValues) {
          const boardUrl = toAbsoluteBoardUrl(value);
          if (boardUrl) {
            return boardUrl;
          }
        }

        return null;
      };

      const collectLines = (element: HTMLElement | null) =>
        normalizeText(
          [
            element?.innerText,
            element?.textContent,
            element?.getAttribute("aria-label"),
            element?.getAttribute("title")
          ]
            .filter(Boolean)
            .join("\n")
        )
          .split(/\n+/)
          .map((line) => normalizeText(line))
          .filter(Boolean);

      const deriveBoardMetadata = (candidate: HTMLElement | null, boardUrl: string) => {
        const fallbackBoardName = inferBoardKey(boardUrl);
        const container = candidate?.closest<HTMLElement>(metadataContainerSelector) ?? candidate;
        const lines = [...collectLines(candidate), ...collectLines(container)];
        const uniqueLines = lines.filter((line, index) => lines.indexOf(line) === index);
        const usefulLines = uniqueLines.filter((line) => {
          const lowered = line.toLowerCase();
          return (
            line.length > 1 &&
            !containsHint(lowered, ignoredLineHints) &&
            !toAbsoluteBoardUrl(line) &&
            !/^\d+$/.test(line)
          );
        });

        const boardName = usefulLines[0] ?? fallbackBoardName;
        const workspaceName = usefulLines.find((line) => line !== boardName) ?? "participated";
        return { boardName, workspaceName };
      };

      const addBoard = (
        seen: Map<string, { boardUrl: string; boardName: string; workspaceName: string }>,
        boardUrl: string | null,
        candidate: HTMLElement | null
      ) => {
        if (!boardUrl) {
          return;
        }

        const match = boardUrl.match(boardUrlPattern);
        const boardKey = match?.[1];
        if (!boardKey || seen.has(boardKey)) {
          return;
        }

        const metadata = deriveBoardMetadata(candidate, boardUrl);
        seen.set(boardKey, {
          boardUrl,
          boardName: metadata.boardName,
          workspaceName: metadata.workspaceName
        });
      };

      const activate = (candidate: HTMLElement) => {
        candidate.scrollIntoView({ block: "center", inline: "center" });
        candidate.focus?.();
        candidate.click();
      };

      const getScrollableContainers = () =>
        Array.from(document.querySelectorAll<HTMLElement>("main, section, div, ul, ol"))
          .filter((candidate) => isVisible(candidate))
          .filter((candidate) => {
            const style = window.getComputedStyle(candidate);
            const allowsScroll = ["auto", "scroll", "overlay"].includes(style.overflowY) || ["auto", "scroll", "overlay"].includes(style.overflow);
            return candidate.scrollHeight > candidate.clientHeight + 120 && (allowsScroll || candidate.clientHeight > 180);
          })
          .sort((left, right) => right.scrollHeight - left.scrollHeight)
          .slice(0, 8);

      const advanceDiscoveryViewport = async () => {
        let expanded = false;

        const expansionCandidates = Array.from(document.querySelectorAll<HTMLElement>(interactiveSelector)).filter((candidate) => {
          if (!isVisible(candidate)) {
            return false;
          }

          const content = getContent(candidate).toLowerCase();
          return containsHint(content, expansionHints) && !containsHint(content, ["show less"]);
        });

        for (const candidate of expansionCandidates.slice(0, 3)) {
          activate(candidate);
          expanded = true;
          await delay(500);
        }

        for (const container of getScrollableContainers()) {
          const previousTop = container.scrollTop;
          container.scrollTo({ top: container.scrollHeight, behavior: "auto" });
          if (container.scrollTop !== previousTop) {
            expanded = true;
          }
        }

        const previousWindowOffset = window.scrollY;
        window.scrollTo(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
        if (window.scrollY !== previousWindowOffset) {
          expanded = true;
        }

        await delay(expanded ? 1_000 : 600);
        return expanded;
      };

      const activateParticipatedView = async () => {
        const tabCandidates = Array.from(document.querySelectorAll<HTMLElement>(interactiveSelector)).filter((candidate) => isVisible(candidate));
        const participatedTab = tabCandidates.find((candidate) => containsHint(getContent(candidate), ["participated", "joined"]));
        if (participatedTab) {
          activate(participatedTab);
          await delay(1_250);
          return;
        }

        const filtersButton = tabCandidates.find((candidate) => containsHint(getContent(candidate), ["filter", "type", "activities", "recent"]));
        if (filtersButton) {
          activate(filtersButton);
          await delay(400);

          const filterOption = Array.from(document.querySelectorAll<HTMLElement>(`${interactiveSelector}, [role='option']`)).find((candidate) =>
            isVisible(candidate) && containsHint(getContent(candidate), ["participated", "joined"])
          );
          if (filterOption) {
            activate(filterOption);
            await delay(1_250);
          }
        }
      };

      const collectBoards = () => {
        const seen = new Map<string, { boardUrl: string; boardName: string; workspaceName: string }>();

        const visibleCandidates = Array.from(document.querySelectorAll<HTMLElement>(candidateBoardSelector)).filter((candidate) => isVisible(candidate));
        for (const candidate of visibleCandidates) {
          addBoard(seen, extractBoardUrlFromElement(candidate), candidate);
        }

        if (seen.size === 0) {
          const html = document.documentElement.innerHTML;
          const matches = Array.from(html.matchAll(boardUrlPatternGlobal));
          for (const match of matches) {
            addBoard(seen, toAbsoluteBoardUrl(match[0]), null);
          }
        }

        return [...seen.values()];
      };

      await activateParticipatedView();

      let lastCount = 0;
      let stableIterations = 0;
      for (let index = 0; index < 16; index += 1) {
        const boards = collectBoards();
        if (boards.length === lastCount) {
          stableIterations += 1;
        } else {
          stableIterations = 0;
          lastCount = boards.length;
        }

        if (stableIterations >= 2) {
          break;
        }

        const advanced = await advanceDiscoveryViewport();
        if (!advanced) {
          stableIterations += 1;
        }
      }

      return collectBoards();
    }
  });

  const discovered = Array.isArray(result?.result) ? result.result : [];
  return discovered
    .map((item) => ({
      workspaceName: typeof item.workspaceName === "string" ? item.workspaceName : "participated",
      boardName: typeof item.boardName === "string" && item.boardName.trim().length > 0 ? item.boardName : inferBoardKey(String(item.boardUrl ?? "")),
      boardUrl: String(item.boardUrl ?? "")
    }))
    .filter((item) => isKlaxoonBoardUrl(item.boardUrl))
    .map((item) => normalizeBoardRecord(item));
}

async function waitForBoardReady(tabId: number): Promise<void> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (selectors: SelectorSet, timeoutMs: number) => {
      const firstMatch = (entries: string[]) => {
        for (const selector of entries) {
          const match = document.querySelector<HTMLElement>(selector);
          if (match) {
            return match;
          }
        }

        return null;
      };

      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        if (firstMatch(selectors.boardReady)) {
          return true;
        }

        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }

      return false;
    },
    args: [selectorRegistry.default, 15_000]
  });

  if (!result?.result) {
    throw new Error("BOARD_NOT_READY");
  }
}

async function detectBlankBoard(tabId: number): Promise<{ isBlank: boolean; detail: string }> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (selectors: SelectorSet) => {
      const firstMatch = (entries: string[]) => {
        for (const selector of entries) {
          const match = document.querySelector<HTMLElement>(selector);
          if (match) {
            return match;
          }
        }

        return document.querySelector<HTMLElement>("main");
      };

      const isVisible = (element: HTMLElement | null) => {
        if (!element) {
          return false;
        }

        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      };

      const root = firstMatch(selectors.boardReady);
      if (!root || !isVisible(root)) {
        return { isBlank: false, detail: "board-root-missing" };
      }

      const elements = Array.from(root.querySelectorAll<HTMLElement>("div, span, p, img, canvas"));
      let contentCount = 0;
      for (const element of elements) {
        if (!isVisible(element) || element.closest("header, nav, aside, footer, [role='toolbar'], [role='dialog']")) {
          continue;
        }

        const rect = element.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8) {
          continue;
        }

        const tag = element.tagName.toLowerCase();
        const text = (element.innerText || element.textContent || "").trim();
        if (text.length > 0 || tag === "img" || tag === "canvas") {
          contentCount += 1;
          if (contentCount >= 1) {
            return { isBlank: false, detail: `content-count=${contentCount}` };
          }
        }
      }

      return { isBlank: true, detail: `content-count=${contentCount}` };
    },
    args: [selectorRegistry.default]
  });

  return result?.result ?? { isBlank: false, detail: "blank-check-unavailable" };
}

async function fitBoardToScreen(tabId: number): Promise<{ applied: boolean; detail: string }> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: runZoomMenuActionInPage,
    args: [selectorRegistry.default, "fit-board"]
  });

  const zoomResult = result?.result;
  return zoomResult ? { applied: zoomResult.ok, detail: zoomResult.detail } : { applied: false, detail: "zoom-fit-unavailable" };
}

async function applyZoomToFitBoardForPass(input: {
  tabId: number;
  runId: string;
  outputRoot: string;
  label: string;
}) {
  const fitResult = await fitBoardToScreen(input.tabId);
  await appendHelperLog(
    input.runId,
    input.outputRoot,
    fitResult.applied
      ? `${input.label}: zoom to fit board applied`
      : `${input.label}: zoom to fit board unavailable${fitResult.detail ? ` (${fitResult.detail})` : ""}`
  );

  return fitResult;
}

async function selectAllBoardContent(tabId: number): Promise<{ attempted: boolean; confirmed: boolean; detail: string }> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (selectors: SelectorSet) => {
      const interactiveSelector = "button, [role='button'], [role='menuitem'], [role='option'], [role='combobox'], [tabindex]:not([tabindex='-1']), a";

      const firstMatch = (entries: string[]) => {
        for (const selector of entries) {
          const match = document.querySelector<HTMLElement>(selector);
          if (match) {
            return match;
          }
        }

        return document.querySelector<HTMLElement>("main");
      };

      const isVisible = (element: HTMLElement | null) => {
        if (!element) {
          return false;
        }

        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      };

      const getContent = (element: HTMLElement) =>
        [
          element.innerText,
          element.textContent,
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.getAttribute("data-testid")
        ]
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

      const interactive = () =>
        Array.from(document.querySelectorAll<HTMLElement>(interactiveSelector)).filter((candidate) => isVisible(candidate));

      const containsHint = (content: string, hints: string[]) => hints.some((hint) => content.includes(hint));

      const activate = (candidate: HTMLElement) => {
        candidate.scrollIntoView({ block: "center", inline: "center" });
        candidate.focus?.();
        candidate.click();
      };

      const findByHints = (hints: string[], excludeHints: string[] = []) =>
        interactive().find((candidate) => {
          const content = getContent(candidate);
          return containsHint(content, hints) && !containsHint(content, excludeHints);
        }) ?? null;

      const root = firstMatch(selectors.boardReady);
      if (!root) {
        return { attempted: false, confirmed: false, detail: "board-root-missing" };
      }

      const selectTool =
        firstMatch(selectors.selectToolButton) ??
        findByHints(["select"], ["selection", "zoom to selection", "selected"]);
      if (selectTool) {
        activate(selectTool);
        await new Promise((resolve) => window.setTimeout(resolve, 150));
      }

      activate(root);
      root.focus?.();

      const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
      const target = document.activeElement instanceof HTMLElement ? document.activeElement : root;
      target.focus?.();

      const dispatchShortcut = (receiver: EventTarget, repeatCount = 1) => {
        for (let index = 0; index < repeatCount; index += 1) {
          receiver.dispatchEvent(new KeyboardEvent("keydown", {
            key: "a",
            code: "KeyA",
            ctrlKey: !isMac,
            metaKey: isMac,
            bubbles: true,
            cancelable: true
          }));
          receiver.dispatchEvent(new KeyboardEvent("keyup", {
            key: "a",
            code: "KeyA",
            ctrlKey: !isMac,
            metaKey: isMac,
            bubbles: true,
            cancelable: true
          }));
        }
      };

      dispatchShortcut(target, 2);
      dispatchShortcut(root, 2);
      dispatchShortcut(document, 2);
      dispatchShortcut(document.body, 1);
      await new Promise((resolve) => window.setTimeout(resolve, 400));
      return {
        attempted: true,
        detail: `${selectTool ? "select-tool-activated" : "select-tool-unavailable"}; selection-shortcut-dispatched`
      };
    },
    args: [selectorRegistry.default]
  });

  const selectionPrep = result?.result ?? { attempted: false, detail: "select-all-unavailable" };
  if (!selectionPrep.attempted) {
    return { attempted: false, confirmed: false, detail: selectionPrep.detail };
  }

  const [zoomResult] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: runZoomMenuActionInPage,
    args: [selectorRegistry.default, "detect-selection"]
  });

  const selectionDetection = zoomResult?.result ?? { ok: false, detail: "zoom-selection-check-unavailable" };
  return {
    attempted: true,
    confirmed: selectionDetection.ok,
    detail: `${selectionPrep.detail}; ${selectionDetection.ok ? "selection-detected" : selectionDetection.detail}`
  };
}

async function ensurePresenterMode(tabId: number): Promise<PresenterModeState> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (selectors: SelectorSet, timeoutMs: number) => {
      const interactiveSelector = "button, [role='button'], a";

      const isVisible = (element: HTMLElement | null) => {
        if (!element) {
          return false;
        }

        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      };

      const getInteractive = () =>
        Array.from(document.querySelectorAll<HTMLElement>(interactiveSelector)).filter((candidate) => isVisible(candidate));

      const getElementContent = (candidate: HTMLElement) =>
        [
          candidate.innerText,
          candidate.textContent,
          candidate.getAttribute("aria-label"),
          candidate.getAttribute("title"),
          candidate.getAttribute("data-testid")
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

      const containsHint = (content: string, hints: string[]) => hints.some((hint) => content.includes(hint));

      const firstMatch = (entries: string[]) => {
        for (const selector of entries) {
          const match = document.querySelector<HTMLElement>(selector);
          if (isVisible(match)) {
            return match;
          }
        }

        return null;
      };

      const findByHints = (hints: string[], excludeHints: string[] = []) =>
        getInteractive().find((candidate) => {
          const content = getElementContent(candidate);
          return containsHint(content, hints) && !containsHint(content, excludeHints);
        }) ?? null;

      const activateCandidate = (candidate: HTMLElement) => {
        candidate.scrollIntoView({ block: "center", inline: "center" });
        candidate.focus?.();
        candidate.click();
      };

      const findStopButton = () =>
        firstMatch(selectors.stopPresentingButton) ?? findByHints(["stop"], ["share", "comment", "undo", "interaction"]);

      if (findStopButton()) {
        return { active: true, entered: false };
      }

      const presentButton =
        firstMatch(selectors.presentButton) ?? findByHints(["present"], ["participant", "presentation", "represent"]);
      if (!presentButton) {
        return { active: false, entered: false };
      }

      activateCandidate(presentButton);

      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        if (findStopButton()) {
          return { active: true, entered: true };
        }

        await new Promise((resolve) => window.setTimeout(resolve, 200));
      }

      return { active: false, entered: false };
    },
    args: [selectorRegistry.default, 10_000]
  });

  return result?.result ?? { active: false, entered: false };
}

async function exitPresenterMode(tabId: number): Promise<boolean> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (selectors: SelectorSet, timeoutMs: number) => {
      const interactiveSelector = "button, [role='button'], a";

      const isVisible = (element: HTMLElement | null) => {
        if (!element) {
          return false;
        }

        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      };

      const getInteractive = () =>
        Array.from(document.querySelectorAll<HTMLElement>(interactiveSelector)).filter((candidate) => isVisible(candidate));

      const getElementContent = (candidate: HTMLElement) =>
        [
          candidate.innerText,
          candidate.textContent,
          candidate.getAttribute("aria-label"),
          candidate.getAttribute("title"),
          candidate.getAttribute("data-testid")
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

      const containsHint = (content: string, hints: string[]) => hints.some((hint) => content.includes(hint));

      const firstMatch = (entries: string[]) => {
        for (const selector of entries) {
          const match = document.querySelector<HTMLElement>(selector);
          if (isVisible(match)) {
            return match;
          }
        }

        return null;
      };

      const findByHints = (hints: string[], excludeHints: string[] = []) =>
        getInteractive().find((candidate) => {
          const content = getElementContent(candidate);
          return containsHint(content, hints) && !containsHint(content, excludeHints);
        }) ?? null;

      const activateCandidate = (candidate: HTMLElement) => {
        candidate.scrollIntoView({ block: "center", inline: "center" });
        candidate.focus?.();
        candidate.click();
      };

      const stopButton =
        firstMatch(selectors.stopPresentingButton) ?? findByHints(["stop"], ["share", "comment", "undo", "interaction"]);
      if (!stopButton) {
        return true;
      }

      activateCandidate(stopButton);

      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const presentButton =
          firstMatch(selectors.presentButton) ?? findByHints(["present"], ["participant", "presentation", "represent"]);
        if (presentButton) {
          return true;
        }

        await new Promise((resolve) => window.setTimeout(resolve, 200));
      }

      return false;
    },
    args: [selectorRegistry.default, 8_000]
  });

  return result?.result ?? false;
}

async function discoverBoardZones(tabId: number): Promise<ZoneDiscoveryResult> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (selectors: SelectorSet) => {
      const interactiveSelector = "button, [role='button'], [role='menuitem'], [role='menuitemradio'], [role='option'], [role='listitem'], a, li, label";
      const contentSelector = `${interactiveSelector}, [role='checkbox'], [role='dialog'] div, [role='dialog'] span, div, span`;

      const delay = (timeoutMs: number) => new Promise((resolve) => window.setTimeout(resolve, timeoutMs));

      const isVisible = (element: HTMLElement | null) => {
        if (!element) {
          return false;
        }

        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      };

      const getContent = (element: HTMLElement) =>
        [
          element.innerText,
          element.textContent,
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.getAttribute("data-testid")
        ]
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

      const normalizeText = (content: string) => content.replace(/\s+/g, " ").trim();

      const containsHint = (content: string, hints: string[]) => hints.some((hint) => content.toLowerCase().includes(hint));

      const activate = (candidate: HTMLElement) => {
        candidate.scrollIntoView({ block: "center", inline: "center" });
        candidate.focus?.();
        candidate.click();
      };

      const interactive = (scope: ParentNode = document) =>
        Array.from(scope.querySelectorAll<HTMLElement>(interactiveSelector)).filter((candidate) => isVisible(candidate));

      const contentCandidates = (scope: ParentNode = document) =>
        Array.from(scope.querySelectorAll<HTMLElement>(contentSelector)).filter((candidate) => isVisible(candidate));

      const findByHints = (hints: string[], excludeHints: string[] = [], scope: ParentNode = document) =>
        interactive(scope).find((candidate) => {
          const content = getContent(candidate).toLowerCase();
          return containsHint(content, hints) && !containsHint(content, excludeHints);
        }) ?? null;

      const toClickable = (candidate: HTMLElement | null) => {
        if (!candidate) {
          return null;
        }

        if (candidate.matches(interactiveSelector)) {
          return candidate;
        }

        return candidate.closest<HTMLElement>(interactiveSelector);
      };

      const findContentByHints = (hints: string[], excludeHints: string[] = [], scope: ParentNode = document) => {
        for (const candidate of contentCandidates(scope)) {
          const content = getContent(candidate).toLowerCase();
          if (!content || !containsHint(content, hints) || containsHint(content, excludeHints)) {
            continue;
          }

          const clickable = toClickable(candidate);
          if (clickable && isVisible(clickable)) {
            return clickable;
          }
        }

        return null;
      };

      const firstMatch = (entries: string[], scope: ParentNode = document) => {
        for (const selector of entries) {
          const match = scope.querySelector<HTMLElement>(selector);
          if (isVisible(match)) {
            return match;
          }
        }

        return null;
      };

      const firstPresentMatch = <T extends Element>(entries: string[], scope: ParentNode = document) => {
        for (const selector of entries) {
          const match = scope.querySelector<T>(selector);
          if (match) {
            return match;
          }
        }

        return null;
      };

      const waitForVisible = async (entries: string[], timeoutMs: number, scope: ParentNode = document) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          const match = firstMatch(entries, scope);
          if (match) {
            return match;
          }

          await delay(100);
        }

        return null;
      };

      const getZoneCheckboxLabels = (scope: ParentNode = document) =>
        Array.from(scope.querySelectorAll<HTMLElement>(selectors.zoneCheckboxLabel.join(",")))
          .filter((candidate) => isVisible(candidate))
          .filter((candidate) => Boolean(candidate.querySelector("input[type='checkbox']")));

      const isAllZonesLabel = (candidate: HTMLElement | null) => {
        if (!candidate) {
          return false;
        }

        const content = normalizeText(getContent(candidate)).toLowerCase();
        return content === "all zones" || content === "select all" || content.startsWith("all zones ");
      };

      const getZoneLabels = (scope: ParentNode = document) =>
        getZoneCheckboxLabels(scope).filter((candidate) => !isAllZonesLabel(candidate));

      const findSelectAllToggle = (scope: ParentNode = document) =>
        getZoneCheckboxLabels(scope).find((candidate) => isAllZonesLabel(candidate)) ?? null;

      const hasZoneFormatSelect = (scope: ParentNode = document) => {
        const nativeSelect = firstPresentMatch<HTMLSelectElement>(selectors.zoneDialogFormatSelect, scope);
        if (nativeSelect) {
          const optionContent = Array.from(nativeSelect.options)
            .map((option) => normalizeText(`${option.value} ${option.textContent ?? ""}`).toLowerCase())
            .join(" ");
          if (containsHint(optionContent, ["pdf"]) && containsHint(optionContent, ["picture", "image"])) {
            return true;
          }
        }

        return Boolean(firstMatch(selectors.zoneDialogFormatButton, scope));
      };

      const isZoneSelectionDialog = (candidate: HTMLElement | null) => {
        if (!isVisible(candidate)) {
          return false;
        }

        const scope = candidate ?? undefined;
        return Boolean(
          firstMatch(selectors.zoneSelectAllButton, scope) ??
          findSelectAllToggle(scope) ??
          firstMatch(selectors.zoneDialogPdfOption, scope) ??
          firstMatch(selectors.zoneDialogPictureOption, scope) ??
          (getZoneLabels(scope).length > 0 && hasZoneFormatSelect(scope) ? candidate : null) ??
          findByHints(["select all"], ["board", "all boards"], scope) ??
          findContentByHints(["select all"], ["board", "all boards"], scope)
        );
      };

      const waitForDialog = async (timeoutMs: number, sourceDialog: HTMLElement | null = null) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          const directCandidates = selectors.zonesDialog
            .flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)))
            .filter((candidate, index, all) => isVisible(candidate) && all.indexOf(candidate) === index);

          for (const candidate of directCandidates) {
            if (candidate === sourceDialog && !isZoneSelectionDialog(candidate)) {
              continue;
            }

            if (isZoneSelectionDialog(candidate)) {
              return candidate;
            }
          }

          const fallback = Array.from(document.querySelectorAll<HTMLElement>("[role='dialog'], [aria-modal='true']")).find((candidate) =>
            candidate !== sourceDialog && isZoneSelectionDialog(candidate)
          );
          if (fallback) {
            return fallback;
          }

          await delay(100);
        }

        return null;
      };

      const collectDiagnostics = () =>
        interactive()
          .map((candidate) => getContent(candidate))
          .filter(Boolean)
          .slice(0, 20)
          .join(" | ");

      const dismissTransientUi = async () => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await delay(150);
      };

      const findProbeContainer = (element: HTMLElement) => {
        let current = element.parentElement;
        while (current) {
          if (current.querySelectorAll(interactiveSelector).length >= 4) {
            return current;
          }

          current = current.parentElement;
        }

        return element.parentElement;
      };

      const getToolbarProbeCandidates = () => {
        const collected: HTMLElement[] = [];
        const seen = new Set<HTMLElement>();
        const push = (candidate: HTMLElement | null) => {
          if (!candidate || seen.has(candidate) || !isVisible(candidate)) {
            return;
          }

          seen.add(candidate);
          collected.push(candidate);
        };

        for (const candidate of interactive()) {
          const content = getContent(candidate).toLowerCase();
          if (
            containsHint(content, ["more options", "options", "activity information"]) &&
            !containsHint(content, ["profile", "comment", "share", "interact", "participant", "present", "undo", "navigate", "select"])
          ) {
            push(candidate);
          }
        }

        const shareTrigger = findByHints(["share"]);
        if (shareTrigger) {
          const container = findProbeContainer(shareTrigger);
          if (container) {
            const candidates = Array.from(container.querySelectorAll<HTMLElement>(interactiveSelector)).filter((candidate) =>
              isVisible(candidate)
            );
            const shareIndex = candidates.indexOf(shareTrigger);
            const startIndex = shareIndex >= 0 ? shareIndex + 1 : 0;
            for (const candidate of candidates.slice(startIndex, startIndex + 8)) {
              if (!containsHint(getContent(candidate).toLowerCase(), ["share", "profile"])) {
                push(candidate);
              }
            }
          }
        }

        return collected;
      };

      const waitForZonesMenuItem = async (timeoutMs: number) => {
        const selectorMatch = await waitForVisible(selectors.exportZonesOption, timeoutMs);
        if (selectorMatch) {
          return selectorMatch;
        }

        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          const option =
            findByHints(["zones", "zone"], ["snapshot", "gallery", "picture", "pdf", "share"]) ??
            findContentByHints(["zones", "zone"], ["snapshot", "gallery", "picture", "pdf", "share"]);
          if (option) {
            return option;
          }

          await delay(100);
        }

        return null;
      };

      const openExportMenuForZones = async () => {
        const tryTrigger = async (candidate: HTMLElement) => {
          activate(candidate);
          let zonesEntry = await waitForZonesMenuItem(1_500);
          if (!zonesEntry) {
            const exportEntry =
              findByHints(["export", "download"], ["share"]) ?? findContentByHints(["export", "download"], ["share"]);
            if (exportEntry) {
              activate(exportEntry);
              zonesEntry = await waitForZonesMenuItem(2_000);
            }
          }

          if (!zonesEntry) {
            await dismissTransientUi();
            return null;
          }

          return zonesEntry;
        };

        const trigger = firstMatch(selectors.exportMenuButton) ?? findByHints(["export", "download"], ["share"]);
        if (trigger) {
          const zonesEntry = await tryTrigger(trigger);
          if (zonesEntry) {
            return zonesEntry;
          }
        }

        for (const candidate of getToolbarProbeCandidates()) {
          if (candidate === trigger) {
            continue;
          }

          const zonesEntry = await tryTrigger(candidate);
          if (zonesEntry) {
            return zonesEntry;
          }
        }

        return null;
      };

      const buildZoneKey = (value: string, index: number) =>
        value
          .normalize("NFKD")
          .replace(/[^\x00-\x7F]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 80) || `zone-${index + 1}`;

      const extractZones = (scope: ParentNode) => {
        const labelZones = getZoneLabels(scope)
          .map((candidate, index) => {
            const zoneName = normalizeText(getContent(candidate));
            return {
              zoneName,
              zoneKey: buildZoneKey(zoneName, index),
              index
            };
          })
          .filter((zone) => zone.zoneName.length > 0);

        if (labelZones.length > 0) {
          return labelZones;
        }

        const zones: Array<{ zoneName: string; zoneKey: string; index: number }> = [];
        const seen = new Set<string>();
        const genericHints = [
          "zones",
          "all zones",
          "select all",
          "pdf",
          "picture",
          "snapshot",
          "gallery",
          "export",
          "cancel",
          "close",
          "download",
          "format",
          "search",
          "selected"
        ];

        for (const candidate of contentCandidates(scope)) {
          const normalized = getContent(candidate).replace(/\s+/g, " ").trim();
          const lowered = normalized.toLowerCase();
          if (!normalized || normalized.length < 3 || containsHint(lowered, genericHints)) {
            continue;
          }

          const rect = candidate.getBoundingClientRect();
          if (rect.width < 40 || rect.height < 16) {
            continue;
          }

          const zoneKey = buildZoneKey(normalized, zones.length);
          if (seen.has(zoneKey)) {
            continue;
          }

          seen.add(zoneKey);
          zones.push({
            zoneName: normalized,
            zoneKey,
            index: zones.length
          });
        }

        return zones;
      };

      const zonesEntry = await openExportMenuForZones();
      if (!zonesEntry) {
        return {
          available: false,
          zones: [],
          detail: `zones-menu-item-not-found: ${collectDiagnostics()}`
        };
      }

      const countMatch = getContent(zonesEntry).match(/\b(\d{1,3})\b/);
      const zoneCount = countMatch ? Number.parseInt(countMatch[1] ?? "0", 10) : 0;

      const sourceDialog = zonesEntry.closest<HTMLElement>("[role='dialog'], [aria-modal='true']");
      activate(zonesEntry);
      const dialog = await waitForDialog(4_000, sourceDialog);
      if (!dialog) {
        await dismissTransientUi();
        return {
          available: zoneCount > 0,
          zones: zoneCount > 0 ? Array.from({ length: zoneCount }, (_, index) => ({
            zoneName: `Zone ${index + 1}`,
            zoneKey: `zone-${index + 1}`,
            index
          })) : [],
          detail: `zones-dialog-not-found: count=${zoneCount}; ${collectDiagnostics()}`
        };
      }

      await delay(250);
      const zones = extractZones(dialog);
      await dismissTransientUi();

      if (zones.length > 0) {
        return {
          available: true,
          zones,
          detail: `zones-dialog-discovered: ${zones.map((zone) => zone.zoneName).join(" | ")}`
        };
      }

      if (zoneCount > 0) {
        return {
          available: true,
          zones: Array.from({ length: zoneCount }, (_, index) => ({
            zoneName: `Zone ${index + 1}`,
            zoneKey: `zone-${index + 1}`,
            index
          })),
          detail: `zones-count-discovered: ${zoneCount}`
        };
      }

      return {
        available: false,
        zones: [],
        detail: `zones-dialog-empty: ${collectDiagnostics()}`
      };
    },
    args: [selectorRegistry.default]
  });

  return result?.result ?? { available: false, zones: [], detail: "zone-discovery-unavailable" };
}

async function runFormatExports(input: {
  tabId: number;
  runId: string;
  outputRoot: string;
  relativeRoot: string;
  board: ReturnType<typeof normalizeBoardRecord>;
  formats: ExportFormat[];
  logPrefix: string;
}): Promise<FormatExecutionResult[]> {
  if (input.formats.length === 0) {
    return [];
  }

  const results: FormatExecutionResult[] = [];
  let presenterMode: PresenterModeState = { active: false, entered: false };

  try {
    for (const format of input.formats) {
      let result = await executeFormatExport({
        tabId: input.tabId,
        runId: input.runId,
        outputRoot: input.outputRoot,
        relativeBoardRoot: input.relativeRoot,
        board: input.board,
        format
      });

      if (result.reason?.startsWith("EXPORT_MENU_NOT_FOUND") && !presenterMode.active) {
        presenterMode = await ensurePresenterMode(input.tabId);
        await appendHelperLog(
          input.runId,
          input.outputRoot,
          presenterMode.entered
            ? `${input.logPrefix}: presenter mode entered automatically`
            : presenterMode.active
              ? `${input.logPrefix}: presenter mode already active`
              : `${input.logPrefix}: presenter mode not available; continuing in current mode`
        );

        if (presenterMode.active) {
          result = await executeFormatExport({
            tabId: input.tabId,
            runId: input.runId,
            outputRoot: input.outputRoot,
            relativeBoardRoot: input.relativeRoot,
            board: input.board,
            format
          });
        }
      }

      results.push(result);
      await appendHelperLog(
        input.runId,
        input.outputRoot,
        `${input.logPrefix} ${format}: ${result.status}${result.reason ? ` (${result.reason})` : ""}`
      );
    }
  } finally {
    if (presenterMode.entered) {
      const exited = await exitPresenterMode(input.tabId);
      await appendHelperLog(
        input.runId,
        input.outputRoot,
        exited
          ? `${input.logPrefix}: presenter mode restored to previous state`
          : `${input.logPrefix}: presenter mode could not be restored automatically`
      );
    }
  }

  return results;
}

async function executeBoardPreparedArtifactExport(input: {
  tabId: number;
  runId: string;
  outputRoot: string;
  relativeDestination: string;
  board: ReturnType<typeof normalizeBoardRecord>;
  format: "pdf" | "picture";
  mode: Extract<RuntimeExportMode, "board-fit" | "board-selection">;
  artifactId: string;
  artifactLabel: string;
  preparationLabel: string;
  prepare: (fitResult: { applied: boolean; detail: string }) => Promise<{ ready: boolean; detail: string; reason?: string }>;
}): Promise<ArtifactExecutionResult> {
  const fitResult = await applyZoomToFitBoardForPass({
    tabId: input.tabId,
    runId: input.runId,
    outputRoot: input.outputRoot,
    label: input.preparationLabel
  });
  const preparation = await input.prepare(fitResult);
  await appendHelperLog(
    input.runId,
    input.outputRoot,
    `${input.preparationLabel} preparation: ${preparation.ready ? "ready" : "skipped"}${preparation.detail ? ` (${preparation.detail})` : ""}`
  );

  if (!preparation.ready) {
    return {
      id: input.artifactId,
      label: input.artifactLabel,
      format: input.format,
      mode: input.mode,
      status: "skipped",
      reason: formatFailureReason(preparation.reason, preparation.detail)
    };
  }

  return executeArtifactExport({
    tabId: input.tabId,
    runId: input.runId,
    outputRoot: input.outputRoot,
    relativeDestination: input.relativeDestination,
    board: input.board,
    format: input.format,
    mode: input.mode,
    artifactId: input.artifactId,
    artifactLabel: input.artifactLabel,
    label: input.artifactId.replace(/-/g, " "),
    trigger: () => triggerExportOption(input.tabId, input.format)
  });
}

async function executeArtifactExport(input: {
  tabId: number;
  runId: string;
  outputRoot: string;
  relativeDestination: string;
  board: ReturnType<typeof normalizeBoardRecord>;
  format: "pdf" | "picture";
  mode: "board-fit" | "board-selection";
  artifactId: string;
  artifactLabel: string;
  label: string;
  trigger: () => Promise<TriggerExportResult>;
}): Promise<ArtifactExecutionResult> {
  const config = runtimeExportConfig[input.format];
  const context = createExportTemplateContext(input.board, input.format, input.mode);
  const replayTriggeredAtMs = await tryReplayExportRecipe({
    tabId: input.tabId,
    runId: input.runId,
    outputRoot: input.outputRoot,
    context,
    filenameHints: config.filenameHints,
    label: input.label
  });

  if (typeof replayTriggeredAtMs === "number") {
    const replayDownload = await waitForDownload(input.tabId, replayTriggeredAtMs, config.filenameHints);
    if (replayDownload?.filename) {
      const replayRelativeDestination = input.format === "picture"
        ? `${input.relativeDestination}.${downloadExtension(replayDownload.filename, config.extension)}`
        : input.relativeDestination;
      await stageDownloadArtifact({
        runId: input.runId,
        outputRoot: input.outputRoot,
        download: replayDownload,
        relativeDestination: replayRelativeDestination
      });

      return {
        id: input.artifactId,
        label: input.artifactLabel,
        format: input.format,
        mode: input.mode,
        status: "done",
        file: replayRelativeDestination,
        delivery: "replay"
      };
    }

    await deleteLearnedExportRecipe(context).catch(() => undefined);
    await appendHelperLog(
      input.runId,
      input.outputRoot,
      `${input.label}: learned backend replay did not yield a download and was discarded; falling back to live trigger`
    );
  }

  const startedAtMs = Date.now();
  const triggerCapture = await triggerExportWithLearning(input.trigger, {
    tabId: input.tabId,
    runId: input.runId,
    outputRoot: input.outputRoot,
    context,
    filenameHints: config.filenameHints,
    label: input.label
  });
  const triggerResult = triggerCapture.actionResult;
  if (!triggerResult.ok) {
    return {
      id: input.artifactId,
      label: input.artifactLabel,
      format: input.format,
      mode: input.mode,
      status: "failed",
      reason: formatFailureReason(triggerResult.reason, triggerResult.details)
    };
  }

  const download = await waitForDownload(input.tabId, startedAtMs, config.filenameHints);
  if (!download?.filename) {
    return {
      id: input.artifactId,
      label: input.artifactLabel,
      format: input.format,
      mode: input.mode,
      status: "failed",
      reason: "DOWNLOAD_TIMEOUT"
    };
  }

  const relativeDestination = input.format === "picture"
    ? `${input.relativeDestination}.${downloadExtension(download.filename, config.extension)}`
    : input.relativeDestination;
  await stageDownloadArtifact({
    runId: input.runId,
    outputRoot: input.outputRoot,
    download,
    relativeDestination
  });

  return {
    id: input.artifactId,
    label: input.artifactLabel,
    format: input.format,
    mode: input.mode,
    status: "done",
    file: relativeDestination,
    delivery: "trigger"
  };
}

async function executeFormatExport(input: {
  tabId: number;
  runId: string;
  outputRoot: string;
  relativeBoardRoot: string;
  board: ReturnType<typeof normalizeBoardRecord>;
  format: ExportFormat;
}): Promise<FormatExecutionResult> {
  const config = runtimeExportConfig[input.format];
  const context = createExportTemplateContext(input.board, input.format, "board");
  const replayTriggeredAtMs = await tryReplayExportRecipe({
    tabId: input.tabId,
    runId: input.runId,
    outputRoot: input.outputRoot,
    context,
    filenameHints: config.filenameHints,
    label: `board ${input.format}`
  });

  if (typeof replayTriggeredAtMs === "number") {
    const replayDownload = await waitForDownload(input.tabId, replayTriggeredAtMs, config.filenameHints);
    if (replayDownload?.filename) {
      const replayRelativeDestination = `${input.relativeBoardRoot}/board.${config.extension}`;
      await stageDownloadArtifact({
        runId: input.runId,
        outputRoot: input.outputRoot,
        download: replayDownload,
        relativeDestination: replayRelativeDestination
      });

      return {
        format: input.format,
        status: "done",
        file: replayRelativeDestination
      };
    }

    await deleteLearnedExportRecipe(context).catch(() => undefined);
    await appendHelperLog(
      input.runId,
      input.outputRoot,
      `board ${input.format}: learned backend replay did not yield a download and was discarded; falling back to legacy trigger`
    );
  }

  const startedAtMs = Date.now();
  const triggerCapture = await triggerExportWithLearning(() => triggerExportOption(input.tabId, input.format), {
    tabId: input.tabId,
    runId: input.runId,
    outputRoot: input.outputRoot,
    context,
    filenameHints: config.filenameHints,
    label: `board ${input.format}`
  });
  const triggerResult = triggerCapture.actionResult;
  if (!triggerResult.ok) {
    return {
      format: input.format,
      status: triggerResult.reason === "EXPORT_OPTION_NOT_FOUND" ? "skipped" : "failed",
      reason: formatFailureReason(triggerResult.reason, triggerResult.details)
    };
  }

  const download = await waitForDownload(input.tabId, startedAtMs, config.filenameHints);
  if (!download?.filename) {
    return {
      format: input.format,
      status: "failed",
      reason: "DOWNLOAD_TIMEOUT"
    };
  }

  const relativeDestination = `${input.relativeBoardRoot}/board.${config.extension}`;
  await stageDownloadArtifact({
    runId: input.runId,
    outputRoot: input.outputRoot,
    download,
    relativeDestination
  });

  return {
    format: input.format,
    status: "done",
    file: relativeDestination
  };
}

async function executeZonePdfExport(input: {
  tabId: number;
  runId: string;
  outputRoot: string;
  relativeBoardRoot: string;
  board: ReturnType<typeof normalizeBoardRecord>;
  knownZones: ZoneRecord[];
}): Promise<{ artifact: ArtifactExecutionResult; zones: ZoneRecord[] }> {
  await applyZoomToFitBoardForPass({
    tabId: input.tabId,
    runId: input.runId,
    outputRoot: input.outputRoot,
    label: "zone pdf"
  });
  const context = createExportTemplateContext(input.board, "pdf", "zones");
  const replayTriggeredAtMs = await tryReplayExportRecipe({
    tabId: input.tabId,
    runId: input.runId,
    outputRoot: input.outputRoot,
    context,
    filenameHints: runtimeExportConfig.pdf.filenameHints,
    label: "zone pdf"
  });

  if (typeof replayTriggeredAtMs === "number") {
    const replayDownload = await waitForDownload(input.tabId, replayTriggeredAtMs, runtimeExportConfig.pdf.filenameHints);
    if (replayDownload?.filename) {
      const replayRelativeDestination = `${input.relativeBoardRoot}/board-zones.${runtimeExportConfig.pdf.extension}`;
      await stageDownloadArtifact({
        runId: input.runId,
        outputRoot: input.outputRoot,
        download: replayDownload,
        relativeDestination: replayRelativeDestination
      });

      return {
        zones: input.knownZones,
        artifact: {
          id: "zone-pdf",
          label: "Zone PDF",
          format: "pdf",
          mode: "zones",
          status: "done",
          file: replayRelativeDestination,
          delivery: "replay"
        }
      };
    }

    await deleteLearnedExportRecipe(context).catch(() => undefined);
    await appendHelperLog(input.runId, input.outputRoot, "zone pdf: learned backend replay did not yield a download and was discarded; falling back to legacy trigger");
  }

  const startedAtMs = Date.now();
  const triggerCapture = await triggerExportWithLearning(() => triggerZoneExport(input.tabId, "pdf"), {
    tabId: input.tabId,
    runId: input.runId,
    outputRoot: input.outputRoot,
    context,
    filenameHints: runtimeExportConfig.pdf.filenameHints,
    label: "zone pdf"
  });
  const triggerResult = triggerCapture.actionResult;
  if (!triggerResult.ok) {
    return {
      zones: triggerResult.zones.length > 0 ? triggerResult.zones : input.knownZones,
      artifact: {
        id: "zone-pdf",
        label: "Zone PDF",
        format: "pdf",
        mode: "zones",
        status: "failed",
        reason: formatFailureReason(triggerResult.reason, triggerResult.details)
      }
    };
  }

  if (triggerResult.details) {
    await appendHelperLog(input.runId, input.outputRoot, `zone export dialog: ${triggerResult.details}`);
  }

  const download = await waitForDownload(input.tabId, startedAtMs, runtimeExportConfig.pdf.filenameHints);
  if (!download?.filename) {
    return {
      zones: triggerResult.zones.length > 0 ? triggerResult.zones : input.knownZones,
      artifact: {
        id: "zone-pdf",
        label: "Zone PDF",
        format: "pdf",
        mode: "zones",
        status: "failed",
        reason: "DOWNLOAD_TIMEOUT"
      }
    };
  }

  const relativeDestination = `${input.relativeBoardRoot}/board-zones.${runtimeExportConfig.pdf.extension}`;
  await stageDownloadArtifact({
    runId: input.runId,
    outputRoot: input.outputRoot,
    download,
    relativeDestination
  });

  return {
    zones: triggerResult.zones.length > 0 ? triggerResult.zones : input.knownZones,
    artifact: {
      id: "zone-pdf",
      label: "Zone PDF",
      format: "pdf",
      mode: "zones",
      status: "done",
      file: relativeDestination,
      delivery: "trigger"
    }
  };
}

async function executeZonePictureExport(input: {
  tabId: number;
  runId: string;
  outputRoot: string;
  relativeBoardRoot: string;
  board: ReturnType<typeof normalizeBoardRecord>;
  knownZones: ZoneRecord[];
}): Promise<{ artifact: ArtifactExecutionResult; zones: ZoneRecord[] }> {
  await applyZoomToFitBoardForPass({
    tabId: input.tabId,
    runId: input.runId,
    outputRoot: input.outputRoot,
    label: "zone picture"
  });
  const context = createExportTemplateContext(input.board, "picture", "zones");
  const replayTriggeredAtMs = await tryReplayExportRecipe({
    tabId: input.tabId,
    runId: input.runId,
    outputRoot: input.outputRoot,
    context,
    filenameHints: runtimeExportConfig.picture.filenameHints,
    label: "zone picture"
  });

  if (typeof replayTriggeredAtMs === "number") {
    const replayDownload = await waitForDownload(input.tabId, replayTriggeredAtMs, runtimeExportConfig.picture.filenameHints);
    if (replayDownload?.filename) {
      const replayRelativeDestination = `${input.relativeBoardRoot}/board-zones-picture.${downloadExtension(replayDownload.filename, "zip")}`;
      await stageDownloadArtifact({
        runId: input.runId,
        outputRoot: input.outputRoot,
        download: replayDownload,
        relativeDestination: replayRelativeDestination
      });

      return {
        zones: input.knownZones,
        artifact: {
          id: "zone-picture",
          label: "Zone picture",
          format: "picture",
          mode: "zones",
          status: "done",
          file: replayRelativeDestination,
          delivery: "replay"
        }
      };
    }

    await deleteLearnedExportRecipe(context).catch(() => undefined);
    await appendHelperLog(
      input.runId,
      input.outputRoot,
      "zone picture: learned backend replay did not yield a download and was discarded; falling back to legacy trigger"
    );
  }

  const startedAtMs = Date.now();
  const triggerCapture = await triggerExportWithLearning(() => triggerZoneExport(input.tabId, "picture"), {
    tabId: input.tabId,
    runId: input.runId,
    outputRoot: input.outputRoot,
    context,
    filenameHints: runtimeExportConfig.picture.filenameHints,
    label: "zone picture"
  });
  const triggerResult = triggerCapture.actionResult;
  if (!triggerResult.ok) {
    return {
      zones: triggerResult.zones.length > 0 ? triggerResult.zones : input.knownZones,
      artifact: {
        id: "zone-picture",
        label: "Zone picture",
        format: "picture",
        mode: "zones",
        status: "failed",
        reason: formatFailureReason(triggerResult.reason, triggerResult.details)
      }
    };
  }

  if (triggerResult.details) {
    await appendHelperLog(input.runId, input.outputRoot, `zone picture dialog: ${triggerResult.details}`);
  }

  const download = await waitForDownload(input.tabId, startedAtMs, runtimeExportConfig.picture.filenameHints);
  if (!download?.filename) {
    return {
      zones: triggerResult.zones.length > 0 ? triggerResult.zones : input.knownZones,
      artifact: {
        id: "zone-picture",
        label: "Zone picture",
        format: "picture",
        mode: "zones",
        status: "failed",
        reason: "DOWNLOAD_TIMEOUT"
      }
    };
  }

  const relativeDestination = `${input.relativeBoardRoot}/board-zones-picture.${downloadExtension(download.filename, "zip")}`;
  await stageDownloadArtifact({
    runId: input.runId,
    outputRoot: input.outputRoot,
    download,
    relativeDestination
  });

  return {
    zones: triggerResult.zones.length > 0 ? triggerResult.zones : input.knownZones,
    artifact: {
      id: "zone-picture",
      label: "Zone picture",
      format: "picture",
      mode: "zones",
      status: "done",
      file: relativeDestination,
      delivery: "trigger"
    }
  };
}

function createExportTemplateContext(
  board: ReturnType<typeof normalizeBoardRecord>,
  format: RuntimeExportFormat,
  mode: RuntimeExportMode
): ExportTemplateContext {
  const origin = (() => {
    try {
      return new URL(board.boardUrl).origin;
    } catch {
      return new URL(recentBoardsUrl).origin;
    }
  })();

  return {
    origin,
    boardUrl: board.boardUrl,
    boardKey: board.boardKey,
    boardAccessCode: board.boardKey,
    format,
    mode
  };
}

async function tryReplayExportRecipe(input: {
  tabId: number;
  runId: string;
  outputRoot: string;
  context: ExportTemplateContext;
  filenameHints: string[];
  label: string;
}) {
  const recipe = await loadLearnedExportRecipe(input.context);
  if (!recipe) {
    return undefined;
  }

  const replayResult = await replayLearnedExportRecipe(input.tabId, recipe, input.context);
  if (!replayResult.ok || typeof replayResult.triggeredAtMs !== "number") {
    await deleteLearnedExportRecipe(input.context).catch(() => undefined);
    await appendHelperLog(
      input.runId,
      input.outputRoot,
      `${input.label}: learned backend replay failed and was discarded${replayResult.reason ? ` (${replayResult.reason})` : ""}${replayResult.details ? ` ${replayResult.details}` : ""}`
    );
    return undefined;
  }

  await appendHelperLog(input.runId, input.outputRoot, `${input.label}: replayed learned backend export recipe`);
  return replayResult.triggeredAtMs;
}

async function triggerExportWithLearning<TActionResult extends { ok: boolean }>(
  action: () => Promise<TActionResult>,
  input: {
    tabId: number;
    runId: string;
    outputRoot: string;
    context: ExportTemplateContext;
    filenameHints: string[];
    label: string;
  }
) {
  try {
    const capture = await captureExportNetwork(input.tabId, action);
    if (capture.actionResult.ok) {
      const recipe = learnExportRecipe(capture.requests, {
        context: input.context,
        filenameHints: input.filenameHints
      });

      if (recipe) {
        await saveLearnedExportRecipe(recipe);
        await appendHelperLog(input.runId, input.outputRoot, `${input.label}: learned backend export recipe from captured network flow`);
      } else {
        await appendHelperLog(input.runId, input.outputRoot, `${input.label}: export succeeded but no reusable backend recipe was learned`);
      }
    }

    return capture;
  } catch (error) {
    await appendHelperLog(
      input.runId,
      input.outputRoot,
      `${input.label}: debugger capture unavailable; falling back to direct trigger${error instanceof Error ? ` (${error.message})` : ""}`
    );
    return {
      actionResult: await action(),
      requests: []
    };
  }
}

async function triggerZoneExport(tabId: number, requestedFormat: ZoneExportKind): Promise<TriggerExportResult & { zones: ZoneRecord[] }> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (selectors: SelectorSet, requestedFormat: ZoneExportKind) => {
      const interactiveSelector = "button, [role='button'], [role='menuitem'], [role='menuitemradio'], [role='option'], [role='listitem'], a, li, label";
      const contentSelector = `${interactiveSelector}, [role='checkbox'], [role='dialog'] div, [role='dialog'] span, div, span`;

      const delay = (timeoutMs: number) => new Promise((resolve) => window.setTimeout(resolve, timeoutMs));

      const firstMatch = (entries: string[], scope: ParentNode = document) => {
        for (const selector of entries) {
          const match = scope.querySelector<HTMLElement>(selector);
          if (match) {
            return match;
          }
        }

        return null;
      };

      const isVisible = (element: HTMLElement | null) => {
        if (!element) {
          return false;
        }

        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      };

      const describeElement = (element: HTMLElement | null) => {
        if (!element) {
          return "";
        }

        return [
          element.tagName.toLowerCase(),
          element.getAttribute("role"),
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.getAttribute("data-testid"),
          element.innerText?.trim(),
          element.textContent?.trim()
        ]
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 140);
      };

      const getElementContent = (candidate: HTMLElement) =>
        [
          candidate.innerText,
          candidate.textContent,
          candidate.getAttribute("aria-label"),
          candidate.getAttribute("title"),
          candidate.getAttribute("data-testid")
        ]
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

      const normalizeText = (content: string) => content.replace(/\s+/g, " ").trim();

      const containsHint = (content: string, hints: string[]) => hints.some((hint) => content.includes(hint));

      const isExcluded = (content: string, excludeHints: string[]) => excludeHints.length > 0 && containsHint(content, excludeHints);

      const toClickable = (candidate: HTMLElement | null) => {
        if (!candidate) {
          return null;
        }

        if (candidate.matches(interactiveSelector)) {
          return candidate;
        }

        return candidate.closest<HTMLElement>(interactiveSelector);
      };

      const getInteractive = (scope: ParentNode = document) =>
        Array.from(scope.querySelectorAll<HTMLElement>(interactiveSelector)).filter((candidate) => isVisible(candidate));

      const getContentCandidates = (scope: ParentNode = document) =>
        Array.from(scope.querySelectorAll<HTMLElement>(contentSelector)).filter((candidate) => isVisible(candidate));

      const findInteractiveByHints = (hints: string[], excludeHints: string[] = [], scope: ParentNode = document) =>
        getInteractive(scope).find((candidate) => {
          const content = getElementContent(candidate);
          return containsHint(content, hints) && !isExcluded(content, excludeHints);
        }) ?? null;

      const findContentByHints = (hints: string[], excludeHints: string[] = [], scope: ParentNode = document) => {
        for (const candidate of getContentCandidates(scope)) {
          const content = getElementContent(candidate);
          if (!content || !containsHint(content, hints) || isExcluded(content, excludeHints)) {
            continue;
          }

          const clickable = toClickable(candidate);
          if (clickable && isVisible(clickable)) {
            return clickable;
          }
        }

        return null;
      };

      const waitForVisible = async (entries: string[], timeoutMs: number, scope: ParentNode = document) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          const match = firstMatch(entries, scope);
          if (isVisible(match)) {
            return match;
          }

          await delay(100);
        }

        return null;
      };

      const firstPresentMatch = <T extends Element>(entries: string[], scope: ParentNode = document) => {
        for (const selector of entries) {
          const match = scope.querySelector<T>(selector);
          if (match) {
            return match;
          }
        }

        return null;
      };

      const getZoneCheckboxLabels = (scope: ParentNode = document) =>
        Array.from(scope.querySelectorAll<HTMLElement>(selectors.zoneCheckboxLabel.join(",")))
          .filter((candidate) => isVisible(candidate))
          .filter((candidate) => Boolean(candidate.querySelector("input[type='checkbox']")));

      const isAllZonesLabel = (candidate: HTMLElement | null) => {
        if (!candidate) {
          return false;
        }

        const content = normalizeText(getElementContent(candidate));
        return content === "all zones" || content === "select all" || content.startsWith("all zones ");
      };

      const getZoneLabels = (scope: ParentNode = document) =>
        getZoneCheckboxLabels(scope).filter((candidate) => !isAllZonesLabel(candidate));

      const findSelectAllToggle = (scope: ParentNode = document) =>
        getZoneCheckboxLabels(scope).find((candidate) => isAllZonesLabel(candidate)) ?? null;

      const getZoneCheckboxInput = (candidate: HTMLElement | null) => candidate?.querySelector<HTMLInputElement>("input[type='checkbox']") ?? null;

      const hasZoneFormatSelect = (scope: ParentNode = document) => {
        const nativeSelect = firstPresentMatch<HTMLSelectElement>(selectors.zoneDialogFormatSelect, scope);
        if (nativeSelect) {
          const optionContent = Array.from(nativeSelect.options)
            .map((option) => normalizeText(`${option.value} ${option.textContent ?? ""}`).toLowerCase())
            .join(" ");
          if (containsHint(optionContent, ["pdf"]) && containsHint(optionContent, ["picture", "image"])) {
            return true;
          }
        }

        return Boolean(firstMatch(selectors.zoneDialogFormatButton, scope));
      };

      const isZoneSelectionDialog = (candidate: HTMLElement | null) => {
        if (!isVisible(candidate)) {
          return false;
        }

        const scope = candidate ?? undefined;
        return Boolean(
          firstMatch(selectors.zoneSelectAllButton, scope) ??
          findSelectAllToggle(scope) ??
          firstMatch(selectors.zoneDialogPdfOption, scope) ??
          firstMatch(selectors.zoneDialogPictureOption, scope) ??
          (getZoneLabels(scope).length > 0 && hasZoneFormatSelect(scope) ? candidate : null) ??
          findInteractiveByHints(["select all"], ["board", "all boards"], scope) ??
          findContentByHints(["select all"], ["board", "all boards"], scope)
        );
      };

      const waitForDialog = async (timeoutMs: number, sourceDialog: HTMLElement | null = null) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          const directCandidates = selectors.zonesDialog
            .flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)))
            .filter((candidate, index, all) => isVisible(candidate) && all.indexOf(candidate) === index);

          for (const candidate of directCandidates) {
            if (candidate === sourceDialog && !isZoneSelectionDialog(candidate)) {
              continue;
            }

            if (isZoneSelectionDialog(candidate)) {
              return candidate;
            }
          }

          const fallback = Array.from(document.querySelectorAll<HTMLElement>("[role='dialog'], [aria-modal='true']")).find((candidate) =>
            candidate !== sourceDialog && isZoneSelectionDialog(candidate)
          );
          if (fallback) {
            return fallback;
          }

          await delay(100);
        }

        return null;
      };

      const activateCandidate = (candidate: HTMLElement) => {
        candidate.scrollIntoView({ block: "center", inline: "center" });
        candidate.focus?.();
        candidate.click();
      };

      const dismissTransientUi = async () => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await delay(150);
      };

      const findProbeContainer = (element: HTMLElement) => {
        let current = element.parentElement;
        while (current) {
          if (current.querySelectorAll(interactiveSelector).length >= 4) {
            return current;
          }

          current = current.parentElement;
        }

        return element.parentElement;
      };

      const getToolbarProbeCandidates = () => {
        const collected: HTMLElement[] = [];
        const seen = new Set<HTMLElement>();
        const push = (candidate: HTMLElement | null) => {
          if (!candidate || seen.has(candidate) || !isVisible(candidate)) {
            return;
          }

          seen.add(candidate);
          collected.push(candidate);
        };

        for (const candidate of getInteractive()) {
          const content = getElementContent(candidate);
          if (
            containsHint(content, ["more options", "options", "activity information"]) &&
            !containsHint(content, ["profile", "comment", "share", "interact", "participant", "present", "undo", "navigate", "select"])
          ) {
            push(candidate);
          }
        }

        const shareTrigger = findInteractiveByHints(["share"]);
        if (shareTrigger) {
          const container = findProbeContainer(shareTrigger);
          if (container) {
            const candidates = Array.from(container.querySelectorAll<HTMLElement>(interactiveSelector)).filter((candidate) =>
              isVisible(candidate)
            );
            const shareIndex = candidates.indexOf(shareTrigger);
            const startIndex = shareIndex >= 0 ? shareIndex + 1 : 0;
            for (const candidate of candidates.slice(startIndex, startIndex + 8)) {
              if (!containsHint(getElementContent(candidate), ["share", "profile"])) {
                push(candidate);
              }
            }
          }
        }

        return collected;
      };

      const waitForZonesMenuItem = async (timeoutMs: number) => {
        const selectorMatch = await waitForVisible(selectors.exportZonesOption, timeoutMs);
        if (selectorMatch) {
          return selectorMatch;
        }

        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          const option =
            findInteractiveByHints(["zones", "zone"], ["snapshot", "gallery", "picture", "pdf", "share"]) ??
            findContentByHints(["zones", "zone"], ["snapshot", "gallery", "picture", "pdf", "share"]);
          if (option) {
            return option;
          }

          await delay(100);
        }

        return null;
      };

      const openExportMenuForZones = async () => {
        const tryTrigger = async (candidate: HTMLElement) => {
          if (!isVisible(candidate)) {
            return null;
          }

          activateCandidate(candidate);
          let zonesEntry = await waitForZonesMenuItem(1_500);
          if (!zonesEntry) {
            const exportEntry =
              findInteractiveByHints(["export", "download"], ["share"]) ?? findContentByHints(["export", "download"], ["share"]);
            if (exportEntry) {
              activateCandidate(exportEntry);
              zonesEntry = await waitForZonesMenuItem(2_000);
            }
          }

          if (!zonesEntry) {
            await dismissTransientUi();
            return null;
          }

          return zonesEntry;
        };

        const trigger =
          firstMatch(selectors.exportMenuButton) ??
          findInteractiveByHints(["export", "download"], ["share"]);
        if (trigger) {
          const zonesEntry = await tryTrigger(trigger);
          if (zonesEntry) {
            return zonesEntry;
          }
        }

        for (const candidate of getToolbarProbeCandidates()) {
          if (candidate === trigger) {
            continue;
          }

          const zonesEntry = await tryTrigger(candidate);
          if (zonesEntry) {
            return zonesEntry;
          }
        }

        return null;
      };

      const zoneKeyFromName = (name: string, index: number) =>
        name
          .normalize("NFKD")
          .replace(/[^\x00-\x7F]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 80) || `zone-${index + 1}`;

      const extractZonesFromDialog = (dialog: HTMLElement | Document) => {
        const labelZones = getZoneLabels(dialog)
          .map((candidate, index) => {
            const zoneName = normalizeText(
              [
                candidate.innerText,
                candidate.textContent,
                candidate.getAttribute("aria-label"),
                candidate.getAttribute("title")
              ]
                .filter(Boolean)
                .join(" ")
            );

            return {
              zoneName,
              zoneKey: zoneKeyFromName(zoneName, index),
              index
            };
          })
          .filter((zone) => zone.zoneName.length > 0);

        if (labelZones.length > 0) {
          return labelZones;
        }

        const candidates = getContentCandidates(dialog);
        const zones: Array<{ zoneName: string; zoneKey: string; index: number }> = [];
        const seen = new Set<string>();
        const genericHints = [
          "zones",
          "all zones",
          "select all",
          "pdf",
          "picture",
          "snapshot",
          "gallery",
          "export",
          "cancel",
          "close",
          "download",
          "format",
          "search",
          "selected"
        ];

        for (const candidate of candidates) {
          const normalized = normalizeText(
            [
              candidate.innerText,
              candidate.textContent,
              candidate.getAttribute("aria-label"),
              candidate.getAttribute("title")
            ]
              .filter(Boolean)
              .join(" ")
          );

          const lowered = normalized.toLowerCase();
          if (!normalized || normalized.length < 3 || containsHint(lowered, genericHints)) {
            continue;
          }

          const rect = candidate.getBoundingClientRect();
          if (rect.width < 40 || rect.height < 16) {
            continue;
          }

          const zoneKey = zoneKeyFromName(normalized, zones.length);
          if (seen.has(zoneKey)) {
            continue;
          }

          seen.add(zoneKey);
          zones.push({
            zoneName: normalized,
            zoneKey,
            index: zones.length
          });
        }

        return zones;
      };

      const areAllZonesSelected = (dialog: ParentNode) => {
        const zoneLabels = getZoneLabels(dialog);
        if (zoneLabels.length === 0) {
          return false;
        }

        return zoneLabels.every((candidate) => getZoneCheckboxInput(candidate)?.checked ?? false);
      };

      const ensureAllZonesSelected = async (dialog: HTMLElement) => {
        if (areAllZonesSelected(dialog)) {
          return true;
        }

        const selectAllToggle =
          firstMatch(selectors.zoneSelectAllButton, dialog) ??
          findSelectAllToggle(dialog) ??
          findInteractiveByHints(["select all"], ["board", "all boards"], dialog) ??
          findContentByHints(["select all"], ["board", "all boards"], dialog);

        const selectAllInput = getZoneCheckboxInput(selectAllToggle);
        if (selectAllToggle && !selectAllInput?.checked) {
          activateCandidate(selectAllToggle);
          await delay(250);
        }

        if (areAllZonesSelected(dialog)) {
          return true;
        }

        for (const zoneLabel of getZoneLabels(dialog)) {
          const input = getZoneCheckboxInput(zoneLabel);
          if (!input?.checked) {
            activateCandidate(zoneLabel);
            await delay(60);
          }
        }

        return areAllZonesSelected(dialog);
      };

      const setZoneExportFormat = async (dialog: HTMLElement, requestedFormat: ZoneExportKind) => {
        const nativeSelect = firstPresentMatch<HTMLSelectElement>(selectors.zoneDialogFormatSelect, dialog);
        if (nativeSelect) {
          const targetOption = Array.from(nativeSelect.options).find((option) => {
            const optionContent = normalizeText(`${option.value} ${option.textContent ?? ""}`).toLowerCase();
            return requestedFormat === "picture"
              ? containsHint(optionContent, ["picture"]) || containsHint(optionContent, ["image"]) || containsHint(optionContent, ["snapshot"])
              : containsHint(optionContent, ["pdf"]);
          });

          if (targetOption) {
            if (nativeSelect.value !== targetOption.value) {
              nativeSelect.value = targetOption.value;
              nativeSelect.dispatchEvent(new Event("input", { bubbles: true }));
              nativeSelect.dispatchEvent(new Event("change", { bubbles: true }));
            }

            await delay(200);
            return true;
          }
        }

        const formatOption = requestedFormat === "picture"
          ? firstMatch(selectors.zoneDialogPictureOption, dialog) ??
            findInteractiveByHints(["picture", "snapshot", "gallery", "image"], ["pdf", "zones"], dialog) ??
            findContentByHints(["picture", "snapshot", "gallery", "image"], ["pdf", "zones"], dialog)
          : firstMatch(selectors.zoneDialogPdfOption, dialog) ??
            findInteractiveByHints(["pdf"], ["picture", "snapshot", "gallery", "zones"], dialog) ??
            findContentByHints(["pdf"], ["picture", "snapshot", "gallery", "zones"], dialog);

        if (!formatOption) {
          return requestedFormat === "pdf";
        }

        activateCandidate(formatOption);
        await delay(200);
        return true;
      };

      const buildSyntheticZones = (count: number) =>
        Array.from({ length: count }, (_, index) => ({
          zoneName: `Zone ${index + 1}`,
          zoneKey: `zone-${index + 1}`,
          index
        }));

      const collectDiagnostics = () =>
        getInteractive()
          .map((candidate) => describeElement(candidate))
          .filter(Boolean)
          .slice(0, 20)
          .join(" | ");

      const collectDialogDiagnostics = (dialog: HTMLElement | null) => {
        if (!dialog) {
          return "dialog-missing";
        }

        const buttons = getInteractive(dialog)
          .map((candidate) => describeElement(candidate))
          .filter(Boolean)
          .slice(0, 12)
          .join(" | ");
        const text = getContentCandidates(dialog)
          .map((candidate) => getElementContent(candidate))
          .filter(Boolean)
          .slice(0, 18)
          .join(" | ");
        return `buttons=${buttons}; text=${text}`;
      };

      const waitForZoneDialogToFinish = async (dialog: HTMLElement, timeoutMs: number) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          if (!dialog.isConnected || !document.contains(dialog)) {
            return { finished: true, state: "detached" };
          }

          if (!isVisible(dialog)) {
            return { finished: true, state: "hidden" };
          }

          if (!isZoneSelectionDialog(dialog)) {
            return { finished: true, state: "transitioned" };
          }

          await delay(100);
        }

        return {
          finished: false,
          state: "timeout",
          details: collectDialogDiagnostics(dialog)
        };
      };

      const zonesEntry = await openExportMenuForZones();
      if (!zonesEntry) {
        return {
          ok: false,
          reason: "ZONE_EXPORT_NOT_AVAILABLE",
          details: collectDiagnostics(),
          zones: []
        };
      }

      const countMatch = getElementContent(zonesEntry).match(/\b(\d{1,3})\b/);
      const zoneCount = countMatch ? Number.parseInt(countMatch[1] ?? "0", 10) : 0;

      const sourceDialog = zonesEntry.closest<HTMLElement>("[role='dialog'], [aria-modal='true']");
      activateCandidate(zonesEntry);
      const dialog = await waitForDialog(4_000, sourceDialog);
      if (!dialog) {
        await dismissTransientUi();
        return {
          ok: false,
          reason: "ZONE_DIALOG_NOT_FOUND",
          details: collectDiagnostics(),
          zones: zoneCount > 0 ? buildSyntheticZones(zoneCount) : []
        };
      }

      await delay(250);
      const discoveredZones = extractZonesFromDialog(dialog);
      const zones = discoveredZones.length > 0 ? discoveredZones : zoneCount > 0 ? buildSyntheticZones(zoneCount) : [];

      const zoneSelectionApplied = await ensureAllZonesSelected(dialog);
      if (!zoneSelectionApplied) {
        await dismissTransientUi();
        return {
          ok: false,
          reason: "ZONE_SELECTION_NOT_APPLIED",
          details: collectDialogDiagnostics(dialog),
          zones
        };
      }

      const formatApplied = await setZoneExportFormat(dialog, requestedFormat);
      if (!formatApplied) {
        await dismissTransientUi();
        return {
          ok: false,
          reason: requestedFormat === "picture" ? "ZONE_PICTURE_OPTION_NOT_FOUND" : "ZONE_PDF_OPTION_NOT_FOUND",
          details: collectDialogDiagnostics(dialog),
          zones
        };
      }

      const exportButton =
        firstMatch(selectors.zoneDialogExportButton, dialog) ??
        findInteractiveByHints(["export", "download", "save"], ["export the board", "zones"], dialog) ??
        findContentByHints(["export", "download", "save"], ["export the board", "zones"], dialog);

      const dialogDiagnostics = collectDialogDiagnostics(dialog);
      if (exportButton) {
        activateCandidate(exportButton);
        const dialogCompletion = await waitForZoneDialogToFinish(dialog, 30_000);
        return {
          ok: dialogCompletion.finished,
          reason: dialogCompletion.finished ? undefined : "ZONE_EXPORT_DIALOG_TIMEOUT",
          details: `format=${requestedFormat}; dialogCompletion=${dialogCompletion.state}; zones=${zones.map((zone) => zone.zoneName).join(" | ")}; ${dialogCompletion.details ?? dialogDiagnostics}`,
          zones
        };
      }

      return {
        ok: true,
        details: `format=${requestedFormat}; dialogCompletion=export-button-missing; zones=${zones.map((zone) => zone.zoneName).join(" | ")}; ${dialogDiagnostics}`,
        zones
      };
    },
    args: [selectorRegistry.default, requestedFormat]
  });

  return result?.result ?? {
    ok: false,
    reason: "ZONE_EXPORT_UNAVAILABLE",
    details: "zone-export-execute-script-unavailable",
    zones: []
  };
}

async function triggerExportOption(tabId: number, format: TriggerableExportFormat): Promise<TriggerExportResult> {
  const selectorKey = runtimeExportConfig[format].selectorKey;
  const optionHints = runtimeExportConfig[format].optionHints;
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (
      selectors: SelectorSet,
      optionSelectorKey: keyof Pick<SelectorSet, "pdfOption" | "pictureOption" | "klxOption" | "zipOption">,
      formatHints: string[]
    ) => {
      const interactiveSelector = "button, [role='button'], [role='menuitem'], [role='menuitemradio'], a";
      const contentSelector = `${interactiveSelector}, [role='option'], div, span, li`;

      const firstMatch = (entries: string[]) => {
        for (const selector of entries) {
          const match = document.querySelector<HTMLElement>(selector);
          if (match) {
            return match;
          }
        }

        return null;
      };

      const isVisible = (element: HTMLElement | null) => {
        if (!element) {
          return false;
        }

        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      };

      const describeElement = (element: HTMLElement | null) => {
        if (!element) {
          return "";
        }

        const content = [
          element.tagName.toLowerCase(),
          element.getAttribute("role"),
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.getAttribute("data-testid"),
          element.innerText?.trim(),
          element.textContent?.trim()
        ]
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        return content.slice(0, 120);
      };

      const getInteractive = () =>
        Array.from(document.querySelectorAll<HTMLElement>(interactiveSelector)).filter((candidate) => isVisible(candidate));

      const getElementContent = (candidate: HTMLElement) =>
        [
          candidate.innerText,
          candidate.textContent,
          candidate.getAttribute("aria-label"),
          candidate.getAttribute("title"),
          candidate.getAttribute("data-testid")
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

      const containsHint = (content: string, hints: string[]) => hints.some((hint) => content.includes(hint));

      const isExcluded = (content: string, excludeHints: string[]) => excludeHints.length > 0 && containsHint(content, excludeHints);

      const toClickable = (candidate: HTMLElement | null) => {
        if (!candidate) {
          return null;
        }

        if (candidate.matches(interactiveSelector)) {
          return candidate;
        }

        return candidate.closest<HTMLElement>(interactiveSelector);
      };

      const findInteractiveByHints = (hints: string[], excludeHints: string[] = []) => {
        const interactive = getInteractive();
        return Array.from(interactive).find((candidate) => {
          const content = getElementContent(candidate);
          return containsHint(content, hints) && !isExcluded(content, excludeHints);
        }) ?? null;
      };

      const findContentByHints = (hints: string[], excludeHints: string[] = []) => {
        const candidates = Array.from(document.querySelectorAll<HTMLElement>(contentSelector)).filter((candidate) => isVisible(candidate));
        for (const candidate of candidates) {
          const content = getElementContent(candidate);
          if (!content || !containsHint(content, hints) || isExcluded(content, excludeHints)) {
            continue;
          }

          const clickable = toClickable(candidate);
          if (clickable && isVisible(clickable)) {
            return clickable;
          }
        }

        return null;
      };

      const waitForVisible = async (entries: string[], timeoutMs: number) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          const match = firstMatch(entries);
          if (isVisible(match)) {
            return match;
          }

          await new Promise((resolve) => window.setTimeout(resolve, 100));
        }

        return null;
      };

      const waitForOption = async (timeoutMs: number) => {
        const selectorMatch = await waitForVisible(selectors[optionSelectorKey], timeoutMs);
        if (selectorMatch) {
          return selectorMatch;
        }

        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          const option = findInteractiveByHints(formatHints, ["share"]) ?? findContentByHints(formatHints, ["share"]);
          if (option) {
            return option;
          }

          await new Promise((resolve) => window.setTimeout(resolve, 100));
        }

        return null;
      };

      const collectDiagnostics = () =>
        getInteractive()
          .map((candidate) => describeElement(candidate))
          .filter(Boolean)
          .slice(0, 16)
          .join(" | ");

      const findProbeContainer = (element: HTMLElement) => {
        let current = element.parentElement;
        while (current) {
          if (current.querySelectorAll(interactiveSelector).length >= 4) {
            return current;
          }

          current = current.parentElement;
        }

        return element.parentElement;
      };

      const getToolbarProbeCandidates = () => {
        const collected: HTMLElement[] = [];
        const seen = new Set<HTMLElement>();
        const push = (candidate: HTMLElement | null) => {
          if (!candidate || seen.has(candidate) || !isVisible(candidate)) {
            return;
          }

          seen.add(candidate);
          collected.push(candidate);
        };

        for (const candidate of getInteractive()) {
          const content = getElementContent(candidate);
          if (
            containsHint(content, ["more options", "options", "activity information"]) &&
            !containsHint(content, ["profile", "comment", "share", "interact", "participant", "present", "undo", "navigate", "select"])
          ) {
            push(candidate);
          }
        }

        const shareTrigger = findInteractiveByHints(["share"]);
        if (shareTrigger) {
          const container = findProbeContainer(shareTrigger);
          if (container) {
            const candidates = Array.from(container.querySelectorAll<HTMLElement>(interactiveSelector)).filter((candidate) =>
              isVisible(candidate)
            );
            const shareIndex = candidates.indexOf(shareTrigger);
            const startIndex = shareIndex >= 0 ? shareIndex + 1 : 0;
            for (const candidate of candidates.slice(startIndex, startIndex + 8)) {
              if (!containsHint(getElementContent(candidate), ["share", "profile"])) {
                push(candidate);
              }
            }
          }
        }

        return collected;
      };

      const dismissTransientUi = async () => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await new Promise((resolve) => window.setTimeout(resolve, 150));
      };

      const activateCandidate = (candidate: HTMLElement) => {
        candidate.scrollIntoView({ block: "center", inline: "center" });
        candidate.focus?.();
        candidate.click();
      };

      const tryTrigger = async (candidate: HTMLElement) => {
        if (!isVisible(candidate)) {
          return false;
        }

        activateCandidate(candidate);
        let option = await waitForOption(1_500);
        if (!option) {
          const exportEntry =
            findInteractiveByHints(["export", "download"], ["share"]) ?? findContentByHints(["export", "download"], ["share"]);
          if (exportEntry) {
            activateCandidate(exportEntry);
            option = await waitForOption(2_000);
          }
        }

        if (!option) {
          await dismissTransientUi();
          return false;
        }

        activateCandidate(option);
        return true;
      };

      const trigger = firstMatch(selectors.exportMenuButton) ?? findInteractiveByHints(["export", "download"], ["share"]);
      if (trigger && (await tryTrigger(trigger))) {
        return { ok: true };
      }

      for (const candidate of getToolbarProbeCandidates()) {
        if (trigger && candidate === trigger) {
          continue;
        }

        if (await tryTrigger(candidate)) {
          return { ok: true };
        }
      }

      return {
        ok: false,
        reason: trigger ? "EXPORT_OPTION_NOT_FOUND" : "EXPORT_MENU_NOT_FOUND",
        details: collectDiagnostics()
      };
    },
    args: [selectorRegistry.default, selectorKey, optionHints]
  });

  return result?.result ?? { ok: false, reason: "EXPORT_SCRIPT_FAILED" };
}

async function waitForDownload(
  tabId: number,
  triggeredAtMs: number,
  filenameHints: string[],
  timeoutMs = 90_000
): Promise<chrome.downloads.DownloadItem | undefined> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const downloads = await chrome.downloads.search({
      state: "complete",
      limit: 50,
      orderBy: ["-startTime"]
    });

    const candidates = downloads
      .filter((item) => typeof item.id === "number" && typeof item.filename === "string" && typeof item.startTime === "string")
      .map((item) => ({
        id: item.id as number,
        tabId,
        filename: item.filename as string,
        startedAtMs: Date.parse(item.startTime as string)
      }));

    const match = correlateDownload(
      {
        tabId,
        triggeredAtMs,
        windowBeforeMs: 1_000,
        windowAfterMs: timeoutMs,
        filenameHints
      },
      candidates
    );

    if (match) {
      return downloads.find((item) => item.id === match.id);
    }

    await sleep(1_000);
  }

  return undefined;
}

async function stageDownloadArtifact(input: {
  runId: string;
  outputRoot: string;
  download: chrome.downloads.DownloadItem;
  relativeDestination: string;
}) {
  if (!input.download.filename) {
    throw new Error("DOWNLOAD_FILENAME_MISSING");
  }

  await sendHelperMessage({
    type: "stageDownload",
    runId: input.runId,
    outputRoot: input.outputRoot,
    sourcePath: input.download.filename,
    relativeDestination: input.relativeDestination
  });

  await cleanupTemporaryBrowserDownload(input.download);
}

async function cleanupTemporaryBrowserDownload(download: chrome.downloads.DownloadItem) {
  if (typeof download.id !== "number") {
    return;
  }

  await chrome.downloads.removeFile(download.id).catch(() => undefined);
  await chrome.downloads.erase({ id: download.id }).catch(() => undefined);
}

async function appendHelperLog(runId: string, outputRoot: string, message: string) {
  await sendHelperMessage({
    type: "appendLog",
    runId,
    outputRoot,
    message
  });
}

async function logHelperMessage(message: string) {
  try {
    await sendHelperMessage({
      type: "appendLog",
      message
    });
  } catch {
    // Ignore logging failures.
  }
}

function formatFailureReason(reason: string | undefined, details: string | undefined): string | undefined {
  if (!reason) {
    return details;
  }

  if (!details) {
    return reason;
  }

  return `${reason}: ${details}`;
}

function summarizeFormatResults(results: FormatExecutionResult[]): string {
  if (results.length === 0) {
    return "no export actions were attempted";
  }

  return results
    .map((result) => `${result.format}=${result.status}${result.reason ? `[${result.reason}]` : ""}`)
    .join("; ");
}

function summarizePdfArtifacts(artifacts: ArtifactExecutionResult[]): FormatExecutionResult {
  const pdfArtifacts = artifacts.filter((artifact) => artifact.format === "pdf");
  if (pdfArtifacts.length === 0) {
    return {
      format: "pdf",
      status: "failed",
      reason: "NO_PDF_ARTIFACTS_ATTEMPTED"
    };
  }

  const successful = pdfArtifacts.filter((artifact) => artifact.status === "done");
  if (successful.length === 0) {
    return {
      format: "pdf",
      status: "failed",
      reason: pdfArtifacts
        .map((artifact) => `${artifact.id}=${artifact.status}${artifact.reason ? `[${artifact.reason}]` : ""}`)
        .join("; ")
    };
  }

  const preferred =
    successful.find((artifact) => artifact.mode === "board-selection") ??
    successful.find((artifact) => artifact.mode === "board-fit") ??
    successful[0];

  const warnings: string[] = [];
  if (!successful.some((artifact) => artifact.mode === "board-fit" || artifact.mode === "board-selection")) {
    warnings.push("BOARD_BACKUP_PDF_MISSING");
  }

  if (!successful.some((artifact) => artifact.mode === "board-selection")) {
    warnings.push("BOARD_SELECTION_PDF_MISSING");
  }

  if (successful.every((artifact) => artifact.delivery !== "replay")) {
    warnings.push("PDF_BACKEND_REPLAY_NOT_REUSED");
  }

  return {
    format: "pdf",
    status: "done",
    file: preferred?.file,
    reason: warnings.length > 0 ? warnings.join(", ") : undefined
  };
}

function summarizeOverallStatus(results: FormatExecutionResult[]): "done" | "failed" | "skipped" {
  if (results.length === 0) {
    return "skipped";
  }

  if (results.some((result) => result.status === "done")) {
    return "done";
  }

  if (results.some((result) => result.status === "failed")) {
    return "failed";
  }

  return "skipped";
}

function summarizeStatuses(results: FormatExecutionResult[]): Partial<Record<ExportFormat, "done" | "failed" | "skipped">> {
  const statuses: Partial<Record<ExportFormat, "done" | "failed" | "skipped">> = {};
  for (const format of exportFormatOrder) {
    const matching = results.filter((result) => result.format === format);
    if (matching.length > 0) {
      statuses[format] = summarizeOverallStatus(matching);
    }
  }

  return statuses;
}

function uniqueFormats(formats: ExportFormat[]): ExportFormat[] {
  return [...new Set(formats)];
}

function downloadExtension(filename: string, fallbackExtension: string): string {
  const basename = filename.split(/[\\/]/).pop() ?? "";
  const extensionIndex = basename.lastIndexOf(".");
  if (extensionIndex <= 0 || extensionIndex === basename.length - 1) {
    return fallbackExtension;
  }

  const normalized = basename.slice(extensionIndex + 1).toLowerCase().replace(/[^a-z0-9]+/g, "");
  return normalized.length > 0 ? normalized : fallbackExtension;
}

function resolveExportFormats(requestedFormats: ExportFormat[] | undefined): ExportFormat[] {
  const requested: ExportFormat[] = requestedFormats && requestedFormats.length > 0 ? requestedFormats : ["pdf"];
  return requested.filter((format, index, formats) => exportFormatOrder.includes(format) && formats.indexOf(format) === index);
}

function deriveBoardName(title: string | undefined, url: string): string {
  const cleanedTitle = (title ?? "").replace(/\s*[-|]\s*Klaxoon\s*$/i, "").trim();
  if (cleanedTitle.length > 0) {
    return cleanedTitle;
  }

  return inferBoardKey(url);
}

function slugify(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return normalized.length > 0 ? normalized : "item";
}

function sanitizeOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
