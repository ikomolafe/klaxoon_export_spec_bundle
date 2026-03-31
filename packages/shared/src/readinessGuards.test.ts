/*
Copyright © 2026 KD Computers Ltd. All rights reserved.

This software and associated source code are proprietary and confidential to KD Computers Ltd.
Use, reproduction, modification, distribution, sublicensing, disclosure, or reverse engineering
is prohibited except as expressly permitted under a valid written licence agreement.

Governing law: England and Wales.
*/

import { describe, expect, it } from "vitest";
import { isReadinessResponse } from "./index";

describe("readiness guards", () => {
  it("accepts a valid readiness payload", () => {
    expect(
      isReadinessResponse({
        helperConnected: true,
        signedIn: true,
        authStatus: "authenticated",
        authMessage: "Session verified.",
        authTabId: 17
      })
    ).toBe(true);
  });

  it("rejects malformed readiness payloads", () => {
    expect(
      isReadinessResponse({
        helperConnected: true,
        signedIn: "yes"
      })
    ).toBe(false);
  });
});
