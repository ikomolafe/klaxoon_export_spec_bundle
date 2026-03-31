/*
Copyright © 2026 KD Computers Ltd. All rights reserved.

This software and associated source code are proprietary and confidential to KD Computers Ltd.
Use, reproduction, modification, distribution, sublicensing, disclosure, or reverse engineering
is prohibited except as expressly permitted under a valid written licence agreement.

Governing law: England and Wales.
*/

using System.Buffers.Binary;
using System.Text;
using Xunit;

namespace Klaxoon.NativeHelper.Tests;

public sealed class NativeMessagingTransportTests
{
    private static NativeProtocol CreateProtocol(string? root = null)
        => new(new AppPaths(root ?? Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"))));

    [Fact]
    public async Task RunAsyncProcessesLengthPrefixedPingRequest()
    {
        var protocol = CreateProtocol();

        await using var input = CreateInputStream("""{"type":"ping"}""");
        await using var output = new MemoryStream();

        await NativeMessagingTransport.RunAsync(protocol, input, output);

        output.Position = 0;
        var response = ReadResponse(output);
        Assert.Contains("\"type\":\"pong\"", response, StringComparison.Ordinal);
    }

    [Fact]
    public async Task RunAsyncSerializesPrepareRunUsingCamelCase()
    {
        var root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        var protocol = CreateProtocol(root);

        await using var input = CreateInputStream("""{"type":"prepareRun","runId":"run-transport-001"}""");
        await using var output = new MemoryStream();

        await NativeMessagingTransport.RunAsync(protocol, input, output);

        output.Position = 0;
        var response = ReadResponse(output);
        Assert.Contains("\"runRoot\":", response, StringComparison.Ordinal);
        Assert.Contains("\"outputRoot\":", response, StringComparison.Ordinal);
        Assert.DoesNotContain("\"RunRoot\":", response, StringComparison.Ordinal);
        Assert.DoesNotContain("\"OutputRoot\":", response, StringComparison.Ordinal);
    }

    [Fact]
    public async Task RunLineModeAsyncPreservesManualDebugPath()
    {
        var protocol = CreateProtocol();

        using var input = new StringReader("""{"type":"ping"}""" + Environment.NewLine);
        await using var output = new StringWriter();

        await NativeMessagingTransport.RunLineModeAsync(protocol, input, output);

        Assert.Contains("pong", output.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task RunLineModeAsyncLogsProtocolFailures()
    {
        var root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        var protocol = CreateProtocol(root);

        using var input = new StringReader("""{"type":"prepareRun"}""" + Environment.NewLine);
        await using var output = new StringWriter();

        await NativeMessagingTransport.RunLineModeAsync(protocol, input, output);

        var response = output.ToString();
        Assert.Contains("HELPER_EXCEPTION", response, StringComparison.Ordinal);

        var lines = ActivityLog.ReadRecentLines(new AppPaths(root));
        Assert.Contains(lines, line => line.Contains("prepareRun", StringComparison.Ordinal));
        Assert.Contains(lines, line => line.Contains("failed", StringComparison.OrdinalIgnoreCase));
    }

    private static MemoryStream CreateInputStream(string json)
    {
        var payload = Encoding.UTF8.GetBytes(json);
        var header = new byte[sizeof(int)];
        BinaryPrimitives.WriteInt32LittleEndian(header, payload.Length);

        var stream = new MemoryStream();
        stream.Write(header);
        stream.Write(payload);
        stream.Position = 0;
        return stream;
    }

    private static string ReadResponse(Stream output)
    {
        Span<byte> header = stackalloc byte[sizeof(int)];
        _ = output.Read(header);
        var length = BinaryPrimitives.ReadInt32LittleEndian(header);

        var payload = new byte[length];
        _ = output.Read(payload, 0, payload.Length);
        return Encoding.UTF8.GetString(payload);
    }
}
