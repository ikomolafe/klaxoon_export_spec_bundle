/*
Copyright © 2026 KD Computers Ltd. All rights reserved.

This software and associated source code are proprietary and confidential to KD Computers Ltd.
Use, reproduction, modification, distribution, sublicensing, disclosure, or reverse engineering
is prohibited except as expressly permitted under a valid written licence agreement.

Governing law: England and Wales.
*/

using System.Text;

namespace Klaxoon.NativeHelper;

public static class ActivityLog
{
    public static void Append(AppPaths paths, string message)
    {
        paths.EnsureDirectories();
        var line = $"[{DateTimeOffset.UtcNow:O}] {message}{Environment.NewLine}";
        File.AppendAllText(paths.HelperLogPath, line, Encoding.UTF8);
    }

    public static string[] ReadRecentLines(AppPaths paths, int maxLines = 100)
    {
        if (!File.Exists(paths.HelperLogPath))
        {
            return [];
        }

        return File.ReadAllLines(paths.HelperLogPath, Encoding.UTF8)
            .TakeLast(maxLines)
            .ToArray();
    }
}
