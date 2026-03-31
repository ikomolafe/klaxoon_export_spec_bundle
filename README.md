# Klaxoon Bulk Export

Chromium MV3 extension plus .NET 8 native helper for exporting Klaxoon board PDFs from the user's authenticated browser session.

## What To Download

Current stable release:
- [`v0.1.3`](https://github.com/ikomolafe/klaxoon_export_spec_bundle/releases/tag/v0.1.3)
- [Latest release redirect](https://github.com/ikomolafe/klaxoon_export_spec_bundle/releases/latest)

Recommended downloads are published on the [GitHub Releases page](https://github.com/ikomolafe/klaxoon_export_spec_bundle/releases) for tagged versions:
- installer downloads from the release assets
- raw bundle downloads from the same release assets if you want the lower-level install scripts

Repo download locations:
- tagged releases: [GitHub Releases](https://github.com/ikomolafe/klaxoon_export_spec_bundle/releases)
- branch builds: [GitHub Actions `release-bundles` workflow](https://github.com/ikomolafe/klaxoon_export_spec_bundle/actions/workflows/release-bundles.yml)
- committed download folder in this repo: [`release/assets/`](release/assets/)
- local source checkout builds: `release/installers/` and `release/assets/`

Installer files:
- Windows: [KlaxoonBulkExport-0.1.3-windows-x64-installer.zip][windows-installer]
- Linux: [klaxoon-bulk-export_0.1.3_linux-x64.deb][linux-installer]
- macOS Apple Silicon: [KlaxoonBulkExport-0.1.3-macos-arm64.pkg][macos-arm64-installer]
- macOS Intel: [KlaxoonBulkExport-0.1.3-macos-x64.pkg][macos-x64-installer]

Raw bundle files:
- Windows: [KlaxoonBulkExport-0.1.3-windows-x64-bundle.zip][windows-bundle]
- Linux: [KlaxoonBulkExport-0.1.3-linux-x64-bundle.tar.gz][linux-bundle]
- macOS Apple Silicon: [KlaxoonBulkExport-0.1.3-macos-arm64-bundle.tar.gz][macos-arm64-bundle]
- macOS Intel: [KlaxoonBulkExport-0.1.3-macos-x64-bundle.tar.gz][macos-x64-bundle]

## Fastest Path

For most users, use the installer for your OS.

### Windows installer
1. Download [KlaxoonBulkExport-0.1.3-windows-x64-installer.zip][windows-installer].
2. Extract it.
3. Run `Install.cmd`.
4. Open `chrome://extensions` for Chrome or Chromium, `edge://extensions` for Edge, or `brave://extensions` for Brave.
5. Turn on the `Developer mode` toggle on that extensions page.
6. Click `Load unpacked`.
7. Select `%LOCALAPPDATA%\KlaxoonBulkExport\browser-extension`.
8. Do not select the `browser-extension` folder from the extracted zip. Load the installed folder under `%LOCALAPPDATA%`.
9. Sign in to Klaxoon in that same browser profile.
10. After SSO finishes, return to a `https://*.klaxoon.com/` page such as `Recent` or an actual board tab.
11. Open the extension side panel and export PDFs.

Windows note:
- The native helper shipped in the Windows x64 installer is self-contained. No separate .NET runtime installation is required on the target PC.

### Linux installer
1. Download [klaxoon-bulk-export_0.1.3_linux-x64.deb][linux-installer].
2. Install it with `sudo dpkg -i klaxoon-bulk-export_0.1.3_linux-x64.deb`.
3. Open your Chromium browser's extensions page.
4. Enable `Developer mode`.
5. Click `Load unpacked`.
6. Select `~/.local/share/klaxoon-bulk-export/linux-x64/browser-extension`.
7. Sign in to Klaxoon in that same browser profile.
8. After SSO finishes, return to a `https://*.klaxoon.com/` page such as `Recent` or an actual board tab.
9. Open the extension side panel and export PDFs.

### macOS installer
1. Download the `.pkg` that matches your Mac:
   - Apple Silicon: [KlaxoonBulkExport-0.1.3-macos-arm64.pkg][macos-arm64-installer]
   - Intel: [KlaxoonBulkExport-0.1.3-macos-x64.pkg][macos-x64-installer]
2. Open the package and complete installation.
3. Open your Chromium browser's extensions page.
4. Enable `Developer mode`.
5. Click `Load unpacked`.
6. Select:
   - Apple Silicon: `~/Library/Application Support/KlaxoonBulkExport/macos-arm64/browser-extension`
   - Intel: `~/Library/Application Support/KlaxoonBulkExport/macos-x64/browser-extension`
7. Sign in to Klaxoon in that same browser profile.
8. After SSO finishes, return to a `https://*.klaxoon.com/` page such as `Recent` or an actual board tab.
9. Open the extension side panel and export PDFs.

## Raw Bundle Path

Use the raw bundle only if you want the lower-level install scripts.

### Windows raw bundle
1. Download [KlaxoonBulkExport-0.1.3-windows-x64-bundle.zip][windows-bundle].
2. Extract it.
3. Run `Install.cmd`. If you are automating the install, call `install.ps1` directly.
4. Load the unpacked extension from the `browser-extension/` folder that the script installs.

### Linux raw bundle
1. Download [KlaxoonBulkExport-0.1.3-linux-x64-bundle.tar.gz][linux-bundle].
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

[windows-installer]: https://github.com/ikomolafe/klaxoon_export_spec_bundle/releases/download/v0.1.3/KlaxoonBulkExport-0.1.3-windows-x64-installer.zip
[linux-installer]: https://github.com/ikomolafe/klaxoon_export_spec_bundle/releases/download/v0.1.3/klaxoon-bulk-export_0.1.3_linux-x64.deb
[macos-arm64-installer]: https://github.com/ikomolafe/klaxoon_export_spec_bundle/releases/download/v0.1.3/KlaxoonBulkExport-0.1.3-macos-arm64.pkg
[macos-x64-installer]: https://github.com/ikomolafe/klaxoon_export_spec_bundle/releases/download/v0.1.3/KlaxoonBulkExport-0.1.3-macos-x64.pkg
[windows-bundle]: https://github.com/ikomolafe/klaxoon_export_spec_bundle/releases/download/v0.1.3/KlaxoonBulkExport-0.1.3-windows-x64-bundle.zip
[linux-bundle]: https://github.com/ikomolafe/klaxoon_export_spec_bundle/releases/download/v0.1.3/KlaxoonBulkExport-0.1.3-linux-x64-bundle.tar.gz
[macos-arm64-bundle]: https://github.com/ikomolafe/klaxoon_export_spec_bundle/releases/download/v0.1.3/KlaxoonBulkExport-0.1.3-macos-arm64-bundle.tar.gz
[macos-x64-bundle]: https://github.com/ikomolafe/klaxoon_export_spec_bundle/releases/download/v0.1.3/KlaxoonBulkExport-0.1.3-macos-x64-bundle.tar.gz

## Current Behaviour

The current product is PDF-first:
- the side panel exposes `Export current board PDF` and `Export participated boards PDF`
- PDF export is the default path
- zip packaging is available, but it is opt-in and off by default
- when the user is not signed in, the side panel opens the normal Klaxoon page and waits for enterprise SSO to complete in the browser
- the extension can only inspect `https://*.klaxoon.com/*` tabs, not the identity-provider page used during enterprise SSO
- export progress is owned by the background worker, shared across side panels and tabs, and the last session state is kept across browser restarts
- `Restart from beginning` starts a new run with the previous settings; it does not resume from the middle of a partially completed run

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

See [INSTALL](docs/INSTALL.md), [DISTRIBUTION](docs/DISTRIBUTION.md), [SECURITY](docs/SECURITY.md), and [SUPPORT](docs/SUPPORT.md).
