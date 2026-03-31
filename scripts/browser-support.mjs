/*
Copyright © 2026 KD Computers Ltd. All rights reserved.

This software and associated source code are proprietary and confidential to KD Computers Ltd.
Use, reproduction, modification, distribution, sublicensing, disclosure, or reverse engineering
is prohibited except as expressly permitted under a valid written licence agreement.

Governing law: England and Wales.
*/

import path from "node:path";

export const supportedChromiumBrowsers = [
  {
    id: "chrome",
    label: "Google Chrome",
    windowsRegistryBase: "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts",
    macosHostDirSegments: ["Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts"],
    linuxHostDirSegments: ["google-chrome", "NativeMessagingHosts"]
  },
  {
    id: "edge",
    label: "Microsoft Edge",
    windowsRegistryBase: "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts",
    macosHostDirSegments: ["Library", "Application Support", "Microsoft Edge", "NativeMessagingHosts"],
    linuxHostDirSegments: ["microsoft-edge", "NativeMessagingHosts"]
  },
  {
    id: "brave",
    label: "Brave",
    windowsRegistryBase: "HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts",
    macosHostDirSegments: ["Library", "Application Support", "BraveSoftware", "Brave-Browser", "NativeMessagingHosts"],
    linuxHostDirSegments: ["BraveSoftware", "Brave-Browser", "NativeMessagingHosts"]
  },
  {
    id: "chromium",
    label: "Chromium",
    windowsRegistryBase: "HKCU\\Software\\Chromium\\NativeMessagingHosts",
    macosHostDirSegments: ["Library", "Application Support", "Chromium", "NativeMessagingHosts"],
    linuxHostDirSegments: ["chromium", "NativeMessagingHosts"]
  }
];

export function supportedBrowserLabels() {
  return supportedChromiumBrowsers.map((browser) => browser.label);
}

export function supportedBrowserSummary() {
  return supportedBrowserLabels().join(", ");
}

export function unixNativeHostDirectories(platform, homeDir, xdgConfigHome) {
  if (platform === "darwin") {
    return supportedChromiumBrowsers.map((browser) => ({
      browser,
      directory: path.join(homeDir, ...browser.macosHostDirSegments)
    }));
  }

  if (platform === "linux") {
    const configRoot = xdgConfigHome && xdgConfigHome.trim().length > 0
      ? xdgConfigHome
      : path.join(homeDir, ".config");

    return supportedChromiumBrowsers.map((browser) => ({
      browser,
      directory: path.join(configRoot, ...browser.linuxHostDirSegments)
    }));
  }

  throw new Error(`Unsupported platform for unix host directories: ${platform}`);
}

export function windowsNativeMessagingRegistryKeys(nativeHostName) {
  return supportedChromiumBrowsers.map((browser) => ({
    browser,
    registryKey: `${browser.windowsRegistryBase}\\${nativeHostName}`
  }));
}
