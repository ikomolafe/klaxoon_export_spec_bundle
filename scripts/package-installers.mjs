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

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const endUserDir = path.join(rootDir, "release", "end-user");
const installersDir = path.join(rootDir, "release", "installers");
const stageDir = path.join(installersDir, ".stage");
const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));
const version = packageJson.version;

function runOrThrow(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? rootDir,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    env: { ...process.env, ...options.env }
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `Command failed (${command} ${args.join(" ")}): ${(result.stderr || result.stdout || "").trim()}`
    );
  }

  return result.stdout ?? "";
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

async function ensureEndUserBundles() {
  try {
    await fs.access(path.join(endUserDir, "release-manifest.json"));
  } catch {
    runOrThrow("npm", ["run", "package:enduser"], { stdio: "inherit" });
  }
}

async function resetDirectory(directory) {
  await fs.rm(directory, { recursive: true, force: true });
  await fs.mkdir(directory, { recursive: true });
}

function windowsLauncher() {
  return `@echo off
setlocal
set SCRIPT_DIR=%~dp0
echo Installing Klaxoon Bulk Export...
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%install.ps1"
set EXIT_CODE=%ERRORLEVEL%
if not "%EXIT_CODE%"=="0" (
  echo.
  echo Installation failed with exit code %EXIT_CODE%.
  pause
  exit /b %EXIT_CODE%
)
echo.
echo Installation completed.
echo Load the unpacked extension from the browser-extension folder shown by the installer.
pause
`;
}

function windowsReadme() {
  return `Klaxoon Bulk Export ${version}

Windows installer archive contents:
- Install.cmd: launch this first
- install.ps1: installer logic
- browser-extension/: unpacked Chromium extension
- native-helper/: self-contained helper

Install steps:
1. Extract this zip.
2. Run Install.cmd.
3. Load the unpacked extension folder reported by the installer in Chrome, Edge, Brave, or Chromium.
4. Sign in to Klaxoon and start exporting PDFs.
`;
}

function macPostinstall(bundleId) {
  return `#!/bin/sh
set -eu

BUNDLE_ID="${bundleId}"
SYSTEM_BUNDLE="/Library/Application Support/KlaxoonBulkExport/$BUNDLE_ID/bundle"
CONSOLE_USER=$(stat -f %Su /dev/console 2>/dev/null || true)

if [ -z "$CONSOLE_USER" ] || [ "$CONSOLE_USER" = "root" ]; then
  echo "Unable to determine the logged-in user for Klaxoon Bulk Export installation." >&2
  exit 1
fi

TARGET_HOME=$(dscl . -read "/Users/$CONSOLE_USER" NFSHomeDirectory 2>/dev/null | awk '{print $2}')
if [ -z "$TARGET_HOME" ]; then
  TARGET_HOME=$(eval echo "~$CONSOLE_USER")
fi

if [ -z "$TARGET_HOME" ] || [ ! -d "$TARGET_HOME" ]; then
  echo "Unable to resolve home directory for $CONSOLE_USER." >&2
  exit 1
fi

INSTALL_ROOT="$TARGET_HOME/Library/Application Support/KlaxoonBulkExport/$BUNDLE_ID"
su - "$CONSOLE_USER" -c "KD_INSTALL_ROOT='$INSTALL_ROOT' /bin/sh '$SYSTEM_BUNDLE/install.sh'"
echo "Installed Klaxoon Bulk Export for $CONSOLE_USER."
`;
}

function debControlFile() {
  return `Package: klaxoon-bulk-export
Version: ${version}
Section: utils
Priority: optional
Architecture: amd64
Maintainer: KD Computers Ltd <support@kdcomputers.invalid>
Description: Klaxoon Bulk Export installer
 Chromium extension bundle and native helper for exporting Klaxoon boards.
`;
}

