/*
Copyright © 2026 KD Computers Ltd. All rights reserved.

This software and associated source code are proprietary and confidential to KD Computers Ltd.
Use, reproduction, modification, distribution, sublicensing, disclosure, or reverse engineering
is prohibited except as expressly permitted under a valid written licence agreement.

Governing law: England and Wales.
*/

using System.Runtime.InteropServices;

namespace Klaxoon.NativeHelper;

public sealed class AppPaths
{
    public AppPaths(string? rootDirectory = null)
    {
        RootDirectory = rootDirectory ?? ResolveDefaultRoot();
        ExportsDirectory = Path.Combine(RootDirectory, "exports");
        LogsDirectory = Path.Combine(RootDirectory, "logs");
        HelperLogPath = Path.Combine(LogsDirectory, "helper.log");
    }

    public string RootDirectory { get; }
    public string ExportsDirectory { get; }
    public string LogsDirectory { get; }
    public string HelperLogPath { get; }

    public void EnsureDirectories()
    {
        Directory.CreateDirectory(RootDirectory);
        Directory.CreateDirectory(ExportsDirectory);
        Directory.CreateDirectory(LogsDirectory);
    }

    private static string ResolveDefaultRoot()
    {
        var baseDirectory = RuntimeInformation.IsOSPlatform(OSPlatform.OSX)
            ? Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                "Library",
                "Application Support")
            : Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

        if (string.IsNullOrWhiteSpace(baseDirectory))
        {
            baseDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "share");
        }

        return Path.Combine(baseDirectory, AppMetadata.CompanyName, AppMetadata.ProductName);
    }
}
