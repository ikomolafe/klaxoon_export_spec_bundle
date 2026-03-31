import { describe, expect, it } from "vitest";
import {
  formatPageAccessErrorMessage,
  isHostPermissionErrorMessage,
  isKlaxoonUrl,
  normalizeExtensionActionErrorMessage
} from "./tabAccess";

describe("tabAccess", () => {
  it("detects Klaxoon tabs", () => {
    expect(isKlaxoonUrl("https://europa.klaxoon.com/userspace/recent")).toBe(true);
    expect(isKlaxoonUrl("https://login.microsoftonline.com/example")).toBe(false);
  });

  it("normalizes host permission failures on non-Klaxoon tabs", () => {
    expect(
      normalizeExtensionActionErrorMessage(
        "Cannot access contents of the page. Extension manifest must request permission to access the respective host.",
        "https://login.microsoftonline.com/example"
      )
    ).toContain("enterprise SSO page");
  });

  it("normalizes active-tab export failures into a Klaxoon-specific instruction", () => {
    expect(
      normalizeExtensionActionErrorMessage("ACTIVE_TAB_NOT_KLAXOON_BOARD", "https://example.com")
    ).toContain("https://*.klaxoon.com");
  });

  it("preserves the reload guidance on Klaxoon tabs", () => {
    expect(
      formatPageAccessErrorMessage("https://europa.klaxoon.com/participate/board/ABC123")
    ).toContain("Reload the tab");
  });

  it("recognizes browser host-permission errors", () => {
    expect(
      isHostPermissionErrorMessage(
        "Cannot access contents of the page. Extension manifest must request permission to access the respective host."
      )
    ).toBe(true);
  });
});
