# Support

## Common failure modes
- `HELPER_UNAVAILABLE`: native messaging host is not installed or registration is invalid.
- `NOT_SIGNED_IN`: the user is not currently authenticated to Klaxoon in the active Chromium profile.
- `DOWNLOAD_TIMEOUT`: the export job did not produce a browser download in the expected time window.
- `FOLDER_PICKER_CANCELLED`: the user cancelled the output-folder picker.
- `FOLDER_PICKER_UNAVAILABLE`: no supported native folder picker is available on that system. Enter the path manually in the side panel or install `zenity`/`kdialog` on Linux.
- `UNKNOWN_REQUEST`: the extension/helper protocol versions do not match or the helper is stale.

## Troubleshooting steps
1. Confirm the user can open the target board manually in the same Chromium profile that loaded the extension.
2. Confirm the helper host registration matches `com.company.klaxoon_export` and the installed manifest points to the bundled helper executable.
3. Review the run log at `runs/<timestamp>__run-<id>/logs/app.log`.
4. Review the helper log under the helper app-data root:
   - macOS: `~/Library/Application Support/KD Computers Ltd/Klaxoon Bulk Export Utility/logs/helper.log`
   - Windows: `%LOCALAPPDATA%\\KD Computers Ltd\\Klaxoon Bulk Export Utility\\logs\\helper.log`
   - Linux: `~/.local/share/KD Computers Ltd/Klaxoon Bulk Export Utility/logs/helper.log`
5. If a learned export recipe was discarded, rerun the export once so the extension can capture and relearn the current request chain.
6. Use `Restart from beginning` from the side panel session card instead of opening a second export from another tab.
7. On Linux, if `Choose folder` fails with `FOLDER_PICKER_UNAVAILABLE`, continue by typing a local path manually; export does not depend on the picker once the path is known.

## Release bundle support notes
- End-user bundles are per-user installs by default.
- Windows installation writes the native messaging registration under the current user's supported Chromium-browser registry keys.
- Linux and macOS installation place native host manifests in the current user's supported Chromium-browser native messaging directories.
- CI validates bundle creation and install layout on Windows x64, Linux x64, macOS Intel, and macOS Apple Silicon.
