# Install

## Prerequisites
- A supported Chromium browser: Google Chrome, Microsoft Edge, Brave, or Chromium
- Node.js 20+ for local development
- .NET 8 SDK for local helper development

## End-user installers
Generate installers with:

```sh
npm run package:installers
npm run package:release-assets
```

Download locations:
- GitHub `Releases` for tagged versions
- GitHub Actions artifact from `release-bundles` for branch builds
- local source checkout output under `release/installers/` and `release/assets/`

Recommended install path by OS:
- Windows: extract `KlaxoonBulkExport-<version>-windows-x64-installer.zip`, then run `Install.cmd`
- Linux: run `sudo dpkg -i klaxoon-bulk-export_<version>_linux-x64.deb`
- macOS: open the matching `.pkg` for Apple Silicon or Intel

Installed extension locations:
- Windows: `%LOCALAPPDATA%\\KlaxoonBulkExport\\browser-extension`
- Linux: `~/.local/share/klaxoon-bulk-export/linux-x64/browser-extension`
- macOS Apple Silicon: `~/Library/Application Support/KlaxoonBulkExport/macos-arm64/browser-extension`
- macOS Intel: `~/Library/Application Support/KlaxoonBulkExport/macos-x64/browser-extension`

After install, load that `browser-extension` folder in Chrome, Edge, Brave, or Chromium.
On Windows, do not load the `browser-extension` folder from the extracted installer zip after the installer has copied the product into `%LOCALAPPDATA%`.

Recommended user flow in the browser:
1. Open `chrome://extensions` for Chrome or Chromium, `edge://extensions` for Edge, or `brave://extensions` for Brave.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the installed `browser-extension` folder for your OS.
5. On Windows, select `%LOCALAPPDATA%\\KlaxoonBulkExport\\browser-extension`.
6. Sign in to Klaxoon in that same browser profile.
7. After SSO finishes, return to a `https://*.klaxoon.com/` page such as `Recent` or an actual board tab.
8. Open the side panel and export PDFs.

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
6. Start exports from a `https://*.klaxoon.com/` page. The extension cannot read the enterprise SSO provider page itself.
7. Export the current board PDF or all participated-board PDFs.

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

Windows installer note:
- The shipped Windows x64 helper is published as a self-contained single-file executable. End users should not need to install a separate .NET runtime.

## Common failure modes
- `Specified native messaging host not found.`: the manifest file is missing or in the wrong directory.
- `Access to the native messaging host is forbidden.`: the manifest exists, but `allowed_origins` does not match the loaded extension ID.
- If you loaded `apps/edge-extension` instead of `apps/edge-extension/build/extension`, native messaging will not match the expected extension ID.

## End-user bundles
`npm run package:enduser` still produces the raw per-OS bundle directories under `release/end-user/`. The installer layer wraps those bundles into:
- a Windows installer archive with `Install.cmd`
- a Linux `.deb`
- macOS `.pkg` installers

Use the raw bundles only when you explicitly want the lower-level install scripts.

Release asset archives are also generated for those raw bundles:
- Windows: `KlaxoonBulkExport-<version>-windows-x64-bundle.zip`
- Linux: `KlaxoonBulkExport-<version>-linux-x64-bundle.tar.gz`
- macOS Apple Silicon: `KlaxoonBulkExport-<version>-macos-arm64-bundle.tar.gz`
- macOS Intel: `KlaxoonBulkExport-<version>-macos-x64-bundle.tar.gz`

## Validation
- Release packaging is validated in CI on Windows x64, Linux x64, macOS Intel, and macOS Apple Silicon.
- Release install smoke tests verify that the installer lays down the extension files, helper binary, and native-host manifests on each supported OS family.
