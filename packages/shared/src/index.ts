/*
Copyright © 2026 KD Computers Ltd. All rights reserved.

This software and associated source code are proprietary and confidential to KD Computers Ltd.
Use, reproduction, modification, distribution, sublicensing, disclosure, or reverse engineering
is prohibited except as expressly permitted under a valid written licence agreement.

Governing law: England and Wales.
*/

export type ExportCapabilities = {
  pdf: boolean;
  klx: boolean;
  zip: boolean;
  docx: boolean;
};

export type BoardRecord = {
  workspaceName: string;
  boardName: string;
  boardUrl: string;
  boardKey: string;
  experienceType: "classic" | "new";
  exportCapabilitiesDetected: boolean;
};

export type DownloadCandidate = {
  id: number;
  tabId: number;
  filename: string;
  startedAtMs: number;
};

export type DownloadCorrelationInput = {
  tabId: number;
  triggeredAtMs: number;
  windowBeforeMs: number;
  windowAfterMs: number;
  filenameHints: string[];
};

export type RunManifest = {
  schemaVersion: "1.0.0";
  runId: string;
  startedAt: string;
  outputRoot: string;
  boards: Array<{
    workspaceName: string;
    boardName: string;
    boardKey: string;
    statuses: Partial<Record<"pdf" | "klx" | "zip", "done" | "failed" | "skipped">>;
    files: string[];
    artifacts?: Array<{
      id: string;
      label: string;
      format: "pdf" | "picture";
      mode: "zones" | "board-fit" | "board-selection";
      status: "done" | "failed" | "skipped";
      file?: string;
      reason?: string;
      delivery?: "replay" | "trigger";
    }>;
    zones?: Array<{
      zoneName: string;
      zoneKey: string;
      statuses: Partial<Record<"pdf" | "klx" | "zip", "done" | "failed" | "skipped">>;
      files: string[];
    }>;
  }>;
};

export type HelperRequest =
  | { type: "ping" }
  | { type: "chooseOutputRoot" }
  | { type: "prepareRun"; runId: string; outputRoot?: string }
  | { type: "appendLog"; runId?: string; outputRoot?: string; message: string }
  | { type: "writeManifest"; runId: string; outputRoot: string; manifest: RunManifest }
  | { type: "stageDownload"; runId: string; outputRoot: string; sourcePath: string; relativeDestination: string }
  | { type: "packageRun"; runId: string; outputRoot: string };

export type HelperResponse =
  | { ok: true; type: "pong" }
  | { ok: true; type: "outputRootChosen"; outputRoot: string }
  | { ok: true; type: "runPrepared"; runRoot: string; outputRoot: string }
  | { ok: true; type: "logAppended" }
  | { ok: true; type: "manifestWritten"; manifestPath: string }
  | { ok: true; type: "downloadStaged"; destinationPath: string }
  | { ok: true; type: "runPackaged"; archivePath: string }
  | { ok: false; errorCode: string; message: string };

export type ReadinessResponse = {
  helperConnected: boolean;
  signedIn: boolean;
  authStatus?: "checking" | "login_required" | "login_in_progress" | "authenticated" | "login_failed";
  authMessage?: string;
  authTabId?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function isReadinessResponse(value: unknown): value is ReadinessResponse {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.helperConnected !== "boolean" || typeof value.signedIn !== "boolean") {
    return false;
  }

  if ("authStatus" in value && value.authStatus !== undefined && typeof value.authStatus !== "string") {
    return false;
  }

  if ("authMessage" in value && value.authMessage !== undefined && typeof value.authMessage !== "string") {
    return false;
  }

  if ("authTabId" in value && value.authTabId !== undefined && typeof value.authTabId !== "number") {
    return false;
  }

  return true;
}