function linuxPostinst(bundleId) {
  return `#!/bin/sh
set -eu

BUNDLE_ID="${bundleId}"
SYSTEM_BUNDLE="/opt/klaxoon-bulk-export/$BUNDLE_ID/bundle"
TARGET_USER="\${SUDO_USER:-}"

if [ -z "$TARGET_USER" ] || [ "$TARGET_USER" = "root" ]; then
  TARGET_USER=$(logname 2>/dev/null || true)
fi

if [ -z "$TARGET_USER" ] || [ "$TARGET_USER" = "root" ]; then
  TARGET_USER=$(awk -F: '$3 >= 1000 && $3 < 65534 { print $1; exit }' /etc/passwd)
fi

if [ -z "$TARGET_USER" ] || [ "$TARGET_USER" = "root" ]; then
  echo "Unable to determine the desktop user for Klaxoon Bulk Export installation." >&2
  exit 1
fi

TARGET_HOME=$(getent passwd "$TARGET_USER" | cut -d: -f6)
if [ -z "$TARGET_HOME" ]; then
  echo "Unable to resolve home directory for $TARGET_USER." >&2
  exit 1
fi

INSTALL_ROOT="$TARGET_HOME/.local/share/klaxoon-bulk-export/$BUNDLE_ID"
su - "$TARGET_USER" -c "KD_INSTALL_ROOT='$INSTALL_ROOT' /bin/sh '$SYSTEM_BUNDLE/install.sh'"
echo "Installed Klaxoon Bulk Export for $TARGET_USER."
`;
}

async function createWindowsInstaller(bundleId, bundleDir, outputDir) {
  const installerName = `KlaxoonBulkExport-${version}-${bundleId}-installer.zip`;
  const artifactPath = path.join(outputDir, installerName);
  const bundleStageParent = path.join(stageDir, "windows");
  const bundleStage = path.join(bundleStageParent, `KlaxoonBulkExport-${version}-${bundleId}`);

  await resetDirectory(bundleStageParent);
  await copyDirectory(bundleDir, bundleStage);
  await fs.writeFile(path.join(bundleStage, "Install.cmd"), windowsLauncher(), "utf8");
  await fs.writeFile(path.join(bundleStage, "README.txt"), windowsReadme(), "utf8");

  await fs.rm(artifactPath, { force: true });
  runOrThrow("zip", ["-qr", artifactPath, path.basename(bundleStage)], { env: { ...process.env }, stdio: "pipe", cwd: bundleStageParent });

  return {
    bundleId,
    platform: "windows",
    format: "zip",
    artifactPath
  };
}

async function createMacInstaller(bundleId, bundleDir, outputDir) {
  if (process.platform !== "darwin") {
    return null;
  }

  const artifactPath = path.join(outputDir, `KlaxoonBulkExport-${version}-${bundleId}.pkg`);
  const pkgRoot = path.join(stageDir, bundleId, "pkgroot");
  const scriptsDir = path.join(stageDir, bundleId, "scripts");
  const payloadRoot = path.join(pkgRoot, "Library", "Application Support", "KlaxoonBulkExport", bundleId, "bundle");

  await resetDirectory(path.join(stageDir, bundleId));
  await copyDirectory(bundleDir, payloadRoot);
  await fs.mkdir(scriptsDir, { recursive: true });
  await fs.writeFile(path.join(scriptsDir, "postinstall"), macPostinstall(bundleId), "utf8");
  await fs.chmod(path.join(scriptsDir, "postinstall"), 0o755);

  await fs.rm(artifactPath, { force: true });
  runOrThrow("pkgbuild", [
    "--root",
    pkgRoot,
    "--scripts",
    scriptsDir,
    "--identifier",
    `com.company.klaxoon-export.${bundleId}`,
    "--version",
    version,
    artifactPath
  ]);

  return {
    bundleId,
    platform: "macos",
    format: "pkg",
    artifactPath
  };
}

