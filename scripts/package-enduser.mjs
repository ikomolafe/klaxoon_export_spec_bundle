/*
Copyright © 2026 KD Computers Ltd. All rights reserved.

This software and associated source code are proprietary and confidential to KD Computers Ltd.
Use, reproduction, modification, distribution, sublicensing, disclosure, or reverse engineering
is prohibited except as expressly permitted under a valid written licence agreement.

Governing law: England and Wales.
*/

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  supportedBrowserLabels,
  supportedBrowserSummary,
  unixNativeHostDirectories,
  windowsNativeMessagingRegistryKeys
} from "./browser-support.mjs";
import { createDotnetEnvironment, resolveDotnetCommand } from "./dotnet-resolver.mjs";
import { extensionId, nativeHostName, releaseTargets } from "./release-config.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(rootDir, "release", "end-user");
const extensionBuildDir = path.join(rootDir, "apps", "edge-extension", "build", "extension");
const helperProject = path.join(
  rootDir,
  "apps",
  "native-helper",
  "Klaxoon.NativeHelper",
  "Klaxoon.NativeHelper.csproj"
);
const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));

function runOrThrow(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv }
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function runShellHook(command, extraEnv = {}) {
  const shell = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : process.env.SHELL ?? "/bin/sh";
  const shellArgs = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command];
  const result = spawnSync(shell, shellArgs, {
    cwd: rootDir,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv }
  });

  if (result.status !== 0) {
    throw new Error(`Signing hook failed: ${command}`);
  }
}

async function copyDirectory(sourceDir, targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const source = path.join(sourceDir, entry.name);
    const destination = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(source, destination);
      continue;
    }

    await fs.copyFile(source, destination);
  }
}

async function removeDebugArtifacts(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await removeDebugArtifacts(target);
      continue;
    }

    if (entry.name.endsWith(".pdb")) {
      await fs.rm(target, { force: true });
    }
  }
}

async function collectFiles(directory, relativeBase = directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(absolutePath, relativeBase)));
      continue;
    }

    files.push({
      absolutePath,
      relativePath: path.relative(relativeBase, absolutePath).replaceAll(path.sep, "/")
    });
  }

  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function hashFile(filePath) {
  const contents = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(contents).digest("hex");
}

async function writeChecksums(bundleDir) {
  const files = await collectFiles(bundleDir);
  const checksumLines = [];
  const manifestEntries = [];

  for (const file of files) {
    if (file.relativePath === "SHA256SUMS.txt") {
      continue;
    }

    const sha256 = await hashFile(file.absolutePath);
    const size = (await fs.stat(file.absolutePath)).size;
    checksumLines.push(`${sha256}  ${file.relativePath}`);
    manifestEntries.push({ path: file.relativePath, sha256, size });
  }

  await fs.writeFile(path.join(bundleDir, "SHA256SUMS.txt"), checksumLines.join("\n") + "\n", "utf8");
  return manifestEntries;
}

function createManifestTemplate() {
  return JSON.stringify(
    {
      name: nativeHostName,
      description: "Klaxoon Bulk Export native helper",
      path: "__HELPER_PATH__",
      type: "stdio",
      allowed_origins: [`chrome-extension://${extensionId}/`]
    },
    null,
    2
  ) + "\n";
}

