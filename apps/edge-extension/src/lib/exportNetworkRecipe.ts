import type { ExportFormat } from "./exportPlan";

export type RuntimeExportFormat = ExportFormat | "picture";
export type RuntimeExportMode = "board" | "zones" | "board-fit" | "board-selection";

export type CapturedNetworkRequest = {
  url: string;
  method: string;
  type?: string;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
  responseStatus?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  mimeType?: string;
  startedAtMs: number;
  finishedAtMs?: number;
};

export type ExportTemplateContext = {
  origin: string;
  boardUrl: string;
  boardKey: string;
  boardAccessCode?: string;
  format: RuntimeExportFormat;
  mode: RuntimeExportMode;
};

export type LearnedExportRequestTemplate = {
  method: string;
  urlTemplate: string;
  headers: Record<string, string>;
  bodyTemplate?: string;
  execution: "fetch" | "navigate";
  expectDownload: boolean;
};

export type LearnedExportRecipe = {
  version: 1;
  origin: string;
  mode: RuntimeExportMode;
  format: RuntimeExportFormat;
  learnedAt: string;
  filenameHints: string[];
  requests: LearnedExportRequestTemplate[];
};

type LearnExportRecipeInput = {
  context: ExportTemplateContext;
  filenameHints: string[];
};

type SyntheticDownloadTarget = {
  sourceIndex: number;
  urlTemplate: string;
};

const ignoredRequestHeaderNames = new Set([
  "accept-encoding",
  "accept-language",
  "cache-control",
  "connection",
  "content-length",
  "cookie",
  "dnt",
  "host",
  "origin",
  "pragma",
  "priority",
  "referer",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-user",
  "upgrade-insecure-requests",
  "user-agent"
]);

const staticAssetPattern = /\.(?:js|css|map|woff2?|ttf|svg|png|gif|webp|ico)(?:$|[?#])/i;
const uuidLikePattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const ephemeralRequestPattern = /download-temporary|signature=|sig=|token=|expires=|presigned|temporary|x-amz-/i;

export function buildTemplateContext(context: ExportTemplateContext): Record<string, string> {
  const accessCode = context.boardAccessCode ?? context.boardKey;

  return {
    "context.origin": context.origin,
    "context.board_url": context.boardUrl,
    "context.board_url_encoded": encodeURIComponent(context.boardUrl),
    "context.board_key": context.boardKey,
    "context.board_key_lower": context.boardKey.toLowerCase(),
    "context.board_key_upper": context.boardKey.toUpperCase(),
    "context.board_access_code": accessCode,
    "context.board_access_code_lower": accessCode.toLowerCase(),
    "context.board_access_code_upper": accessCode.toUpperCase(),
    "context.format": context.format
  };
}

export function applyTemplateValue(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, key) => values[key] ?? match);
}

export function learnExportRecipe(
  capturedRequests: readonly CapturedNetworkRequest[],
  input: LearnExportRecipeInput
): LearnedExportRecipe | null {
  const replayable = capturedRequests
    .filter((request) => isReplayableRequest(request))
    .sort((left, right) => left.startedAtMs - right.startedAtMs);

  const artifactIndex = findLastIndex(replayable, (request) => isArtifactRequest(request, input.filenameHints, input.context.format));
  const syntheticDownloadTarget = artifactIndex < 0
    ? findSyntheticDownloadTarget(replayable, input.filenameHints, input.context.format)
    : null;
  const terminalIndex = artifactIndex >= 0
    ? artifactIndex
    : syntheticDownloadTarget?.sourceIndex ?? -1;
  if (terminalIndex < 0) {
    return null;
  }

  let startIndex = terminalIndex;
  for (let index = terminalIndex - 1; index >= 0 && terminalIndex - index <= 6; index -= 1) {
    const candidate = replayable[index];
    const next = replayable[index + 1];
    if (!candidate || !next) {
      continue;
    }

    if (next.startedAtMs - candidate.startedAtMs > 15_000) {
      break;
    }

    if (isLikelyControlRequest(candidate, input.filenameHints, input.context.format) || isLinkedRequestPair(candidate, next)) {
      startIndex = index;
      continue;
    }

    if (startIndex !== artifactIndex) {
      break;
    }
  }

  const chain = replayable.slice(startIndex, terminalIndex + 1);
  if (chain.length === 0) {
    return null;
  }

  const templateValues = buildTemplateContext(input.context);
  const recipeRequests: LearnedExportRequestTemplate[] = [];

  for (let index = 0; index < chain.length; index += 1) {
    const request = chain[index];
    const headers = sanitizeRequestHeaders(request.requestHeaders);
    const expectDownload = !syntheticDownloadTarget && index === chain.length - 1 && isArtifactRequest(request, input.filenameHints, input.context.format);
    const urlTemplate = templatizeValue(request.url, templateValues);
    const bodyTemplate = request.requestBody ? templatizeValue(request.requestBody, templateValues) : undefined;
    const headerTemplates = Object.fromEntries(
      Object.entries(headers).map(([name, value]) => [name, templatizeValue(value, templateValues)])
    );

    recipeRequests.push({
      method: normalizeMethod(request.method),
      urlTemplate,
      headers: headerTemplates,
      bodyTemplate,
      execution: expectDownload && shouldNavigateForDownload(request, headers) ? "navigate" : "fetch",
      expectDownload
    });

    Object.assign(templateValues, extractResponseTemplateValues(request.responseHeaders, request.responseBody, index));
  }

  if (syntheticDownloadTarget) {
    recipeRequests.push({
      method: "GET",
      urlTemplate: syntheticDownloadTarget.urlTemplate,
      headers: {},
      execution: "navigate",
      expectDownload: true
    });
  }

  if (!isReusableRecipe(recipeRequests)) {
    return null;
  }

  return {
    version: 1,
    origin: input.context.origin,
    mode: input.context.mode,
    format: input.context.format,
    learnedAt: new Date().toISOString(),
    filenameHints: [...input.filenameHints],
    requests: recipeRequests
  };
}

