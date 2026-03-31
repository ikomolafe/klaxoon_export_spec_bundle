/*
Copyright © 2026 KD Computers Ltd. All rights reserved.

This software and associated source code are proprietary and confidential to KD Computers Ltd.
Use, reproduction, modification, distribution, sublicensing, disclosure, or reverse engineering
is prohibited except as expressly permitted under a valid written licence agreement.

Governing law: England and Wales.
*/

import crypto from "node:crypto";

export const nativeHostName = "com.company.klaxoon_export";
export const extensionPublicKey =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3ND26caZ2zv/IKMv90t85+m+igaEDi+AMkcw0+6c0idP4nASQG6s7ddPKChECdUoHuw1pFEIoGlV/TZIrZxqH168uaGRXgkSf08tIxbbU8Pnb0qeTr9rsENULJUOOSaDhxzAOaMcF/x9fqsxhJ+B0ZOFdFMbCB9d1j3STxEtvOGL3u9sqCgDaE6G+bD9ccQgjdRXkxu1mkMFy9zqMXLyUU7NyMwax3Ecm0cGVD0iQOUUmHSQf64y9/lSV6R5MF4rDhWzvcbCxrDvKCaBem46dCcQWk0dIuAWvPOGeUUmOCtg3wYWsYj9rRgvoaHSryIwGEQo4NUNHCjhR0lJmrY3UQIDAQAB";

export function computeExtensionId(publicKeyBase64) {
  const keyBytes = Buffer.from(publicKeyBase64, "base64");
  const hash = crypto.createHash("sha256").update(keyBytes).digest();
  const alphabet = "abcdefghijklmnop";
  let extensionId = "";

  for (const byte of hash.subarray(0, 16)) {
    extensionId += alphabet[byte >> 4];
    extensionId += alphabet[byte & 0x0f];
  }

  return extensionId;
}

export const extensionId = computeExtensionId(extensionPublicKey);

export const releaseTargets = [
  { bundleId: "windows-x64", rid: "win-x64", executableName: "Klaxoon.NativeHelper.exe", platform: "windows" },
  { bundleId: "linux-x64", rid: "linux-x64", executableName: "Klaxoon.NativeHelper", platform: "linux" },
  { bundleId: "macos-arm64", rid: "osx-arm64", executableName: "Klaxoon.NativeHelper", platform: "macos" },
  { bundleId: "macos-x64", rid: "osx-x64", executableName: "Klaxoon.NativeHelper", platform: "macos" }
];