function windowsInstaller() {
  const registryKeys = windowsNativeMessagingRegistryKeys(nativeHostName);
  const registryList = registryKeys.map(({ registryKey }) => `"${registryKey.replaceAll("\\", "\\\\")}"`).join(",\n  ");

  return `param(
  [string]$InstallRoot = "$env:LOCALAPPDATA\\KlaxoonBulkExport",
  [string]$ManifestRoot = "",
  [switch]$SkipNativeHostRegistration
)

$ErrorActionPreference = "Stop"
$BundleRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ExtensionSource = Join-Path $BundleRoot "browser-extension"
$HelperSource = Join-Path $BundleRoot "native-helper"
$ManifestTemplate = Join-Path $BundleRoot "manifest-template.json"
$ExtensionTarget = Join-Path $InstallRoot "browser-extension"
$HelperTarget = Join-Path $InstallRoot "native-helper"
$HelperExe = Join-Path $HelperTarget "Klaxoon.NativeHelper.exe"
$RegistryTargets = @(
  ${registryList}
)

if ([string]::IsNullOrWhiteSpace($ManifestRoot)) {
  $ManifestRoot = $InstallRoot
}

$ManifestTarget = Join-Path $ManifestRoot "${nativeHostName}.json"

New-Item -ItemType Directory -Force -Path $ExtensionTarget | Out-Null
New-Item -ItemType Directory -Force -Path $HelperTarget | Out-Null
New-Item -ItemType Directory -Force -Path $ManifestRoot | Out-Null
Copy-Item -Recurse -Force "$ExtensionSource\\*" $ExtensionTarget
Copy-Item -Recurse -Force "$HelperSource\\*" $HelperTarget

$ManifestContent = Get-Content $ManifestTemplate -Raw
$ManifestContent = $ManifestContent.Replace("__HELPER_PATH__", ($HelperExe -replace "\\\\", "\\\\\\\\"))
Set-Content -Path $ManifestTarget -Value $ManifestContent -Encoding UTF8

if (-not $SkipNativeHostRegistration) {
  foreach ($RegPath in $RegistryTargets) {
    $null = & reg.exe add $RegPath /ve /t REG_SZ /d $ManifestTarget /f
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to register native messaging host at $RegPath"
    }
  }
} else {
  Write-Host "Native host registry registration skipped."
}

Write-Host "Installed helper and native messaging host."
Write-Host "Load the unpacked extension from: $ExtensionTarget"
Write-Host "Supported browsers: ${supportedBrowserSummary()}"
Write-Host "Deterministic extension ID: ${extensionId}"
`;
}

function unixInstaller(bundleId) {
  const macHostDirs = unixNativeHostDirectories("darwin", "${HOME}", undefined);
  const linuxHostDirs = unixNativeHostDirectories("linux", "${HOME}", "${XDG_CONFIG_HOME:-${HOME}/.config}");
  const macWriteLines = macHostDirs
    .map(({ browser, directory }) => `    write_manifest "${browser.id}" "${directory}"`)
    .join("\n");
  const linuxWriteLines = linuxHostDirs
    .map(({ browser, directory }) => `    write_manifest "${browser.id}" "${directory}"`)
    .join("\n");

  return `#!/usr/bin/env sh
set -eu

BUNDLE_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
UNAME=$(uname -s)

if [ -n "\${KD_INSTALL_ROOT:-}" ]; then
  INSTALL_ROOT="$KD_INSTALL_ROOT"
else
  case "$UNAME" in
    Darwin)
      INSTALL_ROOT="\${HOME}/Library/Application Support/KlaxoonBulkExport/${bundleId}"
      ;;
    Linux)
      INSTALL_ROOT="\${HOME}/.local/share/klaxoon-bulk-export/${bundleId}"
      ;;
    *)
      echo "Unsupported OS: $UNAME" >&2
      exit 1
      ;;
  esac
fi

EXTENSION_TARGET="$INSTALL_ROOT/browser-extension"
HELPER_TARGET="$INSTALL_ROOT/native-helper"
HELPER_EXE="$HELPER_TARGET/Klaxoon.NativeHelper"

mkdir -p "$EXTENSION_TARGET" "$HELPER_TARGET"
cp -R "$BUNDLE_ROOT/browser-extension/." "$EXTENSION_TARGET/"
cp -R "$BUNDLE_ROOT/native-helper/." "$HELPER_TARGET/"
chmod +x "$HELPER_EXE"

write_manifest() {
  BROWSER_ID="$1"
  HOST_DIR="$2"
  if [ -n "\${KD_NATIVE_HOST_ROOT:-}" ]; then
    HOST_DIR="$KD_NATIVE_HOST_ROOT/$BROWSER_ID"
  fi
  MANIFEST_TARGET="$HOST_DIR/${nativeHostName}.json"
  mkdir -p "$HOST_DIR"
  sed "s|__HELPER_PATH__|$HELPER_EXE|g" "$BUNDLE_ROOT/manifest-template.json" > "$MANIFEST_TARGET"
}

case "$UNAME" in
  Darwin)
${macWriteLines}
    ;;
  Linux)
${linuxWriteLines}
    ;;
esac

echo "Installed helper and native messaging host."
echo "Load the unpacked extension from: $EXTENSION_TARGET"
echo "Supported browsers: ${supportedBrowserSummary()}"
echo "Deterministic extension ID: ${extensionId}"
`;
}

