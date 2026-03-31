/*
Copyright © 2026 KD Computers Ltd. All rights reserved.

This software and associated source code are proprietary and confidential to KD Computers Ltd.
Use, reproduction, modification, distribution, sublicensing, disclosure, or reverse engineering
is prohibited except as expressly permitted under a valid written licence agreement.

Governing law: England and Wales.
*/

import { spawnSync } from "node:child_process";
import { createDotnetEnvironment, resolveDotnetCommand } from "./dotnet-resolver.mjs";

const [, , ...args] = process.argv;

if (args.length === 0) {
  throw new Error("A dotnet command is required.");
}

const result = spawnSync(resolveDotnetCommand(), args, {
  stdio: "inherit",
  env: createDotnetEnvironment()
});

process.exit(result.status ?? 1);
