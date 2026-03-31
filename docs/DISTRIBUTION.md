# Distribution

## Goal
Produce self-contained end-user bundles and user-facing installers for:
- Windows `win-x64`
- Linux `linux-x64`
- macOS `osx-arm64`
- macOS `osx-x64`

Each raw bundle contains:
- A bundled Chromium extension with all JavaScript dependencies compiled into the shipped files
- A self-contained single-file native helper for the target runtime
- A native messaging host manifest template
- An OS-specific installer script
- A `SHA256SUMS.txt` checksum file
- Release manifest metadata capturing bundle contents and hashes

## Build command
Run:

```sh
npm run package:enduser
npm run package:installers
npm run package:release-assets
```

Artifacts are generated under:
- `release/end-user/` for the raw bundles
- `release/installers/` for the user-facing installers
- `release/assets/` for GitHub-release-ready downloadable files

## Validation workflow
- `.github/workflows/release-bundles.yml` runs on `ubuntu-latest`, `windows-latest`, `macos-13`, and `macos-14`.
- Each runner executes unit tests, helper tests, `package:enduser`, bundle-structure smoke checks, and an install smoke test for its own OS family.
- The Apple Silicon macOS runner also generates the installer artifacts under `release/installers/`.
- Tagged releases can be published through `.github/workflows/github-release.yml`, which builds the release assets and uploads them to the GitHub Releases page.
- That keeps packaging, install layout, and native-host registration logic under continuous verification without changing the runtime architecture.

## Release structure
```text
release/
  end-user/
    windows-x64/
      browser-extension/
      native-helper/
      install.ps1
      manifest-template.json
      SHA256SUMS.txt
      RELEASE.txt
    linux-x64/
      browser-extension/
      native-helper/
      install.sh
      manifest-template.json
      RELEASE.txt
    macos-arm64/
      ...
    macos-x64/
      ...
  installers/
    KlaxoonBulkExport-<version>-windows-x64-installer.zip
    klaxoon-bulk-export_<version>_linux-x64.deb
    KlaxoonBulkExport-<version>-macos-arm64.pkg
    KlaxoonBulkExport-<version>-macos-x64.pkg
    release-manifest.json
  assets/
    KlaxoonBulkExport-<version>-windows-x64-installer.zip
    klaxoon-bulk-export_<version>_linux-x64.deb
    KlaxoonBulkExport-<version>-macos-arm64.pkg
    KlaxoonBulkExport-<version>-macos-x64.pkg
    KlaxoonBulkExport-<version>-windows-x64-bundle.zip
    KlaxoonBulkExport-<version>-linux-x64-bundle.tar.gz
    KlaxoonBulkExport-<version>-macos-arm64-bundle.tar.gz
    KlaxoonBulkExport-<version>-macos-x64-bundle.tar.gz
    end-user-manifest.json
    installer-manifest.json
    release-assets.json
```

## Runtime export structure
End-user release bundles install the product, but actual export runs are written to a separate managed output tree at runtime. The selected output folder is treated as a base directory and the helper creates `Klaxoon_Bulk_Export/` beneath it.

```text
<selected-output-root>/
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

Operational points:
- `runs/` is the authoritative folder for support and troubleshooting.
- `packages/` is intentionally outside the run folder to avoid recursive archive creation.
- Browser downloads are treated as temporary intermediates. The helper stages the exported PDF into the run tree and optional packaging happens from there.

## Stable extension identity
The build injects a fixed extension public key into the packaged manifest. That gives the extension a deterministic ID so native messaging host manifests can safely restrict `allowed_origins`.

## Installer overrides
The generated installers now support controlled override roots for automation and smoke testing:
- Windows `install.ps1`:
  - `-InstallRoot <path>`
  - `-ManifestRoot <path>`
  - `-SkipNativeHostRegistration`
- Linux and macOS `install.sh`:
  - `KD_INSTALL_ROOT=<path>`
  - `KD_NATIVE_HOST_ROOT=<path>`

These overrides are used by the release install smoke test so CI can validate installation without touching a developer's normal browser-profile paths.

## Installer formats
- Windows currently ships as a zip installer bundle containing `Install.cmd` plus the self-contained payload.
- Linux ships as a `.deb` that installs the payload under `/opt/klaxoon-bulk-export/<bundle-id>/bundle` and then applies the per-user browser registration under the desktop user.
- macOS ships as `.pkg` installers that stage the payload under `/Library/Application Support/KlaxoonBulkExport/<bundle-id>/bundle` and then apply the per-user browser registration for the logged-in console user.

The installers embed the helper and extension payloads. The browser extension still needs to be loaded from the installed `browser-extension/` directory because store/policy distribution is not yet part of the release pipeline.

## GitHub release download path
- Push a tag such as `v0.1.0`.
- `.github/workflows/github-release.yml` builds, validates, packages, and uploads the contents of `release/assets/` to the GitHub Releases page for that tag.
- End users should prefer the installer assets from that release page.
- Advanced users can download the raw bundle archives from the same release if they want the lower-level install scripts.

## Signing hooks
Optional signing hooks are available through:
- `KD_SIGN_WINDOWS_CMD`
- `KD_SIGN_MACOS_CMD`
- `KD_SIGN_LINUX_CMD`

Unsigned development bundles are still produced when those variables are not set.

## Operational note
Cross-platform helper publishing depends on .NET runtime packs being downloadable during the release build. The output bundles themselves are self-contained and do not require end users to install .NET.