function isReusableRecipe(requests: readonly LearnedExportRequestTemplate[]): boolean {
  return requests.every((request) => (
    isReusableTemplateValue(request.urlTemplate) &&
    (!request.bodyTemplate || isReusableTemplateValue(request.bodyTemplate)) &&
    Object.values(request.headers).every((value) => isReusableTemplateValue(value))
  ));
}

function isReusableTemplateValue(template: string): boolean {
  const literalPortion = template.replace(/\{\{[^}]+\}\}/g, "");
  if (literalPortion.trim().length === 0) {
    return true;
  }

  return !ephemeralRequestPattern.test(literalPortion) && !uuidLikePattern.test(literalPortion);
}

function findSyntheticDownloadTarget(
  replayable: readonly CapturedNetworkRequest[],
  filenameHints: readonly string[],
  format: RuntimeExportFormat
): SyntheticDownloadTarget | null {
  for (let index = replayable.length - 1; index >= 0; index -= 1) {
    const request = replayable[index];
    const responseStatus = request.responseStatus ?? 0;
    if (responseStatus < 200 || responseStatus >= 400) {
      continue;
    }

    const extractedValues = Object.entries(extractResponseTemplateValues(request.responseHeaders, request.responseBody, index));
    const matchingEntry = extractedValues.find(([, value]) => isArtifactUrlCandidate(value, filenameHints, format));
    if (!matchingEntry) {
      continue;
    }

    return {
      sourceIndex: index,
      urlTemplate: `{{${matchingEntry[0]}}}`
    };
  }

  return null;
}

function normalizeMethod(method: string | undefined): string {
  return (method ?? "GET").trim().toUpperCase() || "GET";
}

function isReplayableRequest(request: CapturedNetworkRequest): boolean {
  try {
    const url = new URL(request.url);
    if (!/^https?:$/i.test(url.protocol)) {
      return false;
    }

    return !staticAssetPattern.test(url.pathname);
  } catch {
    return false;
  }
}

function isArtifactRequest(request: CapturedNetworkRequest, filenameHints: readonly string[], format: RuntimeExportFormat): boolean {
  const responseStatus = request.responseStatus ?? 0;
  if (responseStatus < 200 || responseStatus >= 400) {
    return false;
  }

  const headers = normalizeHeaderMap(request.responseHeaders);
  const contentDisposition = headers["content-disposition"] ?? "";
  const contentType = normalizeText(headers["content-type"] ?? request.mimeType ?? "");
  const lowerUrl = normalizeText(request.url);
  const combinedHints = [...filenameHints.map((hint) => hint.toLowerCase()), format.toLowerCase()];

  if (contentDisposition.includes("attachment") || contentDisposition.includes("filename=")) {
    return true;
  }

  if (format === "pdf" && contentType.includes("pdf")) {
    return true;
  }

  if (format === "zip" && (contentType.includes("zip") || contentType.includes("octet-stream"))) {
    return true;
  }

  if (format === "klx" && (contentType.includes("octet-stream") || contentType.includes("zip") || lowerUrl.includes(".klx"))) {
    return true;
  }

  if (format === "picture" && (contentType.startsWith("image/") || contentType.includes("zip"))) {
    return true;
  }

  return combinedHints.some((hint) => lowerUrl.includes(hint) && !contentType.includes("json"));
}

