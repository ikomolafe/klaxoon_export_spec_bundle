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
const assetsDir = path.join(rootDir, "release", "assets");
const stageDir = path.join(rootDir, "release", ".stage", "assets");
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

async function ensureInputArtifacts() {
  try {
    await fs.access(path.join(endUserDir, "release-manifest.json"));
  } catch {
    runOrThrow("npm", ["run", "package:enduser"], { stdio: "inherit" });
  }

  try {
    await fs.access(path.join(installersDir, "release-manifest.json"));
  } catch {
    runOrThrow("npm", ["run", "package:installers"], { stdio: "inherit" });
  }
}

async function resetDirectory(directory) {
  await fs.rm(directory, { recursive: true, force: true });
  await fs.mkdir(directory, { recursive: true });
}

async function hashFile(filePath) {
  const contents = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(contents).digest("hex");
}

async function archiveBundle(bundleId, bundleDir) {
  const archiveName = bundleId === "windows-x64"
    ? `KlaxoonBulkExport-${version}-${bundleId}-bundle.zip`
    : `KlaxoonBulkExport-${version}-${bundleId}-bundle.tar.gz`;
  const artifactPath = path.join(assetsDir, archiveName);
  const archiveStageRoot = path.join(stageDir, bundleId);
  const archiveStage = path.join(archiveStageRoot, `KlaxoonBulkExport-${version}-${bundleId}`);

  await resetDirectory(archiveStageRoot);
  await fs.cp(bundleDir, archiveStage, { recursive: true });
  await fs.rm(artifactPath, { force: true });

  if (bundleId === "windows-x64") {
    runOrThrow("zip", ["-qr", artifactPath, path.basename(archiveStage)], { cwd: archiveStageRoot });
  } else {
    runOrThrow("tar", ["-C", archiveStageRoot, "-czf", artifactPath, path.basename(archiveStage)]);
  }

  return {
    type: "bundle",
    bundleId,
    artifactPath
  };
}

async function collectInstallerAssets() {
  const entries = await fs.readdir(installersDir, { withFileTypes: true });
  const installers = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    if (entry.name === "release-manifest.json") {
      continue;
    }

    const source = path.join(installersDir, entry.name);
    const destination = path.join(assetsDir, entry.name);
    await fs.copyFile(source, destination);
    installers.push({
      type: "installer",
      bundleId: entry.name.includes("windows") ? "windows-x64"
        : entry.name.includes("linux") ? "linux-x64"
        : entry.name.includes("macos-arm64") ? "macos-arm64"
        : "macos-x64",
      artifactPath: destination
    });
  }

  return installers;
}

await ensureInputArtifacts();
await resetDirectory(assetsDir);
await fs.mkdir(stageDir, { recursive: true });

const entries = [];
const bundleManifest = JSON.parse(await fs.readFile(path.join(endUserDir, "release-manifest.json"), "utf8"));
for (const bundle of bundleManifest.bundles) {
  const bundleDir = path.join(rootDir, bundle.path);
  entries.push(await archiveBundle(bundle.bundleId, bundleDir));
}

entries.push(...await collectInstallerAssets());

const copiedFiles = [
  ["end-user-manifest.json", path.join(endUserDir, "release-manifest.json")],
  ["installer-manifest.json", path.join(installersDir, "release-manifest.json")]
];

for (const [targetName, source] of copiedFiles) {
  await fs.copyFile(source, path.join(assetsDir, targetName));
}

const manifest = {
  version,
  createdAt: new Date().toISOString(),
  assets: await Promise.all(entries.map(async (entry) => ({
    ...entry,
    relativePath: path.relative(rootDir, entry.artifactPath),
    size: (await fs.stat(entry.artifactPath)).size,
    sha256: await hashFile(entry.artifactPath)
  })))
};

await fs.writeFile(path.join(assetsDir, "release-assets.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

console.log(`Created ${entries.length} release asset(s) under ${path.relative(rootDir, assetsDir)}.`);
