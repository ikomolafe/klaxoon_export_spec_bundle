import {
  applyTemplateValue,
  buildTemplateContext,
  extractResponseTemplateValues,
  type CapturedNetworkRequest,
  type ExportTemplateContext,
  type LearnedExportRecipe
} from "./exportNetworkRecipe";

type ReplayExportResult = {
  ok: boolean;
  triggeredAtMs?: number;
  reason?: string;
  details?: string;
};

type CapturedNetworkRequestInternal = CapturedNetworkRequest & {
  requestId: string;
};

type PageReplayRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  execution: "fetch" | "navigate";
  expectDownload: boolean;
};

type PageReplayResult = {
  ok: boolean;
  reason?: string;
  details?: string;
  responseHeaders?: Record<string, string>;
  responseText?: string;
  downloadTriggered?: boolean;
};

const debuggerVersion = "1.3";
const replayPollRetryWindowMs = 30_000;
const replayPollRetryDelayMs = 750;

export async function loadLearnedExportRecipe(context: Pick<ExportTemplateContext, "origin" | "mode" | "format">) {
  const key = exportRecipeStorageKey(context);
  const stored = await chrome.storage.local.get([key]);
  const candidate = stored[key];
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const recipe = candidate as LearnedExportRecipe;
  return recipe.version === 1 && Array.isArray(recipe.requests) ? recipe : null;
}

export async function hasLearnedExportRecipe(context: Pick<ExportTemplateContext, "origin" | "mode" | "format">) {
  return Boolean(await loadLearnedExportRecipe(context));
}

export async function saveLearnedExportRecipe(recipe: LearnedExportRecipe) {
  const key = exportRecipeStorageKey(recipe);
  await chrome.storage.local.set({
    [key]: recipe
  });
}

export async function deleteLearnedExportRecipe(context: Pick<ExportTemplateContext, "origin" | "mode" | "format">) {
  const key = exportRecipeStorageKey(context);
  await chrome.storage.local.remove(key);
}

export async function replayLearnedExportRecipe(
  tabId: number,
  recipe: LearnedExportRecipe,
  context: ExportTemplateContext
): Promise<ReplayExportResult> {
  const templateValues = buildTemplateContext(context);
  const triggeredAtMs = Date.now();

  for (let index = 0; index < recipe.requests.length; index += 1) {
    const requestTemplate = recipe.requests[index];
    const attemptStartedAt = Date.now();
    let attempts = 0;

    while (true) {
      const request = resolveReplayRequest(requestTemplate, templateValues);
      if (!request.ok) {
        return {
          ok: false,
          reason: "REPLAY_TEMPLATE_UNRESOLVED",
          details: request.details
        };
      }

      const pageResult = await executeReplayRequestInPage(tabId, request.request);
      if (!pageResult.ok) {
        return {
          ok: false,
          reason: pageResult.reason ?? "REPLAY_REQUEST_FAILED",
          details: pageResult.details
        };
      }

      Object.assign(templateValues, extractResponseTemplateValues(pageResult.responseHeaders, pageResult.responseText, index));

      const nextTemplate = recipe.requests[index + 1];
      if (!nextTemplate) {
        break;
      }

      const nextRequest = resolveReplayRequest(nextTemplate, templateValues);
      if (nextRequest.ok) {
        break;
      }

      if (!canRetryPendingPoll(request.request, pageResult.responseText, attempts, attemptStartedAt)) {
        return {
          ok: false,
          reason: "REPLAY_TEMPLATE_UNRESOLVED",
          details: nextRequest.details
        };
      }

      attempts += 1;
      await sleep(replayPollRetryDelayMs);
    }
  }

  return {
    ok: true,
    triggeredAtMs
  };
}

