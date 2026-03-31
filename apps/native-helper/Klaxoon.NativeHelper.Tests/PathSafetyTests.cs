/*
Copyright © 2026 KD Computers Ltd. All rights reserved.

This software and associated source code are proprietary and confidential to KD Computers Ltd.
Use, reproduction, modification, distribution, sublicensing, disclosure, or reverse engineering
is prohibited except as expressly permitted under a valid written licence agreement.

Governing law: England and Wales.
*/

using Klaxoon.NativeHelper;
using Xunit;

namespace Klaxoon.NativeHelper.Tests;

public sealed class PathSafetyTests
{
    [Fact]
    public void EnsureUnderRootRejectsTraversal()
    {
        var root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);

        Assert.Throws<InvalidOperationException>(() => PathSafety.EnsureUnderRoot(root, "..\\escape.txt"));
    }

    [Fact]
    public void EnsureUnderRootRejectsSiblingPrefixEscape()
    {
        var parent = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        var root = Path.Combine(parent, "root");
        Directory.CreateDirectory(root);

        var siblingPath = Path.Combine(parent, "root-elsewhere", "escape.txt");

        Assert.Throws<InvalidOperationException>(() => PathSafety.EnsureUnderRoot(root, siblingPath));
    }
}
