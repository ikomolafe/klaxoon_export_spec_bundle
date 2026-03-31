# Installation Guide Windows

## Installer
Use `release/installers/KlaxoonBulkExport-<version>-windows-x64-installer.zip`.
For end users, the preferred download source is the GitHub `Releases` page for the tagged version.

## Steps
1. Extract the zip.
2. Run `Install.cmd`.
3. Confirm the helper and native messaging host were registered for the current user across the supported Chromium browsers.
4. Open `chrome://extensions` for Chrome or Chromium, `edge://extensions` for Edge, or `brave://extensions` for Brave.
5. Turn on the `Developer mode` toggle.
6. Click `Load unpacked`.
7. Select `%LOCALAPPDATA%\\KlaxoonBulkExport\\browser-extension`.
8. Do not load the `browser-extension` folder from the extracted zip. Load the installed folder under `%LOCALAPPDATA%`.
9. Sign in to Klaxoon in that browser profile.
10. After SSO finishes, return to a `https://*.klaxoon.com/` page such as `Recent` or an actual board tab.
11. Open the side panel, choose a folder if required, and start a PDF export.

## Notes
- The helper is self-contained and does not require a separate .NET runtime on the target machine.
- Native messaging registration is written under the current user's Chromium-browser native messaging registry keys.
- The default export root is `%LOCALAPPDATA%\\KD Computers Ltd\\Klaxoon Bulk Export Utility\\exports`.
- The extension can only inspect `https://*.klaxoon.com/*` tabs. It cannot read the enterprise SSO provider page directly.
