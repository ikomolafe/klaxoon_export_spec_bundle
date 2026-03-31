# Installation Guide Linux

## Installer
Use `release/installers/klaxoon-bulk-export_<version>_linux-x64.deb`.
For end users, the preferred download source is the GitHub `Releases` page for the tagged version.

## Steps
1. Install the package with `sudo dpkg -i klaxoon-bulk-export_<version>_linux-x64.deb`.
2. Load `~/.local/share/klaxoon-bulk-export/linux-x64/browser-extension` into Google Chrome, Microsoft Edge, Brave, or Chromium.
3. Confirm the native messaging manifests were created under the supported Chromium browser config directories.
4. Sign in to Klaxoon in that browser profile.
5. Open the side panel, choose a folder if required, and start a PDF export.

## Notes
- The helper is self-contained and does not require a separate .NET runtime on the target machine.
- The default export root is `~/.local/share/KD Computers Ltd/Klaxoon Bulk Export Utility/exports`.
- Release integrity can be checked with the generated `SHA256SUMS.txt` file.
