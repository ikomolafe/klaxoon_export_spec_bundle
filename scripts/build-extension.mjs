/*
Copyright © 2026 KD Computers Ltd. All rights reserved.

This software and associated source code are proprietary and confidential to KD Computers Ltd.
Use, reproduction, modification, distribution, sublicensing, disclosure, or reverse engineering
is prohibited except as expressly permitted under a valid written licence agreement.

Governing law: England and Wales.
*/

import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extensionId, extensionPublicKey } from "./release-config.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = path.join(rootDir, "apps", "edge-extension");
const publicDir = path.join(extensionDir, "public");
const outDir = path.join(extensionDir, "build", "extension");

async function ensureCleanDirectory(targetDir) {
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(targetDir, { recursive: true });
}

async function copyPublicAssets() {
  const publicEntries = await fs.readdir(publicDir);

  for (const entry of publicEntries) {
    const source = path.join(publicDir, entry);
    const destination = path.join(outDir, entry);

    if (entry === "manifest.json") {
      const manifest = JSON.parse(await fs.readFile(source, "utf8"));
      manifest.key = extensionPublicKey;
      await fs.writeFile(destination, JSON.stringify(manifest, null, 2) + "\n", "utf8");
      continue;
    }

    await fs.copyFile(source, destination);
  }
}

async function bundleEntries() {
  const common = {
    bundle: true,
    format: "esm",
    minify: true,
    platform: "browser",
    sourcemap: false,
    target: "chrome120"
  };

  await build({
    ...common,
    entryPoints: [path.join(extensionDir, "src", "background", "index.ts")],
    outfile: path.join(outDir, "dist", "background", "index.js")
  });

  await build({
    ...common,
    entryPoints: [path.join(extensionDir, "src", "sidepanel", "index.tsx")],
    outfile: path.join(outDir, "dist", "sidepanel", "index.js")
  });

  await build({
    ...common,
    entryPoints: [path.join(extensionDir, "src", "content", "exportAutomation.ts")],
    outfile: path.join(outDir, "dist", "content", "exportAutomation.js")
  });

  const metadata = {
    builtAt: new Date().toISOString(),
    extensionId
  };
  await fs.writeFile(path.join(outDir, "build-metadata.json"), JSON.stringify(metadata, null, 2) + "\n", "utf8");
}

await ensureCleanDirectory(outDir);
await fs.mkdir(path.join(outDir, "dist", "background"), { recursive: true });
await fs.mkdir(path.join(outDir, "dist", "sidepanel"), { recursive: true });
await fs.mkdir(path.join(outDir, "dist", "content"), { recursive: true });
await copyPublicAssets();
await bundleEntries();
