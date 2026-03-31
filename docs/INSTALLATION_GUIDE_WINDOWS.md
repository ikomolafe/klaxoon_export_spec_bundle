# Installation Guide Windows

## Bundle
Use `release/end-user/windows-x64/`.

## Steps
1. Run `install.ps1` from the bundle.
2. Confirm the helper and native messaging host were registered for the current user across the supported Chromium browsers.
3. Load the `browser-extension/` folder shown by the script into Google Chrome, Microsoft Edge, Brave, or Chromium.
4. Sign in to Klaxoon in that browser profile.
5. Open the side panel, choose a folder if required, and start a PDF export.

## Notes
- The helper is self-contained and does not require a separate .NET runtime on the target machine.
- Native messaging registration is written under the current user's Chromium-browser native messaging registry keys.
- The default export root is `%LOCALAPPDATA%\\KD Computers Ltd\\Klaxoon Bulk Export Utility\\exports`.
