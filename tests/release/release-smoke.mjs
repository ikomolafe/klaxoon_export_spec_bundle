/*
Copyright © 2026 KD Computers Ltd. All rights reserved.

This software and associated source code are proprietary and confidential to KD Computers Ltd.
Use, reproduction, modification, distribution, sublicensing, disclosure, or reverse engineering
is prohibited except as expressly permitted under a valid written licence agreement.

Governing law: England and Wales.
*/

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const releaseDir = path.join(rootDir, "release", "end-user");
const manifestPath = path.join(releaseDir, "release-manifest.json");
const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));
const extensionPackageJson = JSON.parse(
  await fs.readFile(path.join(rootDir, "apps", "edge-extension", "package.json"), "utf8")
);
const readmeContents = await fs.readFile(path.join(rootDir, "README.md"), "utf8");
const sourceExtensionManifest = JSON.parse(
  await fs.readFile(path.join(rootDir, "apps", "edge-extension", "public", "manifest.json"), "utf8")
);

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

assert.equal(Array.isArray(manifest.bundles), true, "release manifest must contain bundles");
assert.equal(manifest.bundles.length >= 3, true, "release manifest must list cross-platform bundles");
assert.equal(extensionPackageJson.version, packageJson.version, "extension package version must match the root package version");
assert.equal(
  sourceExtensionManifest.version,
  extensionPackageJson.version,
  "source extension manifest version must match apps/edge-extension/package.json"
);
assert.equal(readmeContents.includes("<version>"), false, "README must not contain unresolved <version> placeholders");
assert.equal(
  readmeContents.includes(`https://github.com/ikomolafe/klaxoon_export_spec_bundle/releases/tag/v${packageJson.version}`),
  true,
  "README must link to the current tagged release"
);
assert.equal(
  readmeContents.includes("https://github.com/ikomolafe/klaxoon_export_spec_bundle/releases/latest"),
  true,
  "README must link to the latest release redirect"
);
assert.equal(
  readmeContents.includes(`KlaxoonBulkExport-${packageJson.version}-windows-x64-installer.zip`),
  true,
  "README must mention the current Windows installer filename"
);
assert.equal(
  readmeContents.includes(`klaxoon-bulk-export_${packageJson.version}_linux-x64.deb`),
  true,
  "README must mention the current Linux installer filename"
);
assert.equal(
  readmeContents.includes(`https://github.com/ikomolafe/klaxoon_export_spec_bundle/releases/download/v${packageJson.version}/KlaxoonBulkExport-${packageJson.version}-windows-x64-installer.zip`),
  true,
  "README must include a direct Windows installer download link for the current release"
);
assert.equal(
  readmeContents.includes(`https://github.com/ikomolafe/klaxoon_export_spec_bundle/releases/download/v${packageJson.version}/klaxoon-bulk-export_${packageJson.version}_linux-x64.deb`),
  true,
  "README must include a direct Linux installer download link for the current release"
);
assert.equal(
  readmeContents.includes(`https://github.com/ikomolafe/klaxoon_export_spec_bundle/releases/download/v${packageJson.version}/KlaxoonBulkExport-${packageJson.version}-windows-x64-bundle.zip`),
  true,
  "README must include a direct Windows raw bundle download link for the current release"
);

function assertWindowsInstaller(bundle, installerContents) {
  assert.equal(
    installerContents.includes("& reg.exe add $RegPath /ve /t REG_SZ /d $ManifestTarget /f"),
    true,
    `bundle ${bundle.bundleId} must register native hosts with reg.exe /ve`
  );
  assert.equal(
    installerContents.includes('Set-ItemProperty -Path $RegPath -Name "(default)" -Value $ManifestTarget'),
    false,
    `bundle ${bundle.bundleId} must not write registry default values with Set-ItemProperty`
  );
  assert.equal(
    installerContents.includes("HKCU\\\\Software"),
    false,
    `bundle ${bundle.bundleId} must not escape Windows registry key separators twice`
  );
}

for (const bundle of manifest.bundles) {
  const bundleDir = path.join(rootDir, bundle.path);
  const checksumPath = path.join(bundleDir, "SHA256SUMS.txt");
  const manifestTemplatePath = path.join(bundleDir, "manifest-template.json");
  const bundledExtensionManifestPath = path.join(bundleDir, "browser-extension", "manifest.json");

  await fs.access(bundleDir);
  await fs.access(checksumPath);
  await fs.access(manifestTemplatePath);
  await fs.access(bundledExtensionManifestPath);

  const bundledExtensionManifest = JSON.parse(await fs.readFile(bundledExtensionManifestPath, "utf8"));
  assert.equal(
    bundledExtensionManifest.version,
    extensionPackageJson.version,
    `bundle ${bundle.bundleId} must ship an extension manifest version matching apps/edge-extension/package.json`
  );

  if (bundle.bundleId.startsWith("windows-")) {
    const installerPath = path.join(bundleDir, "install.ps1");
    const launcherPath = path.join(bundleDir, "Install.cmd");
    await fs.access(launcherPath);
    await fs.access(installerPath);
    assertWindowsInstaller(bundle, await fs.readFile(installerPath, "utf8"));
  }

  const checksumLines = (await fs.readFile(checksumPath, "utf8"))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  assert.equal(checksumLines.length > 0, true, `bundle ${bundle.bundleId} must contain checksums`);

  for (const entry of bundle.files) {
    const filePath = path.join(bundleDir, entry.path);
    const contents = await fs.readFile(filePath);
    const sha256 = crypto.createHash("sha256").update(contents).digest("hex");
    assert.equal(sha256, entry.sha256, `checksum mismatch for ${bundle.bundleId}:${entry.path}`);
  }
}

console.log("Release smoke check passed.");
