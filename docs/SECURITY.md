# Security

- The extension reuses the active Chromium session and does not prompt for or store credentials.
- No cookies, tokens, or passwords should be logged. Logs are limited to operational state and stable error codes.
- Host permissions are restricted to Klaxoon domains and extension permissions are limited to orchestration requirements.
- Native helper path handling must remain rooted under the chosen run directory; path traversal is rejected.
- Remote code loading is not permitted.
- End-user helper bundles are self-contained single-file publishes so machines do not need a preinstalled .NET runtime.
