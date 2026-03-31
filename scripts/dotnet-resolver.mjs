/*
Copyright © 2026 KD Computers Ltd. All rights reserved.

This software and associated source code are proprietary and confidential to KD Computers Ltd.
Use, reproduction, modification, distribution, sublicensing, disclosure, or reverse engineering
is prohibited except as expressly permitted under a valid written licence agreement.

Governing law: England and Wales.
*/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const knownDotnet8Paths = [
  path.join(rootDir, ".dotnet", "dotnet"),
  "/opt/homebrew/opt/dotnet@8/bin/dotnet",
  "/usr/local/share/dotnet/dotnet",
  "/usr/bin/dotnet"
];

export function resolveDotnetCommand() {
  if (process.env.KD_DOTNET_CMD) {
    return process.env.KD_DOTNET_CMD;
  }

  const knownPath = knownDotnet8Paths.find((candidate) => fs.existsSync(candidate));
  return knownPath ?? "dotnet";
}

export function createDotnetEnvironment() {
  const command = resolveDotnetCommand();

  if (command === path.join(rootDir, ".dotnet", "dotnet")) {
    return {
      ...process.env,
      PATH: `${path.join(rootDir, ".dotnet")}:${process.env.PATH ?? ""}`,
      DOTNET_ROOT: path.join(rootDir, ".dotnet")
    };
  }

  if (command === "/opt/homebrew/opt/dotnet@8/bin/dotnet") {
    return {
      ...process.env,
      PATH: `/opt/homebrew/opt/dotnet@8/bin:/opt/homebrew/bin:${process.env.PATH ?? ""}`,
      DOTNET_ROOT: "/opt/homebrew/opt/dotnet@8/libexec"
    };
  }

  return { ...process.env };
}
