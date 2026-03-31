import type { BoardRecord } from "@klaxoon/shared";
import { inferBoardKey, isKlaxoonBoardUrl, normalizeBoardRecord } from "./discovery";

type UnknownRecord = Record<string, unknown>;

export type ActivityPageSnapshot = {
  items?: unknown;
  next?: unknown;
  self?: unknown;
  total?: unknown;
};

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object";
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNestedString(source: UnknownRecord, ...keys: string[]): string | undefined {
  let current: unknown = source;
  for (const key of keys) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[key];
  }

  return readString(current);
}

function deriveWorkspaceName(activity: UnknownRecord): string {
  return (
    readString(activity.workspaceName) ??
    readNestedString(activity, "workspace", "name") ??
    readNestedString(activity, "network", "name") ??
    readNestedString(activity, "team", "name") ??
    readNestedString(activity, "author", "displayName") ??
    readNestedString(activity, "author", "name") ??
    readNestedString(activity, "author", "fullName") ??
    "participated"
  );
}

function deriveBoardUrl(activity: UnknownRecord, origin: string): string | null {
  const accessCode = readString(activity.accessCode);
  if (accessCode) {
    return new URL(`/participate/board/${accessCode.toUpperCase()}`, origin).href;
  }

  const webUrl = readString(activity.webUrl);
  if (!webUrl) {
    return null;
  }

  try {
    const absoluteUrl = new URL(webUrl, origin).href;
    if (isKlaxoonBoardUrl(absoluteUrl)) {
      return absoluteUrl;
    }

    const fallbackBoardKey = inferBoardKey(absoluteUrl);
    if (fallbackBoardKey !== "unknown-board") {
      return new URL(`/participate/board/${fallbackBoardKey}`, origin).href;
    }

    return absoluteUrl;
  } catch {
    return null;
  }
}

export function buildActivitiesApiUrl(origin: string, page: number, perPage = 60): string {
  const url = new URL("/manager/api/v1/activities", origin);
  url.searchParams.set("page", String(page));
  url.searchParams.set("perPage", String(perPage));
  url.searchParams.set("hasSeen", "true");
  url.searchParams.set("sort", "-lastAccessAt,+title");
  return url.href;
}

export function extractParticipatedBoardsFromActivityPages(
  pages: readonly ActivityPageSnapshot[],
  origin: string
): BoardRecord[] {
  const seenBoardUrls = new Set<string>();
  const boards: BoardRecord[] = [];

  for (const page of pages) {
    if (!Array.isArray(page.items)) {
      continue;
    }

    for (const item of page.items) {
      if (!isRecord(item) || readString(item.type)?.toLowerCase() !== "board") {
        continue;
      }

      const boardUrl = deriveBoardUrl(item, origin);
      if (!boardUrl || seenBoardUrls.has(boardUrl)) {
        continue;
      }

      seenBoardUrls.add(boardUrl);
      boards.push(
        normalizeBoardRecord({
          workspaceName: deriveWorkspaceName(item),
          boardName: readString(item.title) ?? inferBoardKey(boardUrl),
          boardUrl
        })
      );
    }
  }

  return boards;
}