function isArtifactUrlCandidate(value: string, filenameHints: readonly string[], format: RuntimeExportFormat): boolean {
  const normalized = normalizeText(value);
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    return false;
  }

  const hintMatches = [...filenameHints.map((hint) => hint.toLowerCase()), format.toLowerCase()]
    .some((hint) => normalized.includes(hint));
  const extensionMatches =
    (format === "pdf" && normalized.includes(".pdf")) ||
    (format === "zip" && normalized.includes(".zip")) ||
    (format === "klx" && normalized.includes(".klx")) ||
    (format === "picture" && [".png", ".jpg", ".jpeg", ".gif", ".webp", ".zip"].some((token) => normalized.includes(token)));

  return (
    extensionMatches ||
    hintMatches ||
    normalized.includes("download-temporary") ||
    normalized.includes("/download") ||
    normalized.includes("/file/") ||
    normalized.includes("temporary")
  );
}

function isLikelyControlRequest(
  request: CapturedNetworkRequest,
  filenameHints: readonly string[],
  format: RuntimeExportFormat
): boolean {
  const combinedText = normalizeText([
    request.url,
    request.requestBody,
    request.responseBody,
    request.mimeType,
    request.responseHeaders ? JSON.stringify(request.responseHeaders) : ""
  ].join(" "));
  const controlHints = [
    "export",
    "download",
    "snapshot",
    "gallery",
    "image",
    "picture",
    "archive",
    "file",
    "job",
    "status",
    "token",
    "signed",
    format
  ];

  if (controlHints.some((hint) => combinedText.includes(hint.toLowerCase()))) {
    return true;
  }

  if (normalizeMethod(request.method) !== "GET") {
    return true;
  }

  return filenameHints.some((hint) => combinedText.includes(hint.toLowerCase()));
}

function isLinkedRequestPair(previous: CapturedNetworkRequest, next: CapturedNetworkRequest): boolean {
  const nextCombined = `${next.url}\n${next.requestBody ?? ""}`;
  const candidateValues = Object.values(extractResponseTemplateValues(previous.responseHeaders, previous.responseBody, 0))
    .map((value) => value.trim())
    .filter((value) => value.length >= 3)
    .filter((value) => !value.startsWith("http://") && !value.startsWith("https://") ? !uuidLikePattern.test(value) || value.length >= 8 : true)
    .slice(0, 40);

  return candidateValues.some((value) => nextCombined.includes(value));
}

function sanitizeRequestHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }

  const sanitized: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.toLowerCase().trim();
    const value = String(rawValue ?? "").trim();
    if (!name || !value || ignoredRequestHeaderNames.has(name) || name.startsWith("sec-")) {
      continue;
    }

    sanitized[name] = value;
  }

  return sanitized;
}

function normalizeHeaderMap(headers: Record<string, string> | undefined): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    normalized[name.toLowerCase()] = String(value ?? "").toLowerCase();
  }
  return normalized;
}

function templatizeValue(value: string, templateValues: Record<string, string>): string {
  const replacements = Object.entries(templateValues)
    .filter(([, candidate]) => candidate.length > 0)
    .sort((left, right) => right[1].length - left[1].length);

  let templated = value;
  for (const [placeholder, candidate] of replacements) {
    if (!candidate || !templated.includes(candidate)) {
      continue;
    }

    templated = templated.split(candidate).join(`{{${placeholder}}}`);
  }

  return templated;
}

export function extractResponseTemplateValues(
  responseHeaders: Record<string, string> | undefined,
  responseBody: string | undefined,
  recipeIndex: number
): Record<string, string> {
  const values: Record<string, string> = {};
  const prefix = `responses.${recipeIndex}`;

  for (const [name, value] of Object.entries(normalizeHeaderMapPreserveCase(responseHeaders))) {
    if (value.trim().length > 0) {
      values[`${prefix}.headers.${name.toLowerCase()}`] = value;
    }
  }

  const body = responseBody?.trim();
  if (!body) {
    return values;
  }

  try {
    const parsed = JSON.parse(body) as unknown;
    flattenStringLeaves(parsed, `${prefix}.body`, values);
  } catch {
    values[`${prefix}.body`] = body;
  }

  return values;
}

function normalizeHeaderMapPreserveCase(headers: Record<string, string> | undefined): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    normalized[name] = String(value ?? "");
  }
  return normalized;
}

function flattenStringLeaves(value: unknown, prefix: string, output: Record<string, string>) {
  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized.length > 0) {
      output[prefix] = normalized;
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => flattenStringLeaves(entry, `${prefix}.${index}`, output));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    flattenStringLeaves(entry, `${prefix}.${key}`, output);
  }
}

function shouldNavigateForDownload(request: CapturedNetworkRequest, headers: Record<string, string>): boolean {
  if (normalizeMethod(request.method) !== "GET" || request.requestBody) {
    return false;
  }

  const remainingHeaders = Object.keys(headers).filter((name) => name !== "accept");
  if (remainingHeaders.length > 0) {
    return false;
  }

  try {
    const requestOrigin = new URL(request.url).origin;
    return requestOrigin !== "";
  } catch {
    return false;
  }
}

function findLastIndex<T>(entries: readonly T[], predicate: (value: T) => boolean): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (predicate(entries[index])) {
      return index;
    }
  }

  return -1;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
