# Klaxoon Bulk Export

Chromium MV3 extension plus .NET 8 native helper for exporting Klaxoon board PDFs from the user's authenticated browser session.

## What To Download

Recommended downloads are published on the GitHub Releases page for tagged versions:
- installer downloads from the release assets
- raw bundle downloads from the same release assets if you want the lower-level install scripts

Repo download locations:
- tagged releases: GitHub `Releases`
- branch builds: GitHub Actions artifact from the `release-bundles` workflow
- local source checkout builds: `release/installers/` and `release/assets/`

Installer files:
- Windows: `KlaxoonBulkExport-<version>-windows-x64-installer.zip`
- Linux: `klaxoon-bulk-export_<version>_linux-x64.deb`
- macOS Apple Silicon: `KlaxoonBulkExport-<version>-macos-arm64.pkg`
- macOS Intel: `KlaxoonBulkExport-<version>-macos-x64.pkg`

Raw bundle files:
- Windows: `KlaxoonBulkExport-<version>-windows-x64-bundle.zip`
- Linux: `KlaxoonBulkExport-<version>-linux-x64-bundle.tar.gz`
- macOS Apple Silicon: `KlaxoonBulkExport-<version>-macos-arm64-bundle.tar.gz`
- macOS Intel: `KlaxoonBulkExport-<version>-macos-x64-bundle.tar.gz`

## Fastest Path

For most users, use the installer for your OS.

### Windows installer
1. Download `KlaxoonBulkExport-<version>-windows-x64-installer.zip`.
2. Extract it.
3. Run `Install.cmd`.
4. Open your Chromium browser's extensions page.
5. Enable `Developer mode`.
6. Click `Load unpacked`.
7. Select `%LOCALAPPDATA%\KlaxoonBulkExport\browser-extension`.
8. Sign in to Klaxoon in that same browser profile.
9. Open the extension side panel and export PDFs.

### Linux installer
1. Download `klaxoon-bulk-export_<version>_linux-x64.deb`.
2. Install it with `sudo dpkg -i klaxoon-bulk-export_<version>_linux-x64.deb`.
3. Open your Chromium browser's extensions page.
4. Enable `Developer mode`.
5. Click `Load unpacked`.
6. Select `~/.local/share/klaxoon-bulk-export/linux-x64/browser-extension`.
7. Sign in to Klaxoon in that same browser profile.
8. Open the extension side panel and export PDFs.

### macOS installer
1. Download the `.pkg` that matches your Mac:
   - Apple Silicon: `KlaxoonBulkExport-<version>-macos-arm64.pkg`
   - Intel: `KlaxoonBulkExport-<version>-macos-x64.pkg`
2. Open the package and complete installation.
3. Open your Chromium browser's extensions page.
4. Enable `Developer mode`.
5. Click `Load unpacked`.
6. Select:
   - Apple Silicon: `~/Library/Application Support/KlaxoonBulkExport/macos-arm64/browser-extension`
   - Intel: `~/Library/Application Support/KlaxoonBulkExport/macos-x64/browser-extension`
7. Sign in to Klaxoon in that same browser profile.
8. Open the extension side panel and export PDFs.

## Raw Bundle Path

Use the raw bundle only if you want the lower-level install scripts.

### Windows raw bundle
1. Download `KlaxoonBulkExport-<version>-windows-x64-bundle.zip`.
2. Extract it.
3. Run `install.ps1`.
4. Load the unpacked extension from the `browser-extension/` folder that the script installs.

### Linux raw bundle
1. Download `KlaxoonBulkExport-<version>-linux-x64-bundle.tar.gz`.
2. Extract it.
3. Run `install.sh`.
4. Load the unpacked extension from the installed `browser-extension/` folder.

### macOS raw bundle
1. Download the matching macOS raw bundle tarball.
2. Extract it.
3. Run `install.sh`.
4. Load the unpacked extension from the installed `browser-extension/` folder.

## Supported Browsers

- Google Chrome
- Microsoft Edge
- Brave
- Chromium

Unsupported:
- Firefox
- Safari

## Current Behaviour

The current product is PDF-first:
- the side panel exposes `Export current board PDF` and `Export participated boards PDF`
- PDF export is the default path
- zip packaging is available, but it is opt-in and off by default
- when the user is not signed in, the side panel opens the normal Klaxoon page and waits for enterprise SSO to complete in the browser
- export progress is owned by the background worker and shared across side panels and tabs for the lifetime of the browser session

For each board, the default PDF coverage strategy is:
- `board-zones.pdf` when zone export is available
- `board-fit.pdf`
- `board-selection.pdf`

The current implementation is backend-first:
- participated-board discovery uses Klaxoon's authenticated activity endpoints when available, with DOM discovery only as a fallback
- export tries to replay the browser's authenticated backend job flow first, learning it from captured network traffic when needed
- the native helper stages files into a managed export tree and can package the run into a final zip archive when requested

## Export Output

Runtime exports are written under a normalized output tree:

```text
<selected-output-root-or-helper-default>/
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
              board-zones.pdf
              board-fit.pdf
              board-selection.pdf
    packages/
      2026-03-16_22-51-43__run-<run-id>.zip
```

## More Detail

See [INSTALL](/Users/citadel03/LinuxOSWork/AI/klaxoon_export_spec_bundle/klaxoon-bulk-export/docs/INSTALL.md), [DISTRIBUTION](/Users/citadel03/LinuxOSWork/AI/klaxoon_export_spec_bundle/klaxoon-bulk-export/docs/DISTRIBUTION.md), [SECURITY](/Users/citadel03/LinuxOSWork/AI/klaxoon_export_spec_bundle/klaxoon-bulk-export/docs/SECURITY.md), and [SUPPORT](/Users/citadel03/LinuxOSWork/AI/klaxoon_export_spec_bundle/klaxoon-bulk-export/docs/SUPPORT.md).
