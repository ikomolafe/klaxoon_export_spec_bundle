/*
Copyright © 2026 KD Computers Ltd. All rights reserved.

This software and associated source code are proprietary and confidential to KD Computers Ltd.
Use, reproduction, modification, distribution, sublicensing, disclosure, or reverse engineering
is prohibited except as expressly permitted under a valid written licence agreement.

Governing law: England and Wales.
*/

using System.Security.Cryptography;
using System.Text;

namespace Klaxoon.NativeHelper;

public static class PathSafety
{
    private static readonly char[] InvalidChars = Path.GetInvalidFileNameChars();

    public static string SafeSegment(string value, int maxLength = 80)
    {
        var builder = new StringBuilder(value.Trim());
        foreach (var invalid in InvalidChars)
        {
            builder.Replace(invalid, '_');
        }

        var normalized = string.Join(" ", builder.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries));
        if (normalized.Length <= maxLength)
        {
            return normalized;
        }

        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(normalized)))[..8];
        return $"{normalized[..Math.Max(1, maxLength - 9)]}_{hash}";
    }

    public static string EnsureUnderRoot(string root, string relativePath)
    {
        var fullRoot = Path.GetFullPath(root);
        var normalizedRelativePath = relativePath
            .Replace('\\', Path.DirectorySeparatorChar)
            .Replace('/', Path.DirectorySeparatorChar);
        var fullPath = Path.GetFullPath(Path.Combine(fullRoot, normalizedRelativePath));
        var relativeToRoot = Path.GetRelativePath(fullRoot, fullPath);
        if (relativeToRoot == ".."
            || relativeToRoot.StartsWith($"..{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
            || Path.IsPathRooted(relativeToRoot))
        {
            throw new InvalidOperationException("PATH_TRAVERSAL_BLOCKED");
        }

        return fullPath;
    }
}
