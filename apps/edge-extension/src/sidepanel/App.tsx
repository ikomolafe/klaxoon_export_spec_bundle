/*
Copyright © 2026 KD Computers Ltd. All rights reserved.

This software and associated source code are proprietary and confidential to KD Computers Ltd.
Use, reproduction, modification, distribution, sublicensing, disclosure, or reverse engineering
is prohibited except as expressly permitted under a valid written licence agreement.

Governing law: England and Wales.
*/

import { isReadinessResponse, type ReadinessResponse } from "@klaxoon/shared";
import { useEffect, useState } from "react";

type ExtensionActionResponse = {
  ok: boolean;
  message?: string;
  outputRoot?: string;
  archivePath?: string;
  runRoot?: string;
  authTabId?: number;
};

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

type ExportSessionState = {
  runId: string;
  scope: "current" | "participated";
  phase: "discovering" | "running" | "paused" | "stopped" | "completed" | "failed";
  message: string;
  zipPackage: boolean;
  outputRoot: string;
  requestedOutputRoot?: string;
  requestedFormats: string[];
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

type RunNotice = {
  tone: "info" | "success" | "error";
  title: string;
  message?: string;
  archivePath?: string;
  runRoot?: string;
};

type ActiveOperation = {
  title: string;
  summary: string;
};

const defaultReadinessState: ReadinessResponse = {
  helperConnected: false,
  signedIn: false,
  authStatus: "login_required",
  authMessage: "Open Klaxoon sign-in to continue through the normal enterprise SSO page."
};

const panelStyles = `
  :root {
    color-scheme: light;
    --panel-bg: linear-gradient(180deg, #f7faf7 0%, #eef3ef 100%);
    --panel-card: rgba(255, 255, 255, 0.88);
    --panel-card-strong: rgba(255, 255, 255, 0.96);
    --panel-line: rgba(28, 58, 45, 0.12);
    --panel-text: #193227;
    --panel-muted: #587164;
    --panel-accent: #0d8a5a;
    --panel-accent-soft: rgba(13, 138, 90, 0.12);
    --panel-danger: #b24a3e;
    --panel-danger-soft: rgba(178, 74, 62, 0.12);
    --panel-shadow: 0 18px 40px rgba(25, 50, 39, 0.08);
    font-family: "Aptos", "Segoe UI", "Helvetica Neue", sans-serif;
  }

  body {
    margin: 0;
    background: var(--panel-bg);
    color: var(--panel-text);
    min-width: 320px;
  }

  .panel-app {
    position: relative;
    min-height: 100vh;
    padding: 18px;
    box-sizing: border-box;
  }

  .panel-stack {
    display: grid;
    gap: 14px;
  }

  .panel-hero {
    padding: 18px;
    border-radius: 18px;
    background:
      radial-gradient(circle at top right, rgba(13, 138, 90, 0.18), transparent 34%),
      linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(247, 251, 248, 0.94));
    border: 1px solid var(--panel-line);
    box-shadow: var(--panel-shadow);
  }

  .panel-eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 999px;
    background: rgba(25, 50, 39, 0.06);
    color: var(--panel-muted);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .panel-eyebrow::before {
    content: "";
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--panel-accent);
  }

  .panel-title {
    margin: 14px 0 6px;
    font-size: 26px;
    line-height: 1.05;
    letter-spacing: -0.03em;
  }

  .panel-subtitle {
    margin: 0;
    color: var(--panel-muted);
    line-height: 1.5;
  }

  .panel-card {
    padding: 16px;
    border-radius: 18px;
    background: var(--panel-card);
    border: 1px solid var(--panel-line);
    box-shadow: var(--panel-shadow);
    backdrop-filter: blur(10px);
  }

  .panel-card h2,
  .panel-card h3 {
    margin: 0;
    font-size: 16px;
    letter-spacing: -0.02em;
  }

  .panel-card p {
    margin: 0;
    color: var(--panel-muted);
    line-height: 1.5;
  }

  .panel-grid {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .status-tile {
    padding: 12px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.74);
    border: 1px solid rgba(25, 50, 39, 0.08);
  }

  .status-label {
    display: block;
    margin-bottom: 6px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--panel-muted);
  }

  .status-value {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-weight: 700;
  }

  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: #c7d3cb;
  }

  .status-dot--ready {
    background: var(--panel-accent);
    box-shadow: 0 0 0 6px rgba(13, 138, 90, 0.12);
  }

  .status-dot--warn {
    background: #c6902a;
    box-shadow: 0 0 0 6px rgba(198, 144, 42, 0.12);
  }

  .field-label {
    display: grid;
    gap: 8px;
    font-size: 13px;
    font-weight: 700;
  }

  .field-input {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid rgba(25, 50, 39, 0.14);
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.92);
    padding: 12px 14px;
    color: var(--panel-text);
    font: inherit;
  }

  .field-input:focus {
    outline: 2px solid rgba(13, 138, 90, 0.18);
    border-color: rgba(13, 138, 90, 0.3);
  }

  .field-help {
    font-size: 12px;
    color: var(--panel-muted);
  }

  .option-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.72);
    border: 1px solid rgba(25, 50, 39, 0.08);
  }

  .option-row input {
    margin-top: 2px;
    accent-color: var(--panel-accent);
  }

  .option-title {
    display: block;
    font-weight: 700;
  }

  .option-copy {
    margin-top: 4px;
    font-size: 12px;
    color: var(--panel-muted);
  }

  .button-grid {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .button-grid--full {
    grid-template-columns: 1fr;
  }

  .panel-button {
    appearance: none;
    border: 0;
    border-radius: 14px;
    padding: 12px 14px;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
    transition: transform 120ms ease, opacity 120ms ease, box-shadow 120ms ease;
  }

  .panel-button:disabled {
    cursor: default;
    opacity: 0.5;
    transform: none;
    box-shadow: none;
  }

  .panel-button:not(:disabled):hover {
    transform: translateY(-1px);
  }

  .panel-button--primary {
    color: white;
    background: linear-gradient(135deg, #0d8a5a, #146e76);
    box-shadow: 0 14px 26px rgba(13, 138, 90, 0.18);
  }

  .panel-button--secondary {
    color: var(--panel-text);
    background: rgba(255, 255, 255, 0.84);
    border: 1px solid rgba(25, 50, 39, 0.12);
  }

  .panel-note {
    padding: 14px;
    border-radius: 16px;
    border: 1px solid transparent;
  }

  .panel-note--info {
    background: rgba(72, 110, 128, 0.08);
    border-color: rgba(72, 110, 128, 0.12);
  }

  .panel-note--success {
    background: var(--panel-accent-soft);
    border-color: rgba(13, 138, 90, 0.14);
  }

  .panel-note--error {
    background: var(--panel-danger-soft);
    border-color: rgba(178, 74, 62, 0.14);
  }

  .panel-note h3 {
    margin-bottom: 6px;
  }

  .path-list {
    display: grid;
    gap: 8px;
    margin-top: 12px;
  }

  .path-item {
    padding: 10px 12px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.72);
    border: 1px solid rgba(25, 50, 39, 0.08);
  }

  .path-label {
    display: block;
    margin-bottom: 4px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--panel-muted);
  }

  .path-value {
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--panel-text);
    word-break: break-word;
  }

  .progress-shell {
    display: grid;
    gap: 12px;
  }

  .progress-copy {
    display: grid;
    gap: 6px;
  }

  .progress-metrics {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    font-size: 12px;
    color: var(--panel-muted);
  }

  .progress-track {
    position: relative;
    height: 10px;
    border-radius: 999px;
    overflow: hidden;
    background: rgba(25, 50, 39, 0.08);
  }

  .progress-fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: inherit;
    background: linear-gradient(90deg, #0d8a5a, #3fb99a);
  }

  .progress-fill--indeterminate {
    width: 42%;
    animation: progress-slide 1.4s ease-in-out infinite;
  }

  .progress-board-list {
    display: grid;
    gap: 8px;
    max-height: 240px;
    overflow: auto;
    padding-right: 2px;
  }

  .progress-board {
    display: grid;
    gap: 4px;
    padding: 10px 12px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.72);
    border: 1px solid rgba(25, 50, 39, 0.08);
  }

  .progress-board-header {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    align-items: baseline;
  }

  .progress-board-name {
    font-weight: 700;
    line-height: 1.3;
  }

  .progress-board-status {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--panel-muted);
  }

  .progress-board-meta {
    font-size: 12px;
    color: var(--panel-muted);
  }

  .progress-board-detail {
    font-size: 12px;
    color: var(--panel-text);
    line-height: 1.45;
  }

  .progress-overlay {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: grid;
    place-items: end stretch;
    padding: 14px;
    background: rgba(245, 249, 246, 0.48);
    backdrop-filter: blur(6px);
  }

  .progress-overlay-card {
    padding: 16px;
    border-radius: 20px;
    background: var(--panel-card-strong);
    border: 1px solid rgba(25, 50, 39, 0.1);
    box-shadow: 0 24px 60px rgba(25, 50, 39, 0.16);
  }

  @keyframes progress-slide {
    0% { transform: translateX(-120%); }
    55% { transform: translateX(140%); }
    100% { transform: translateX(140%); }
  }

  @media (max-width: 440px) {
    .panel-app {
      padding: 14px;
    }

    .panel-grid,
    .button-grid {
      grid-template-columns: 1fr;
    }
  }
`;

export function App() {
  const [state, setState] = useState<ReadinessResponse>(defaultReadinessState);
  const [outputRoot, setOutputRoot] = useState("");
  const [zipPackage, setZipPackage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<RunNotice | null>(null);
  const [bulkProgress, setBulkProgress] = useState<BulkExportProgress | null>(null);
  const [activeOperation, setActiveOperation] = useState<ActiveOperation | null>(null);
  const [exportSession, setExportSession] = useState<ExportSessionState | null>(null);

  useEffect(() => {
    void refreshReadiness();
    void hydrateExportSession();
  }, []);

  useEffect(() => {
    if (state.authStatus !== "login_in_progress" && state.authStatus !== "checking") {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshReadiness();
    }, 1500);

    return () => window.clearInterval(intervalId);
  }, [state.authStatus]);

  useEffect(() => {
    const listener = (message: unknown) => {
      if (isExportSessionUpdatedMessage(message)) {
        applyExportSession(message.session);
        return;
      }

      if (isAuthSessionUpdatedMessage(message)) {
        void refreshReadiness();
        return;
      }

      if (isBulkExportProgressMessage(message)) {
        setBulkProgress(message.progress);
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  async function refreshReadiness() {
    const response = await sendMessage({ type: "readiness_check" });
    if (isReadinessResponse(response)) {
      setState(response);
    }
  }

  async function hydrateExportSession() {
    const session = await sendMessage<ExportSessionState | null>({ type: "get_export_session" });
    applyExportSession(session);
  }

  function applyExportSession(session: ExportSessionState | null) {
    setExportSession(session);

    if (!session) {
      setBusy(false);
      setActiveOperation(null);
      return;
    }

    if (session.scope === "participated") {
      setBulkProgress(sessionToBulkProgress(session));
    } else {
      setBulkProgress(null);
    }

    if (session.phase === "discovering" || session.phase === "running" || session.phase === "paused") {
      setBusy(true);
      setActiveOperation({
        title: session.scope === "participated" ? "Bulk PDF export in progress" : "Board PDF export in progress",
        summary: session.message
      });
      return;
    }

    setBusy(false);
    setActiveOperation(null);
    setNotice({
      tone: session.phase === "completed" ? "success" : session.phase === "stopped" ? "info" : "error",
      title: session.scope === "participated"
        ? session.phase === "completed" ? "Bulk export complete" : session.phase === "stopped" ? "Bulk export stopped" : "Bulk export failed"
        : session.phase === "completed" ? "Board export complete" : session.phase === "stopped" ? "Board export stopped" : "Board export failed",
      message: session.message,
      archivePath: session.archivePath,
      runRoot: session.runRoot
    });
  }

  async function controlExport(action: "pause_export" | "resume_export" | "stop_export" | "restart_export") {
    await withBusy(
      {
        title: action === "restart_export" ? "Restarting export" : "Updating export state",
        summary: action === "pause_export"
          ? "Pausing after the current board completes."
          : action === "resume_export"
            ? "Resuming the current export."
            : action === "stop_export"
              ? "Stopping after the current board completes."
              : "Restarting the last export run."
      },
      async () => {
        const response = await sendMessage<ExtensionActionResponse>({ type: action });
        if (isExtensionActionResponse(response)) {
          setNotice({
            tone: "info",
            title: action === "restart_export" ? "Export restarted" : "Export updated",
            message: response.message,
            archivePath: response.archivePath,
            runRoot: response.runRoot
          });
        }
      }
    );
  }

  async function startExport(scope: "current" | "participated" = "current") {
    await withBusy(
      {
        title: scope === "participated" ? "Bulk PDF export in progress" : "Board PDF export in progress",
        summary: scope === "participated"
          ? "Discovering participated boards, exporting zone and board-backup PDFs, and packaging the results."
          : "Exporting the current board through zone, fit-to-board, and confirmed-selection PDF passes."
      },
      async () => {
        setBulkProgress(null);

        const effectiveOutputRoot = outputRoot.trim();
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(effectiveOutputRoot)) {
          throw new Error("Use a local, mounted, or synced folder path. SharePoint web URLs are not valid output folders.");
        }

        const response = await sendMessage<ExtensionActionResponse>({
          type: scope === "participated" ? "start_bulk_export" : "start_export",
          outputRoot: effectiveOutputRoot || undefined,
          zipPackage
        });

        if (isExtensionActionResponse(response)) {
          setNotice({
            tone: "success",
            title: scope === "participated" ? "Bulk export complete" : "Board export complete",
            message: response.message,
            archivePath: response.archivePath,
            runRoot: response.runRoot
          });
        }
      }
    );
  }

  async function chooseOutputRoot() {
    await withBusy(
      {
        title: "Choosing save location",
        summary: "Waiting for the native folder picker."
      },
      async () => {
        const response = await sendMessage<ExtensionActionResponse>({ type: "choose_output_root" });
        if (!isExtensionActionResponse(response) || !response.ok || !response.outputRoot) {
          throw new Error(response.message ?? "No output folder selected.");
        }

        setOutputRoot(response.outputRoot);
        setNotice({
          tone: "info",
          title: "Save location updated",
          message: "The selected folder will be used as the export root for the next run.",
          runRoot: response.outputRoot
        });
      }
    );
  }

  async function startKlaxoonLogin() {
    try {
      setBusy(true);
      setActiveOperation({
        title: "Opening Klaxoon sign-in",
        summary: "Opening the normal Klaxoon page and handing off to the enterprise SSO flow."
      });
      setNotice(null);

      const response = await sendMessage<ExtensionActionResponse>({ type: "start_klaxoon_login" });
      if (isExtensionActionResponse(response)) {
        setNotice({
          tone: "info",
          title: "Klaxoon sign-in started",
          message: response.message ?? "Continue the sign-in flow in the opened browser tab."
        });
      }
    } catch (error) {
      setNotice({
        tone: "error",
        title: "Unable to start sign-in",
        message: error instanceof Error ? error.message : "Unexpected extension error."
      });
    } finally {
      setBusy(false);
      setActiveOperation(null);
      await refreshReadiness();
    }
  }

  async function withBusy(operation: ActiveOperation, work: () => Promise<void>) {
    try {
      setBusy(true);
      setActiveOperation(operation);
      setNotice(null);
      await work();
    } catch (error) {
      setNotice({
        tone: "error",
        title: "Export failed",
        message: error instanceof Error ? error.message : "Unexpected extension error."
      });
    } finally {
      setBusy(false);
      setActiveOperation(null);
      await refreshReadiness();
      await hydrateExportSession();
    }
  }

  const progressStats = deriveProgressStats(bulkProgress);
  const hasActiveSession = exportSession !== null && (exportSession.phase === "discovering" || exportSession.phase === "running" || exportSession.phase === "paused");
  const overlayVisible = (busy || hasActiveSession) && activeOperation !== null;
  const showStoredProgress = bulkProgress !== null && (bulkProgress.boards.length > 0 || bulkProgress.message.length > 0);
  const canPauseExport = exportSession?.scope === "participated" && (exportSession.phase === "discovering" || exportSession.phase === "running");
  const canResumeExport = exportSession?.scope === "participated" && exportSession.phase === "paused";
  const canStopExport = exportSession?.scope === "participated" && (exportSession.phase === "discovering" || exportSession.phase === "running" || exportSession.phase === "paused");
  const canRestartExport = exportSession !== null && !hasActiveSession;
  const authSummary = formatAuthSummary(state);
  const authDetail = state.authMessage ?? "Open Klaxoon sign-in to continue through the normal enterprise SSO page.";
  const canStartLogin = !busy && !state.signedIn;

  return (
    <main className="panel-app">
      <style>{panelStyles}</style>

      <div className="panel-stack">
        <section className="panel-hero">
          <span className="panel-eyebrow">Browser session export</span>
          <h1 className="panel-title">Klaxoon Bulk Export</h1>
          <p className="panel-subtitle">
            Exports zone, fit-to-board, and confirmed-selection backups from the current authenticated Klaxoon session, stages them into a chosen folder, and can package the whole run as a single zip.
          </p>
        </section>

        <section className="panel-card">
          <h2>Readiness</h2>
          <div className="panel-grid" style={{ marginTop: 12 }}>
            <div className="status-tile">
              <span className="status-label">Native helper</span>
              <span className="status-value">
                <span className={`status-dot ${state.helperConnected ? "status-dot--ready" : "status-dot--warn"}`} />
                {state.helperConnected ? "Connected" : "Unavailable"}
              </span>
            </div>
            <div className="status-tile">
              <span className="status-label">Klaxoon session</span>
              <span className="status-value">
                <span className={`status-dot ${state.signedIn ? "status-dot--ready" : "status-dot--warn"}`} />
                {authSummary}
              </span>
            </div>
          </div>
          <p style={{ marginTop: 12 }}>{authDetail}</p>
          {!state.signedIn ? (
            <div className="button-grid" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="panel-button panel-button--primary"
                onClick={() => void startKlaxoonLogin()}
                disabled={!canStartLogin}
              >
                {state.authStatus === "login_in_progress" ? "Continue Klaxoon SSO" : "Sign in to Klaxoon"}
              </button>
              <button
                type="button"
                className="panel-button panel-button--secondary"
                onClick={() => void refreshReadiness()}
                disabled={busy}
              >
                Retry session check
              </button>
            </div>
          ) : null}
        </section>

        <section className="panel-card">
          <h2>Export Setup</h2>
          <p style={{ marginTop: 8 }}>
            PDF is the default export. Each board now runs zone export when available, then fit-to-board and confirmed-selection backup passes to reduce partial captures.
          </p>

          <div className="panel-stack" style={{ marginTop: 14 }}>
            <label className="field-label">
              Save location
              <input
                className="field-input"
                type="text"
                value={outputRoot}
                onChange={(event) => setOutputRoot(event.target.value)}
                placeholder="Optional: choose a folder or use the helper default location"
                disabled={busy}
              />
            </label>
            <p className="field-help">
              Leave this blank to use the helper default export location. SharePoint web URLs are not valid output paths.
            </p>

            <label className="option-row">
              <input
                type="checkbox"
                checked={zipPackage}
                onChange={(event) => setZipPackage(event.target.checked)}
                disabled={busy}
              />
              <span>
                <span className="option-title">Create final zip package</span>
                <span className="option-copy">
                  When enabled, the run is packaged into one zip file under the export folder and the temporary browser downloads are cleaned up after staging.
                </span>
              </span>
            </label>

            <div className="button-grid">
              <button type="button" className="panel-button panel-button--secondary" onClick={() => void chooseOutputRoot()} disabled={busy || !state.helperConnected}>
                Choose folder
              </button>
              <button type="button" className="panel-button panel-button--secondary" onClick={() => setOutputRoot("")} disabled={busy}>
                Use default location
              </button>
            </div>

            <div className="button-grid button-grid--full">
              <button
                type="button"
                className="panel-button panel-button--primary"
                onClick={() => void startExport("current")}
                disabled={busy || !state.helperConnected || !state.signedIn}
              >
                Export current board PDF
              </button>
              <button
                type="button"
                className="panel-button panel-button--primary"
                onClick={() => void startExport("participated")}
                disabled={busy || !state.helperConnected || !state.signedIn}
              >
                Export participated boards PDF
              </button>
            </div>
          </div>
        </section>

        {notice ? (
          <section className={`panel-note panel-note--${notice.tone}`}>
            <h3>{notice.title}</h3>
            {notice.message ? <p>{notice.message}</p> : null}
            <div className="path-list">
              {notice.archivePath ? (
                <div className="path-item">
                  <span className="path-label">Zip package</span>
                  <p className="path-value">{notice.archivePath}</p>
                </div>
              ) : null}
              {notice.runRoot ? (
                <div className="path-item">
                  <span className="path-label">{notice.tone === "info" ? "Selected folder" : "Run folder"}</span>
                  <p className="path-value">{notice.runRoot}</p>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {exportSession ? (
          <section className="panel-card">
            <h2>Session</h2>
            <p style={{ marginTop: 8 }}>{exportSession.message}</p>
            <div className="path-list">
              <div className="path-item">
                <span className="path-label">Staged export root</span>
                <p className="path-value">{exportSession.outputRoot}</p>
              </div>
              {exportSession.runRoot ? (
                <div className="path-item">
                  <span className="path-label">Current run folder</span>
                  <p className="path-value">{exportSession.runRoot}</p>
                </div>
              ) : null}
              {exportSession.archivePath ? (
                <div className="path-item">
                  <span className="path-label">Latest zip package</span>
                  <p className="path-value">{exportSession.archivePath}</p>
                </div>
              ) : null}
            </div>
            <div className="button-grid" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="panel-button panel-button--secondary"
                onClick={() => void controlExport("pause_export")}
                disabled={!canPauseExport}
              >
                Pause
              </button>
              <button
                type="button"
                className="panel-button panel-button--secondary"
                onClick={() => void controlExport("resume_export")}
                disabled={!canResumeExport}
              >
                Resume
              </button>
              <button
                type="button"
                className="panel-button panel-button--secondary"
                onClick={() => void controlExport("stop_export")}
                disabled={!canStopExport}
              >
                Stop
              </button>
              <button
                type="button"
                className="panel-button panel-button--primary"
                onClick={() => void controlExport("restart_export")}
                disabled={!canRestartExport}
              >
                Restart
              </button>
            </div>
          </section>
        ) : null}

        {showStoredProgress ? (
          <section className="panel-card">
            <h2>Latest Progress</h2>
            <div className="progress-shell" style={{ marginTop: 12 }}>
              <div className="progress-copy">
                <p>{bulkProgress?.message}</p>
                <div className="progress-metrics">
                  <span>Processed {progressStats.processed}/{progressStats.total}</span>
                  <span>Completed {bulkProgress?.completedBoards ?? 0}</span>
                  <span>Failed {bulkProgress?.failedBoards ?? 0}</span>
                  {bulkProgress?.currentBoardName ? <span>Current {bulkProgress.currentBoardName}</span> : null}
                </div>
              </div>
              <div className="progress-track" aria-hidden="true">
                <div className="progress-fill" style={{ width: `${progressStats.percent}%` }} />
              </div>
              <div className="progress-board-list">
                {(bulkProgress?.boards ?? []).slice(0, 8).map((board) => (
                  <article key={board.boardKey} className="progress-board">
                    <div className="progress-board-header">
                      <span className="progress-board-name">{board.boardName}</span>
                      <span className="progress-board-status">{formatBoardStatus(board.status)}</span>
                    </div>
                    <span className="progress-board-meta">{board.workspaceName}</span>
                    {board.detail ? <span className="progress-board-detail">{board.detail}</span> : null}
                  </article>
                ))}
              </div>
            </div>
          </section>
        ) : null}
      </div>

      {overlayVisible ? (
        <div className="progress-overlay">
          <section className="progress-overlay-card">
            <div className="progress-shell">
              <div className="progress-copy">
                <h2>{bulkProgress?.phase === "discovering" ? "Discovering boards" : activeOperation.title}</h2>
                <p>{bulkProgress?.message ?? activeOperation.summary}</p>
                <div className="progress-metrics">
                  {bulkProgress ? (
                    <>
                      <span>Processed {progressStats.processed}/{progressStats.total}</span>
                      <span>Completed {bulkProgress.completedBoards}</span>
                      <span>Failed {bulkProgress.failedBoards}</span>
                      {bulkProgress.currentBoardName ? <span>Current {bulkProgress.currentBoardName}</span> : null}
                    </>
                  ) : (
                    <span>Preparing export session</span>
                  )}
                </div>
              </div>

              <div className="progress-track" aria-hidden="true">
                {bulkProgress ? (
                  <div className="progress-fill" style={{ width: `${progressStats.percent}%` }} />
                ) : (
                  <div className="progress-fill progress-fill--indeterminate" />
                )}
              </div>

              {bulkProgress && bulkProgress.boards.length > 0 ? (
                <div className="progress-board-list">
                  {bulkProgress.boards.slice(0, 8).map((board) => (
                    <article key={board.boardKey} className="progress-board">
                      <div className="progress-board-header">
                        <span className="progress-board-name">{board.boardName}</span>
                        <span className="progress-board-status">{formatBoardStatus(board.status)}</span>
                      </div>
                      <span className="progress-board-meta">{board.workspaceName}</span>
                      {board.detail ? <span className="progress-board-detail">{board.detail}</span> : null}
                    </article>
                  ))}
                </div>
              ) : null}

              {exportSession ? (
                <div className="button-grid" style={{ marginTop: 4 }}>
                  <button
                    type="button"
                    className="panel-button panel-button--secondary"
                    onClick={() => void controlExport("pause_export")}
                    disabled={!canPauseExport}
                  >
                    Pause
                  </button>
                  <button
                    type="button"
                    className="panel-button panel-button--secondary"
                    onClick={() => void controlExport("resume_export")}
                    disabled={!canResumeExport}
                  >
                    Resume
                  </button>
                  <button
                    type="button"
                    className="panel-button panel-button--secondary"
                    onClick={() => void controlExport("stop_export")}
                    disabled={!canStopExport}
                  >
                    Stop
                  </button>
                  <button
                    type="button"
                    className="panel-button panel-button--primary"
                    onClick={() => void controlExport("restart_export")}
                    disabled={!canRestartExport}
                  >
                    Restart
                  </button>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function deriveProgressStats(progress: BulkExportProgress | null) {
  const total = progress?.totalBoards ?? 0;
  const safeTotal = Math.max(total, 1);
  const processed = Math.min(
    total,
    (progress?.completedBoards ?? 0) + (progress?.failedBoards ?? 0)
  );

  return {
    total,
    processed,
    percent: Math.max(8, Math.round((processed / safeTotal) * 100))
  };
}

function formatBoardStatus(status: BulkExportBoardProgress["status"]) {
  return status
    .replace(/_/g, " ")
    .replace(/\b[a-z]/g, (match) => match.toUpperCase());
}

function sessionToBulkProgress(session: ExportSessionState): BulkExportProgress {
  return {
    runId: session.runId,
    phase: session.phase,
    totalBoards: session.totalBoards,
    completedBoards: session.completedBoards,
    failedBoards: session.failedBoards,
    currentBoardKey: session.currentBoardKey,
    currentBoardName: session.currentBoardName,
    message: session.message,
    boards: session.boards
  };
}

function isExtensionActionResponse(value: unknown): value is ExtensionActionResponse {
  return value !== null && typeof value === "object" && "ok" in value;
}

function isExportSessionUpdatedMessage(value: unknown): value is { type: "export_session_updated"; session: ExportSessionState | null } {
  return (
    value !== null &&
    typeof value === "object" &&
    "type" in value &&
    (value as { type?: unknown }).type === "export_session_updated" &&
    "session" in value
  );
}

function isBulkExportProgressMessage(value: unknown): value is { type: "bulk_export_progress"; progress: BulkExportProgress } {
  return (
    value !== null &&
    typeof value === "object" &&
    "type" in value &&
    (value as { type?: unknown }).type === "bulk_export_progress" &&
    "progress" in value
  );
}

function isAuthSessionUpdatedMessage(value: unknown): value is { type: "auth_session_updated" } {
  return (
    value !== null &&
    typeof value === "object" &&
    "type" in value &&
    (value as { type?: unknown }).type === "auth_session_updated"
  );
}

function formatAuthSummary(state: ReadinessResponse) {
  switch (state.authStatus) {
    case "authenticated":
      return "Authenticated";
    case "login_in_progress":
      return "SSO in progress";
    case "login_failed":
      return "Sign-in interrupted";
    case "checking":
      return "Checking session";
    case "login_required":
    default:
      return "Sign-in required";
  }
}

async function sendMessage<T>(message: object): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(response);
    });
  });
}
