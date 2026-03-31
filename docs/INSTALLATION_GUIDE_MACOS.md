# Installation Guide macOS

## Installer
Use `release/installers/KlaxoonBulkExport-<version>-macos-arm64.pkg` for Apple Silicon or `release/installers/KlaxoonBulkExport-<version>-macos-x64.pkg` for Intel Macs.
For end users, the preferred download source is the GitHub `Releases` page for the tagged version.

## Steps
1. Open the matching `.pkg` and complete installation.
2. Load `~/Library/Application Support/KlaxoonBulkExport/<bundle-id>/browser-extension` into Google Chrome, Microsoft Edge, Brave, or Chromium.
3. Confirm the native messaging manifest was written to the current user's supported Chromium browser native messaging directories.
4. Sign in to Klaxoon in that browser profile.
5. Open the side panel, choose a folder if required, and start a PDF export.

## Notes
- The helper is distributed as a self-contained binary.
- The default export root is `~/Library/Application Support/KD Computers Ltd/Klaxoon Bulk Export Utility/exports`.
- Optional signing and notarization are documented separately in `docs/RELEASE_SIGNING.md`.
