import type { BoardRecord } from "@klaxoon/shared";

const boardUrlPattern = /\/(?:participate\/board|boards?|board)\/([^/?#]+)/i;

export function inferBoardKey(url: string): string {
  const match = url.match(boardUrlPattern);
  return match?.[1] ?? "unknown-board";
}

export function isKlaxoonBoardUrl(url: string): boolean {
  return boardUrlPattern.test(url);
}

export function normalizeBoardRecord(input: {
  workspaceName: string;
  boardName: string;
  boardUrl: string;
  experienceType?: "classic" | "new";
}): BoardRecord {
  return {
    workspaceName: input.workspaceName.trim(),
    boardName: input.boardName.trim(),
    boardUrl: input.boardUrl,
    boardKey: inferBoardKey(input.boardUrl),
    experienceType: input.experienceType ?? "new",
    exportCapabilitiesDetected: false
  };
}
