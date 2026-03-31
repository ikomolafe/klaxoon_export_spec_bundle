/*
Copyright © 2026 KD Computers Ltd. All rights reserved.

This software and associated source code are proprietary and confidential to KD Computers Ltd.
Use, reproduction, modification, distribution, sublicensing, disclosure, or reverse engineering
is prohibited except as expressly permitted under a valid written licence agreement.

Governing law: England and Wales.
*/

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { supportedChromiumBrowsers } from "../../scripts/browser-support.mjs";
import { extensionId, nativeHostName } from "../../scripts/release-config.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const releaseDir = path.join(rootDir, "release", "end-user");
const cleanupTargets = [];

function currentBundleId() {
  if (process.platform === "win32") {
    return process.arch === "arm64" ? "windows-arm64" : "windows-x64";
  }

  if (process.platform === "linux") {
    return process.arch === "arm64" ? "linux-arm64" : "linux-x64";
  }

  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "macos-arm64" : "macos-x64";
  }

  throw new Error(`Unsupported platform: ${process.platform}`);
}

function runOrThrow(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: { ...process.env, ...options.env },
    encoding: "utf8"
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

async function ensureExists(targetPath) {
  await fs.access(targetPath);
}

function manifestAssertions(manifest, helperPath) {
  assert.equal(manifest.name, nativeHostName);
  assert.equal(manifest.type, "stdio");
  assert.equal(Array.isArray(manifest.allowed_origins), true);
  assert.equal(manifest.allowed_origins.includes(`chrome-extension://${extensionId}/`), true);
  assert.equal(path.normalize(manifest.path), path.normalize(helperPath));
}

async function verifyUnixInstall(bundleDir) {
  const installRoot = path.join(os.tmpdir(), `klaxoon-bulk-export-install-${process.pid}-${Date.now()}`);
  const nativeHostRoot = path.join(os.tmpdir(), `klaxoon-bulk-export-hosts-${process.pid}-${Date.now()}`);
  cleanupTargets.push(installRoot, nativeHostRoot);

  runOrThrow("/bin/sh", [path.join(bundleDir, "install.sh")], {
    env: {
      KD_INSTALL_ROOT: installRoot,
      KD_NATIVE_HOST_ROOT: nativeHostRoot
    }
  });

  const extensionDir = path.join(installRoot, "browser-extension");
  const helperPath = path.join(installRoot, "native-helper", "Klaxoon.NativeHelper");

  await ensureExists(path.join(extensionDir, "manifest.json"));
  await ensureExists(helperPath);

  for (const browser of supportedChromiumBrowsers) {
    const manifestPath = path.join(nativeHostRoot, browser.id, `${nativeHostName}.json`);
    await ensureExists(manifestPath);
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifestAssertions(manifest, helperPath);
  }
}

async function verifyWindowsInstall(bundleDir) {
  const installRoot = path.join(os.tmpdir(), `KlaxoonBulkExportInstall-${process.pid}-${Date.now()}`);
  const manifestRoot = path.join(os.tmpdir(), `KlaxoonBulkExportManifest-${process.pid}-${Date.now()}`);
  cleanupTargets.push(installRoot, manifestRoot);

  const installArgs = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(bundleDir, "install.ps1"),
    "-InstallRoot",
    installRoot,
    "-ManifestRoot",
    manifestRoot
  ];

  const shouldRegisterNativeHosts = process.env.CI === "true";
  if (!shouldRegisterNativeHosts) {
    installArgs.push("-SkipNativeHostRegistration");
  }

  runOrThrow("powershell", installArgs);

  const extensionDir = path.join(installRoot, "browser-extension");
  const helperPath = path.join(installRoot, "native-helper", "Klaxoon.NativeHelper.exe");
  const manifestPath = path.join(manifestRoot, `${nativeHostName}.json`);

  await ensureExists(path.join(extensionDir, "manifest.json"));
  await ensureExists(helperPath);
  await ensureExists(manifestPath);

  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifestAssertions(manifest, helperPath);

  if (shouldRegisterNativeHosts) {
    for (const browser of supportedChromiumBrowsers) {
      const registryKey = `${browser.windowsRegistryBase}\\${nativeHostName}`;
      const queryOutput = runOrThrow("reg", ["query", registryKey, "/ve"]);
      assert.equal(
        queryOutput.toLowerCase().includes(manifestPath.toLowerCase()),
        true,
        `registry key ${registryKey} did not point at ${manifestPath}`
      );
    }
  }
}

async function cleanup() {
  for (const target of cleanupTargets) {
    await fs.rm(target, { recursive: true, force: true }).catch(() => undefined);
  }
}

const bundleId = currentBundleId();
const bundleDir = path.join(releaseDir, bundleId);
await ensureExists(bundleDir);

try {
  if (process.platform === "win32") {
    await verifyWindowsInstall(bundleDir);
  } else {
    await verifyUnixInstall(bundleDir);
  }
} finally {
  await cleanup();
}

console.log(`Install smoke check passed for ${bundleId}.`);
