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

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

assert.equal(Array.isArray(manifest.bundles), true, "release manifest must contain bundles");
assert.equal(manifest.bundles.length >= 3, true, "release manifest must list cross-platform bundles");

for (const bundle of manifest.bundles) {
  const bundleDir = path.join(rootDir, bundle.path);
  const checksumPath = path.join(bundleDir, "SHA256SUMS.txt");
  const manifestTemplatePath = path.join(bundleDir, "manifest-template.json");

  await fs.access(bundleDir);
  await fs.access(checksumPath);
  await fs.access(manifestTemplatePath);
  await fs.access(path.join(bundleDir, "browser-extension", "manifest.json"));

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
