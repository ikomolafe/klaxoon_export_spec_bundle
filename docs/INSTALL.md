# Install

## Prerequisites
- A supported Chromium browser: Google Chrome, Microsoft Edge, Brave, or Chromium
- Node.js 20+ for local development
- .NET 8 SDK for local helper development

## Local development
1. Run `npm install` at the repository root.
2. Run `npm run dev:register-host`.
3. The command builds the shared package and extension, publishes the helper to `.dev/native-helper/<rid>/`, and writes native messaging registrations for the supported Chromium browsers under the current user.
4. Load the unpacked extension from `apps/edge-extension/build/extension`.

## Runtime workflow
1. Sign in to Klaxoon in the same Chromium browser profile.
2. Open the extension side panel.
3. Optionally choose an output folder, or leave it blank to use the helper default location.
4. If the folder picker is unavailable, especially on Linux without `zenity` or `kdialog`, type a local folder path manually in the side panel instead.
5. Optionally enable final zip packaging.
6. Export the current board PDF or all participated-board PDFs.

The side panel only exposes PDF export today. Zone-aware boards prefer the zone export flow first; if that is unavailable, the exporter falls back to the board-level PDF path.

## Export output layout
The output folder picker chooses a base directory. The helper always creates a managed export tree under that directory rather than writing files directly into the selected folder. If no folder is chosen, the helper uses its OS-specific default export root.

Example:

```text
<selected-folder-or-helper-default>/
  Klaxoon_Bulk_Export/
    .run-index/
    runs/
      2026-03-16_22-51-43__run-<run-id>/
        run-manifest.json
        run-summary.txt
        logs/
          app.log
        workspaces/
          <workspace-slug>/
            <board-slug>__<board-key>/
              board.pdf
    packages/
      2026-03-16_22-51-43__run-<run-id>.zip
```

Notes:
- `runs/` contains the authoritative working set, diagnostics, and per-board files.
- `packages/` contains the optional final ZIP output separate from the run folder, so the archive never nests itself.
- Browser `Downloads` is used only as a temporary landing area. Files are staged into the run folder and temporary downloads are cleaned up after staging.

Default helper export roots:
- macOS: `~/Library/Application Support/KD Computers Ltd/Klaxoon Bulk Export Utility/exports`
- Windows: `%LOCALAPPDATA%\\KD Computers Ltd\\Klaxoon Bulk Export Utility\\exports`
- Linux: `~/.local/share/KD Computers Ltd/Klaxoon Bulk Export Utility/exports`

## Native messaging registration
The helper host must be registered under the current user before the extension can call `com.company.klaxoon_export`.

### macOS
1. Ensure the helper binary is executable.
2. Create a native messaging manifest for each supported Chromium browser, for example:
   - `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.company.klaxoon_export.json`
   - `~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/com.company.klaxoon_export.json`
   - `~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.company.klaxoon_export.json`
   - `~/Library/Application Support/Chromium/NativeMessagingHosts/com.company.klaxoon_export.json`
3. Use this manifest content:

```json
{
  "name": "com.company.klaxoon_export",
  "description": "Klaxoon Bulk Export native helper",
  "path": "/ABSOLUTE/PATH/TO/Klaxoon.NativeHelper",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://hkkniaifdcccdnfoahdnoheieoenogoj/"
  ]
}
```

4. Load the unpacked extension from `apps/edge-extension/build/extension`.
5. In your supported Chromium browser's extensions page, confirm the extension ID is `hkkniaifdcccdnfoahdnoheieoenogoj`.

### Linux
1. Ensure the helper binary is executable.
2. Create a native messaging manifest for each supported Chromium browser, for example:
   - `~/.config/google-chrome/NativeMessagingHosts/com.company.klaxoon_export.json`
   - `~/.config/microsoft-edge/NativeMessagingHosts/com.company.klaxoon_export.json`
   - `~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.company.klaxoon_export.json`
   - `~/.config/chromium/NativeMessagingHosts/com.company.klaxoon_export.json`
3. Use the same JSON structure as above, with the Linux helper path.
4. Load the unpacked extension from `apps/edge-extension/build/extension`.

### Windows
1. Create a manifest file such as `%LOCALAPPDATA%\KlaxoonBulkExport\com.company.klaxoon_export.json`.
2. Use the same JSON structure as above, with the full helper `.exe` path and escaped backslashes.
3. Register the manifest path in the native messaging registry key for each supported Chromium browser, for example:
   - `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.company.klaxoon_export`
   - `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.company.klaxoon_export`
   - `HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.company.klaxoon_export`
   - `HKCU\Software\Chromium\NativeMessagingHosts\com.company.klaxoon_export`
4. Set each registry default value to the full manifest file path.
5. Load the unpacked extension from `apps/edge-extension/build/extension`.

## Common failure modes
- `Specified native messaging host not found.`: the manifest file is missing or in the wrong directory.
- `Access to the native messaging host is forbidden.`: the manifest exists, but `allowed_origins` does not match the loaded extension ID.
- If you loaded `apps/edge-extension` instead of `apps/edge-extension/build/extension`, native messaging will not match the expected extension ID.

## End-user bundles
1. Run `npm run package:enduser`.
2. Pick the OS-specific folder under `release/end-user/`.
3. Run the included installer script for that OS:
   - Windows: `install.ps1`
   - Linux/macOS: `install.sh`
4. Load the bundled `browser-extension/` folder in a supported Chromium browser.

The release bundle includes a self-contained native helper, browser extension assets, and native messaging manifest/install scaffolding for the target OS.

## Validation
- Release packaging is validated in CI on Windows x64, Linux x64, macOS Intel, and macOS Apple Silicon.
- Release install smoke tests verify that the installer lays down the extension files, helper binary, and native-host manifests on each supported OS family.
