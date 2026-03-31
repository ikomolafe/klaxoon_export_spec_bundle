# Installation Guide Windows

## Installer
Use `release/installers/KlaxoonBulkExport-<version>-windows-x64-installer.zip`.
For end users, the preferred download source is the GitHub `Releases` page for the tagged version.

## Steps
1. Extract the zip.
2. Run `Install.cmd`.
3. Confirm the helper and native messaging host were registered for the current user across the supported Chromium browsers.
4. Load `%LOCALAPPDATA%\\KlaxoonBulkExport\\browser-extension` into Google Chrome, Microsoft Edge, Brave, or Chromium.
5. Sign in to Klaxoon in that browser profile.
6. Open the side panel, choose a folder if required, and start a PDF export.

## Notes
- The helper is self-contained and does not require a separate .NET runtime on the target machine.
- Native messaging registration is written under the current user's Chromium-browser native messaging registry keys.
- The default export root is `%LOCALAPPDATA%\\KD Computers Ltd\\Klaxoon Bulk Export Utility\\exports`.
