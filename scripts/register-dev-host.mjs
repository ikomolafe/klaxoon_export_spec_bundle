/*
Copyright © 2026 KD Computers Ltd. All rights reserved.

This software and associated source code are proprietary and confidential to KD Computers Ltd.
Use, reproduction, modification, distribution, sublicensing, disclosure, or reverse engineering
is prohibited except as expressly permitted under a valid written licence agreement.

Governing law: England and Wales.
*/

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { supportedBrowserSummary, unixNativeHostDirectories, windowsNativeMessagingRegistryKeys } from "./browser-support.mjs";
import { createDotnetEnvironment, resolveDotnetCommand } from "./dotnet-resolver.mjs";
import { extensionId, nativeHostName } from "./release-config.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helperProject = path.join(
  rootDir,
  "apps",
  "native-helper",
  "Klaxoon.NativeHelper",
  "Klaxoon.NativeHelper.csproj"
);
const extensionPath = path.join(rootDir, "apps", "edge-extension", "build", "extension");

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

function currentRid() {
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "osx-arm64" : "osx-x64";
  }

  if (process.platform === "linux") {
    return process.arch === "arm64" ? "linux-arm64" : "linux-x64";
  }

  if (process.platform === "win32") {
    return process.arch === "arm64" ? "win-arm64" : "win-x64";
  }

  throw new Error(`Unsupported platform: ${process.platform}`);
}

function helperExecutableName(rid) {
  return rid.startsWith("win-") ? "Klaxoon.NativeHelper.exe" : "Klaxoon.NativeHelper";
}

function helperAssemblyName() {
  return "Klaxoon.NativeHelper.dll";
}

function hostManifestStorageDirectory() {
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "KlaxoonBulkExport", "dev-host");
  }

  return path.join(rootDir, ".dev", "native-host-manifests");
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

async function createLauncher(helperOutDir, dotnetCommand, dotnetEnv) {
  if (process.platform === "win32") {
    return path.join(helperOutDir, helperExecutableName(currentRid()));
  }

  const launcherPath = path.join(helperOutDir, "native-host.sh");
  const helperDllPath = path.join(helperOutDir, helperAssemblyName());
  const pathValue = dotnetEnv.PATH ?? process.env.PATH ?? "";
  const lines = [
    "#!/bin/sh",
    "set -eu"
  ];

  if (pathValue.length > 0) {
    lines.push(`export PATH=${shellQuote(pathValue)}`);
  }

  if ((dotnetEnv.DOTNET_ROOT ?? "").length > 0) {
    lines.push(`export DOTNET_ROOT=${shellQuote(dotnetEnv.DOTNET_ROOT)}`);
  }

  lines.push(`exec ${shellQuote(dotnetCommand)} ${shellQuote(helperDllPath)}`);

  await fs.writeFile(launcherPath, `${lines.join("\n")}\n`, "utf8");
  await fs.chmod(launcherPath, 0o755);
  return launcherPath;
}

async function writeManifest(helperPath) {
  const manifest = {
    name: nativeHostName,
    description: "Klaxoon Bulk Export native helper",
    path: helperPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`]
  };
  const manifestJson = JSON.stringify(manifest, null, 2) + "\n";
  const registrations = [];

  if (process.platform === "win32") {
    const manifestDir = hostManifestStorageDirectory();
    await fs.mkdir(manifestDir, { recursive: true });
    const manifestPath = path.join(manifestDir, `${nativeHostName}.json`);
    await fs.writeFile(manifestPath, manifestJson, "utf8");

    for (const { browser, registryKey } of windowsNativeMessagingRegistryKeys(nativeHostName)) {
      runOrThrow("reg", [
        "add",
        registryKey,
        "/ve",
        "/t",
        "REG_SZ",
        "/d",
        manifestPath,
        "/f"
      ]);

      registrations.push({
        browser: browser.label,
        manifestPath,
        registryKey
      });
    }

    return registrations;
  }

  const directories = unixNativeHostDirectories(
    process.platform,
    os.homedir(),
    process.env.XDG_CONFIG_HOME
  );

  for (const { browser, directory } of directories) {
    await fs.mkdir(directory, { recursive: true });
    const manifestPath = path.join(directory, `${nativeHostName}.json`);
    await fs.writeFile(manifestPath, manifestJson, "utf8");
    registrations.push({
      browser: browser.label,
      manifestPath
    });
  }

  return registrations;
}

const rid = currentRid();
const dotnetCommand = resolveDotnetCommand();
const dotnetEnv = createDotnetEnvironment();
const helperOutDir = path.join(rootDir, ".dev", "native-helper", rid);
const helperPath = path.join(helperOutDir, helperExecutableName(rid));

runOrThrow("npm", ["run", "build"]);
await fs.rm(helperOutDir, { recursive: true, force: true });
await fs.mkdir(helperOutDir, { recursive: true });

runOrThrow(dotnetCommand, [
  "publish",
  helperProject,
  "-c",
  "Debug",
  "-r",
  rid,
  "--self-contained",
  "false",
  "-p:UseAppHost=true",
  "-o",
  helperOutDir
], dotnetEnv);

if (process.platform !== "win32") {
  await fs.chmod(helperPath, 0o755);
}

const hostExecutablePath = await createLauncher(helperOutDir, dotnetCommand, dotnetEnv);
const registrations = await writeManifest(hostExecutablePath);

console.log(`Native host registered for: ${supportedBrowserSummary()}`);
for (const registration of registrations) {
  console.log(
    registration.registryKey
      ? `- ${registration.browser}: ${registration.manifestPath} (${registration.registryKey})`
      : `- ${registration.browser}: ${registration.manifestPath}`
  );
}
console.log(`Helper published to: ${helperPath}`);
console.log(`Native host executable: ${hostExecutablePath}`);
console.log(`Load the unpacked extension from: ${extensionPath}`);
console.log(`Expected extension ID: ${extensionId}`);
