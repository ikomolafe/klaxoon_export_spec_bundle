# Klaxoon Bulk Export

Chromium MV3 extension plus .NET 8 native helper for exporting Klaxoon board PDFs from the user's authenticated browser session.

## Current behaviour

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
- the helper now normalizes the managed export root and avoids re-nesting `Klaxoon_Bulk_Export` when the same output root is reused

Supported runtime targets:
- Google Chrome
- Microsoft Edge
- Brave
- Chromium

Unsupported runtime targets:
- Firefox
- Safari

Supported operating systems:
- Windows
- Linux
- macOS

Validation status:
- CI packaging and install smoke checks run on Windows x64, Linux x64, macOS Intel, and macOS Apple Silicon.
- The shipped release bundles are currently `windows-x64`, `linux-x64`, `macos-x64`, and `macos-arm64`.
- Linux folder picking is optional; if no desktop picker is available, the user can still type a local output path manually in the side panel.

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
      2026-03-16_22-51-43__run-<run-id>.zip   # only when zip packaging is enabled
```

Notes:
- some boards will not produce all three PDF files; for example, zone export may be unavailable, or board-fit / board-selection may be skipped if the board UI does not expose the required controls
- older runs may still exist under a legacy nested `Klaxoon_Bulk_Export/Klaxoon_Bulk_Export` path from previous builds, but new runs use the normalized root

See [INSTALL](/Users/citadel03/LinuxOSWork/AI/klaxoon_export_spec_bundle/klaxoon-bulk-export/docs/INSTALL.md), [IMPLEMENTATION_PLAN](/Users/citadel03/LinuxOSWork/AI/klaxoon_export_spec_bundle/klaxoon-bulk-export/docs/IMPLEMENTATION_PLAN.md), [DISTRIBUTION](/Users/citadel03/LinuxOSWork/AI/klaxoon_export_spec_bundle/klaxoon-bulk-export/docs/DISTRIBUTION.md), [SECURITY_MODEL](/Users/citadel03/LinuxOSWork/AI/klaxoon_export_spec_bundle/klaxoon-bulk-export/docs/SECURITY_MODEL.md), [SUPPORT](/Users/citadel03/LinuxOSWork/AI/klaxoon_export_spec_bundle/klaxoon-bulk-export/docs/SUPPORT.md), and [KNOWN_LIMITATIONS](/Users/citadel03/LinuxOSWork/AI/klaxoon_export_spec_bundle/klaxoon-bulk-export/docs/KNOWN_LIMITATIONS.md).
