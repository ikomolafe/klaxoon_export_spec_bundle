/*
Copyright © 2026 KD Computers Ltd. All rights reserved.

This software and associated source code are proprietary and confidential to KD Computers Ltd.
Use, reproduction, modification, distribution, sublicensing, disclosure, or reverse engineering
is prohibited except as expressly permitted under a valid written licence agreement.

Governing law: England and Wales.
*/

import type { HelperRequest, HelperResponse } from "@klaxoon/shared";
import { errorCodes } from "./errors";

const hostName = "com.company.klaxoon_export";

export async function sendHelperMessage<TResponse extends HelperResponse>(
  request: HelperRequest
): Promise<TResponse> {
  const response = await chrome.runtime.sendNativeMessage(hostName, request);

  if (!response || typeof response !== "object" || !("ok" in response)) {
    throw new Error(errorCodes.invalidHelperResponse);
  }

  return response as TResponse;
}

export async function pingHelper(): Promise<boolean> {
  try {
    const response = await sendHelperMessage<{ ok: true; type: "pong" }>({ type: "ping" });
    return response.ok && response.type === "pong";
  } catch {
    return false;
  }
}