export async function captureExportNetwork<T>(
  tabId: number,
  action: () => Promise<T>,
  options?: { settleWindowMs?: number; maxSettleMs?: number }
): Promise<{ actionResult: T; requests: CapturedNetworkRequest[] }> {
  const debuggee: chrome.debugger.Debuggee = { tabId };
  const settleWindowMs = options?.settleWindowMs ?? 2_500;
  const maxSettleMs = options?.maxSettleMs ?? 15_000;
  const requests = new Map<string, CapturedNetworkRequestInternal>();
  const pendingReads = new Set<Promise<unknown>>();
  let lastEventAt = Date.now();

  const track = (promise: Promise<unknown>) => {
    pendingReads.add(promise);
    void promise.finally(() => pendingReads.delete(promise));
  };

  const readRequestBody = async (requestId: string) => {
    try {
      const response = (await chrome.debugger.sendCommand(debuggee, "Network.getRequestPostData", {
        requestId
      })) as { postData?: string };
      const request = requests.get(requestId);
      if (request && typeof response?.postData === "string" && response.postData.trim().length > 0) {
        request.requestBody = response.postData;
      }
    } catch {
      // Ignore missing request bodies.
    }
  };

  const readResponseBody = async (requestId: string) => {
    const request = requests.get(requestId);
    if (!request || !shouldReadResponseBody(request)) {
      return;
    }

    try {
      const response = (await chrome.debugger.sendCommand(debuggee, "Network.getResponseBody", {
        requestId
      })) as { body?: string; base64Encoded?: boolean };
      if (!requests.has(requestId) || typeof response?.body !== "string") {
        return;
      }

      request.responseBody = response.base64Encoded
        ? atob(response.body)
        : response.body;
    } catch {
      // Ignore binary and inaccessible responses.
    }
  };

  const listener = (source: chrome.debugger.Debuggee, method: string, params?: object) => {
    if (source.tabId !== tabId || !params) {
      return;
    }

    lastEventAt = Date.now();
    const eventParams = params as Record<string, unknown>;

    if (method === "Network.requestWillBeSent") {
      const requestId = String(eventParams.requestId ?? "");
      const requestDetails = eventParams.request as Record<string, unknown> | undefined;
      if (!requestId || !requestDetails || typeof requestDetails.url !== "string") {
        return;
      }

      requests.set(requestId, {
        requestId,
        url: requestDetails.url,
        method: typeof requestDetails.method === "string" ? requestDetails.method : "GET",
        type: typeof eventParams.type === "string" ? eventParams.type : undefined,
        requestHeaders: normalizeHeaders(requestDetails.headers),
        requestBody: typeof requestDetails.postData === "string" ? requestDetails.postData : undefined,
        startedAtMs: Date.now()
      });

      if (!requests.get(requestId)?.requestBody && normalizeMethod(requestDetails.method) !== "GET") {
        track(readRequestBody(requestId));
      }

      return;
    }

    if (method === "Network.responseReceived") {
      const requestId = String(eventParams.requestId ?? "");
      const responseDetails = eventParams.response as Record<string, unknown> | undefined;
      const existing = requests.get(requestId);
      if (!existing || !responseDetails) {
        return;
      }

      existing.responseStatus = typeof responseDetails.status === "number" ? responseDetails.status : undefined;
      existing.responseHeaders = normalizeHeaders(responseDetails.headers);
      existing.mimeType = typeof responseDetails.mimeType === "string" ? responseDetails.mimeType : undefined;
      return;
    }

    if (method === "Network.loadingFinished") {
      const requestId = String(eventParams.requestId ?? "");
      const existing = requests.get(requestId);
      if (!existing) {
        return;
      }

      existing.finishedAtMs = Date.now();
      track(readResponseBody(requestId));
    }
  };

  await chrome.debugger.attach(debuggee, debuggerVersion);
  chrome.debugger.onEvent.addListener(listener);
  await chrome.debugger.sendCommand(debuggee, "Network.enable");

  try {
    const actionResult = await action();
    const waitStartedAt = Date.now();
    while (Date.now() - waitStartedAt < maxSettleMs) {
      if (Date.now() - lastEventAt >= settleWindowMs && pendingReads.size === 0) {
        break;
      }

      await sleep(250);
    }

    await Promise.allSettled([...pendingReads]);

    return {
      actionResult,
      requests: [...requests.values()]
        .sort((left, right) => left.startedAtMs - right.startedAtMs)
        .map(({ requestId: _requestId, ...request }) => request)
    };
  } finally {
    chrome.debugger.onEvent.removeListener(listener);
    await chrome.debugger.detach(debuggee).catch(() => undefined);
  }
}

function exportRecipeStorageKey(context: Pick<ExportTemplateContext, "origin" | "mode" | "format">) {
  return `klaxoon-export-recipe::${encodeURIComponent(context.origin)}::${context.mode}::${context.format}`;
}

function resolveReplayRequest(
  template: LearnedExportRecipe["requests"][number],
  values: Record<string, string>
): { ok: true; request: PageReplayRequest } | { ok: false; details: string } {
  const url = applyTemplateValue(template.urlTemplate, values);
  if (containsUnresolvedPlaceholder(url)) {
    return {
      ok: false,
      details: `url=${template.urlTemplate}`
    };
  }

  const body = template.bodyTemplate ? applyTemplateValue(template.bodyTemplate, values) : undefined;
  if (body && containsUnresolvedPlaceholder(body)) {
    return {
      ok: false,
      details: `body=${template.bodyTemplate}`
    };
  }

  const headers: Record<string, string> = {};
  for (const [name, headerTemplate] of Object.entries(template.headers)) {
    const resolvedValue = applyTemplateValue(headerTemplate, values);
    if (containsUnresolvedPlaceholder(resolvedValue)) {
      return {
        ok: false,
        details: `header ${name}=${headerTemplate}`
      };
    }

    headers[name] = resolvedValue;
  }

  return {
    ok: true,
    request: {
      method: template.method,
      url,
      headers,
      body,
      execution: template.execution,
      expectDownload: template.expectDownload
    }
  };
}

