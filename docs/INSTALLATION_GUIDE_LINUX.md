# Installation Guide Linux

## Bundle
Use `release/end-user/linux-x64/`.

## Steps
1. Run `install.sh` from the bundle.
2. Load the `browser-extension/` directory printed by the script into Google Chrome, Microsoft Edge, Brave, or Chromium.
3. Confirm the native messaging manifests were created under the supported Chromium browser config directories.
4. Sign in to Klaxoon in that browser profile.
5. Open the side panel, choose a folder if required, and start a PDF export.

## Notes
- The helper is self-contained and does not require a separate .NET runtime on the target machine.
- The default export root is `~/.local/share/KD Computers Ltd/Klaxoon Bulk Export Utility/exports`.
- Release integrity can be checked with the generated `SHA256SUMS.txt` file.
