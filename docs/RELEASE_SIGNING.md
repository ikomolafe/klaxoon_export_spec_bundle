# Release Signing

## Goal
Signing is optional and must not block unsigned development builds. The release pipeline supports opt-in signing hooks through environment variables.

## Supported hooks
- `KD_SIGN_WINDOWS_CMD`
- `KD_SIGN_MACOS_CMD`
- `KD_SIGN_LINUX_CMD`

When set, the command is executed after the bundle is assembled and before checksums are generated.

The hook receives these environment variables:
- `KD_BUNDLE_DIR`
- `KD_BUNDLE_ID`
- `KD_HELPER_PATH`
- `KD_EXTENSION_DIR`

## Example placeholders

### Windows
Use `signtool.exe` or an enterprise wrapper:
```powershell
$env:KD_SIGN_WINDOWS_CMD = 'signtool sign /fd SHA256 /a "$env:KD_HELPER_PATH"'
```

### macOS
Use Developer ID signing and notarization wrappers:
```sh
export KD_SIGN_MACOS_CMD='codesign --force --timestamp --sign "Developer ID Application: Example" "$KD_HELPER_PATH"'
```

### Linux
Use a checksum signature or package-signing wrapper:
```sh
export KD_SIGN_LINUX_CMD='gpg --batch --yes --detach-sign "$KD_BUNDLE_DIR/SHA256SUMS.txt"'
```

## Manual macOS notarization
The current pipeline provides the hook point only. If notarization is required:
1. Sign the helper binary.
2. Package the release artefact in the format required by your notarization tooling.
3. Submit to Apple notarization.
4. Staple the notarization ticket to the distributable artefact where applicable.