async function executeReplayRequestInPage(tabId: number, request: PageReplayRequest): Promise<PageReplayResult> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (request: PageReplayRequest) => {
      const parseFilename = (contentDisposition: string | null) => {
        if (!contentDisposition) {
          return undefined;
        }

        const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
        if (utf8Match?.[1]) {
          return decodeURIComponent(utf8Match[1]);
        }

        const plainMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
        return plainMatch?.[1];
      };

      if (request.execution === "navigate") {
        const link = document.createElement("a");
        link.href = request.url;
        if (request.expectDownload) {
          link.download = "";
        }

        link.rel = "noopener noreferrer";
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();

        return {
          ok: true,
          downloadTriggered: true
        };
      }

      try {
        const response = await fetch(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
          credentials: "include"
        });

        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, name) => {
          responseHeaders[name] = value;
        });
        if (!response.ok) {
          const bodyText = await response.text().catch(() => "");
          return {
            ok: false,
            reason: "FETCH_FAILED",
            details: `${response.status} ${response.statusText}${bodyText ? ` ${bodyText.slice(0, 400)}` : ""}`.trim(),
            responseHeaders
          };
        }

        if (request.expectDownload) {
          const filename = parseFilename(response.headers.get("content-disposition"));
          const blob = await response.blob();
          const objectUrl = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = objectUrl;
          if (filename) {
            link.download = filename;
          }

          link.rel = "noopener noreferrer";
          link.style.display = "none";
          document.body.appendChild(link);
          link.click();
          link.remove();
          window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);

          return {
            ok: true,
            downloadTriggered: true,
            responseHeaders
          };
        }

        return {
          ok: true,
          responseHeaders,
          responseText: await response.text()
        };
      } catch (error) {
        return {
          ok: false,
          reason: "FETCH_THROWN",
          details: error instanceof Error ? error.message : String(error)
        };
      }
    },
    args: [request]
  });

  return result?.result ?? {
    ok: false,
    reason: "REPLAY_EXECUTE_SCRIPT_FAILED"
  };
}

function shouldReadResponseBody(request: CapturedNetworkRequestInternal) {
  const contentType = normalizeText(request.responseHeaders?.["content-type"] ?? request.mimeType ?? "");
  return (
    contentType.includes("json") ||
    contentType.startsWith("text/") ||
    request.url.toLowerCase().includes("export") ||
    request.url.toLowerCase().includes("download") ||
    request.url.toLowerCase().includes("job")
  );
}

function normalizeHeaders(headers: unknown): Record<string, string> {
  if (!headers || typeof headers !== "object") {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers as Record<string, unknown>)) {
    if (value === undefined || value === null) {
      continue;
    }

    normalized[name] = String(value);
  }

  return normalized;
}

function containsUnresolvedPlaceholder(value: string) {
  return /\{\{[^}]+\}\}/.test(value);
}

function canRetryPendingPoll(
  request: PageReplayRequest,
  responseText: string | undefined,
  attempts: number,
  startedAtMs: number
) {
  if (request.expectDownload || request.execution !== "fetch" || normalizeMethod(request.method) !== "GET") {
    return false;
  }

  if (attempts >= 60 || Date.now() - startedAtMs >= replayPollRetryWindowMs) {
    return false;
  }

  return looksLikePendingJobResponse(responseText);
}

function looksLikePendingJobResponse(responseText: string | undefined) {
  const normalized = normalizeText(responseText ?? "");
  if (!normalized) {
    return false;
  }

  const pendingHints = ["pending", "processing", "queued", "running", "preparing", "generating", "in_progress", "started", "waiting"];
  const readyHints = ["ready", "done", "complete", "completed", "success", "succeeded", "finished"];

  if (!pendingHints.some((hint) => normalized.includes(hint))) {
    return false;
  }

  if (readyHints.some((hint) => normalized.includes(hint))) {
    return false;
  }

  return true;
}

function normalizeMethod(method: unknown) {
  return String(method ?? "GET").toUpperCase();
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function sleep(timeoutMs: number) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}