function releaseNotes(target, signed) {
  return `Klaxoon Bulk Export ${packageJson.version}

Bundle: ${target.bundleId}
RID: ${target.rid}
Extension ID: ${extensionId}
Signed: ${signed ? "yes" : "no"}
Supported browsers: ${supportedBrowserSummary()}

Contents:
- browser-extension/: unpacked Chromium extension with bundled JavaScript dependencies
- native-helper/: self-contained native helper publish output
- manifest-template.json: native messaging host manifest template
- install script for the target OS
- SHA256SUMS.txt: checksum manifest for the bundle contents

Install the bundle with the included installer script, then load the unpacked extension directory in one of: ${supportedBrowserLabels().join(", ")}.
`;
}

function signingHookForTarget(target) {
  if (target.platform === "windows") {
    return process.env.KD_SIGN_WINDOWS_CMD;
  }

  if (target.platform === "macos") {
    return process.env.KD_SIGN_MACOS_CMD;
  }

  return process.env.KD_SIGN_LINUX_CMD;
}

async function tryStripBinary(target, helperBinaryPath) {
  const hostCanStrip =
    (process.platform === "darwin" && target.platform === "macos") ||
    (process.platform === "linux" && target.platform === "linux");

  if (!hostCanStrip || process.env.KD_SKIP_STRIP === "1") {
    return false;
  }

  const args = process.platform === "darwin" ? ["-x", helperBinaryPath] : ["--strip-unneeded", helperBinaryPath];
  const result = spawnSync("strip", args, { stdio: "ignore" });
  return result.status === 0;
}

runOrThrow("npm", ["run", "build"]);

await fs.rm(releaseDir, { recursive: true, force: true });
await fs.mkdir(releaseDir, { recursive: true });

const dotnetCommand = resolveDotnetCommand();
const dotnetEnv = createDotnetEnvironment();
const releaseSummary = [];

for (const target of releaseTargets) {
  const bundleDir = path.join(releaseDir, target.bundleId);
  const helperOutDir = path.join(bundleDir, "native-helper");
  const extensionOutDir = path.join(bundleDir, "browser-extension");
  const helperBinaryPath = path.join(helperOutDir, target.executableName);

  await fs.mkdir(bundleDir, { recursive: true });
  await copyDirectory(extensionBuildDir, extensionOutDir);

  runOrThrow(dotnetCommand, [
    "publish",
    helperProject,
    "-c",
    "Release",
    "-r",
    target.rid,
    "--self-contained",
    "true",
    "-p:PublishSingleFile=true",
    "-p:PublishTrimmed=false",
    "-p:IncludeNativeLibrariesForSelfExtract=true",
    "-p:DebugType=None",
    "-p:DebugSymbols=false",
    "-o",
    helperOutDir
  ], dotnetEnv);

  await removeDebugArtifacts(helperOutDir);
  const stripped = await tryStripBinary(target, helperBinaryPath);

  await fs.writeFile(path.join(bundleDir, "manifest-template.json"), createManifestTemplate(), "utf8");

  if (target.platform === "windows") {
    await fs.writeFile(path.join(bundleDir, "install.ps1"), windowsInstaller(), "utf8");
  } else {
    const installPath = path.join(bundleDir, "install.sh");
    await fs.writeFile(installPath, unixInstaller(target.bundleId), "utf8");
    await fs.chmod(installPath, 0o755);
  }

  const signingHook = signingHookForTarget(target);
  let signed = false;
  if (signingHook) {
    runShellHook(signingHook, {
      KD_BUNDLE_DIR: bundleDir,
      KD_BUNDLE_ID: target.bundleId,
      KD_HELPER_PATH: helperBinaryPath,
      KD_EXTENSION_DIR: extensionOutDir
    });
    signed = true;
  }

  await fs.writeFile(path.join(bundleDir, "RELEASE.txt"), releaseNotes(target, signed), "utf8");
  const files = await writeChecksums(bundleDir);

  releaseSummary.push({
    bundleId: target.bundleId,
    rid: target.rid,
    helperBinary: path.relative(rootDir, helperBinaryPath),
    path: path.relative(rootDir, bundleDir),
    signed,
    stripped,
    files
  });
}

await fs.writeFile(
  path.join(releaseDir, "release-manifest.json"),
  JSON.stringify(
    {
      version: packageJson.version,
      extensionId,
      createdAt: new Date().toISOString(),
      bundles: releaseSummary
    },
    null,
    2
  ) + "\n",
  "utf8"
);
