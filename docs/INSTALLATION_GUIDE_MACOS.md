# Installation Guide macOS

## Bundle
Use `release/end-user/macos-arm64/` for Apple Silicon or `release/end-user/macos-x64/` for Intel Macs.

## Steps
1. Run `install.sh` from the selected bundle.
2. Load the `browser-extension/` directory printed by the script into Google Chrome, Microsoft Edge, Brave, or Chromium.
3. Confirm the native messaging manifest was written to the current user's supported Chromium browser native messaging directories.
4. Sign in to Klaxoon in that browser profile.
5. Open the side panel, choose a folder if required, and start a PDF export.

## Notes
- The helper is distributed as a self-contained binary.
- The default export root is `~/Library/Application Support/KD Computers Ltd/Klaxoon Bulk Export Utility/exports`.
- Optional signing and notarization are documented separately in `docs/RELEASE_SIGNING.md`.
