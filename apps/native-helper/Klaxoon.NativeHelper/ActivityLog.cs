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
    private static readonly object SyncRoot = new();

    public static void Append(AppPaths paths, string message)
    {
        paths.EnsureDirectories();
        var line = FormatLine(message);

        lock (SyncRoot)
        {
            File.AppendAllText(paths.HelperLogPath, line, Encoding.UTF8);
        }
    }

    public static void AppendException(AppPaths paths, string context, Exception exception)
    {
        var indentedException = exception.ToString().Replace(Environment.NewLine, $"{Environment.NewLine}    ");
        Append(paths, $"{context}{Environment.NewLine}    {indentedException}");
    }

    public static string FormatLine(string message)
    {
        return $"[{DateTimeOffset.UtcNow:O}] {message}{Environment.NewLine}";
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