async function createLinuxInstaller(bundleId, bundleDir, outputDir) {
  const artifactPath = path.join(outputDir, `klaxoon-bulk-export_${version}_${bundleId}.deb`);
  const installerStage = path.join(stageDir, bundleId);
  const payloadRoot = path.join(installerStage, "payload");
  const debianDir = path.join(payloadRoot, "DEBIAN");
  const bundleTarget = path.join(payloadRoot, "opt", "klaxoon-bulk-export", bundleId, "bundle");
  const docDir = path.join(payloadRoot, "usr", "share", "doc", "klaxoon-bulk-export");

  await resetDirectory(installerStage);
  await copyDirectory(bundleDir, bundleTarget);
  await fs.mkdir(debianDir, { recursive: true });
  await fs.mkdir(docDir, { recursive: true });
  await fs.writeFile(path.join(docDir, "README"), `Klaxoon Bulk Export ${version}\n`, "utf8");
  await fs.writeFile(path.join(debianDir, "control"), debControlFile(), "utf8");
  await fs.writeFile(path.join(debianDir, "postinst"), linuxPostinst(bundleId), "utf8");
  await fs.chmod(path.join(debianDir, "postinst"), 0o755);

  await fs.rm(artifactPath, { force: true });
  runOrThrow("ar", [
    "rc",
    artifactPath,
    ...await createDebMembers(installerStage, payloadRoot, debianDir)
  ]);

  return {
    bundleId,
    platform: "linux",
    format: "deb",
    artifactPath
  };
}

async function createDebMembers(installerStage, payloadRoot, debianDir) {
  const debianBinary = path.join(installerStage, "debian-binary");
  const controlTar = path.join(installerStage, "control.tar.gz");
  const dataTar = path.join(installerStage, "data.tar.gz");

  await fs.writeFile(debianBinary, "2.0\n", "utf8");
  runOrThrow("tar", ["-C", debianDir, "-czf", controlTar, "."]);
  runOrThrow("tar", ["--exclude=./DEBIAN", "-C", payloadRoot, "-czf", dataTar, "."]);
  return [debianBinary, controlTar, dataTar];
}

async function writeManifest(entries) {
  const manifestPath = path.join(installersDir, "release-manifest.json");
  const manifest = {
    version,
    createdAt: new Date().toISOString(),
    hostPlatform: process.platform,
    hostArch: process.arch,
    installers: await Promise.all(entries.map(async (entry) => ({
      ...entry,
      relativePath: path.relative(rootDir, entry.artifactPath),
      sha256: crypto.createHash("sha256").update(await fs.readFile(entry.artifactPath)).digest("hex"),
      size: (await fs.stat(entry.artifactPath)).size
    })))
  };

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

await ensureEndUserBundles();
await resetDirectory(installersDir);
await fs.mkdir(stageDir, { recursive: true });

const installers = [];
const windowsBundle = path.join(endUserDir, "windows-x64");
const linuxBundle = path.join(endUserDir, "linux-x64");
const macArmBundle = path.join(endUserDir, "macos-arm64");
const macX64Bundle = path.join(endUserDir, "macos-x64");

try {
  await fs.access(windowsBundle);
  installers.push(await createWindowsInstaller("windows-x64", windowsBundle, installersDir));
} catch {
  // ignore missing bundle
}

try {
  await fs.access(linuxBundle);
  installers.push(await createLinuxInstaller("linux-x64", linuxBundle, installersDir));
} catch {
  // ignore missing bundle
}

for (const macBundle of [
  { bundleId: "macos-arm64", bundleDir: macArmBundle },
  { bundleId: "macos-x64", bundleDir: macX64Bundle }
]) {
  try {
    await fs.access(macBundle.bundleDir);
    const installer = await createMacInstaller(macBundle.bundleId, macBundle.bundleDir, installersDir);
    if (installer) {
      installers.push(installer);
    }
  } catch {
    // ignore missing bundle
  }
}

await writeManifest(installers.filter(Boolean));

console.log(`Created ${installers.length} installer artifact(s) under ${path.relative(rootDir, installersDir)}.`);
