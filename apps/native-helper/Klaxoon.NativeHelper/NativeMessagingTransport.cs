/*
Copyright © 2026 KD Computers Ltd. All rights reserved.

This software and associated source code are proprietary and confidential to KD Computers Ltd.
Use, reproduction, modification, distribution, sublicensing, disclosure, or reverse engineering
is prohibited except as expressly permitted under a valid written licence agreement.

Governing law: England and Wales.
*/

using System.Buffers.Binary;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Klaxoon.NativeHelper;

public static class NativeMessagingTransport
{
    private const int MaxMessageBytes = 1024 * 1024;
    private static readonly JsonSerializerOptions ResponseJsonOptions = new(JsonSerializerDefaults.Web);

    public static async Task RunAsync(
        NativeProtocol protocol,
        Stream input,
        Stream output,
        CancellationToken cancellationToken = default)
    {
        while (true)
        {
            var header = new byte[sizeof(int)];
            var headerBytesRead = await ReadExactOrEndAsync(input, header, cancellationToken);
            if (headerBytesRead == 0)
            {
                return;
            }

            if (headerBytesRead != sizeof(int))
            {
                throw new EndOfStreamException("NATIVE_MESSAGE_HEADER_TRUNCATED");
            }

            var messageLength = BinaryPrimitives.ReadInt32LittleEndian(header);
            if (messageLength <= 0 || messageLength > MaxMessageBytes)
            {
                throw new InvalidOperationException("NATIVE_MESSAGE_LENGTH_INVALID");
            }

            var payloadBuffer = new byte[messageLength];
            await ReadExactlyAsync(input, payloadBuffer, cancellationToken);

            var response = HandleMessage(protocol, Encoding.UTF8.GetString(payloadBuffer));
            var responseBytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(response, ResponseJsonOptions));
            var responseHeader = new byte[sizeof(int)];
            BinaryPrimitives.WriteInt32LittleEndian(responseHeader, responseBytes.Length);

            await output.WriteAsync(responseHeader, cancellationToken);
            await output.WriteAsync(responseBytes, cancellationToken);
            await output.FlushAsync(cancellationToken);
        }
    }

    public static async Task RunLineModeAsync(
        NativeProtocol protocol,
        TextReader input,
        TextWriter output,
        CancellationToken cancellationToken = default)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            var line = await input.ReadLineAsync(cancellationToken);
            if (line is null)
            {
                return;
            }

            var response = HandleMessage(protocol, line);
            await output.WriteLineAsync(JsonSerializer.Serialize(response, ResponseJsonOptions));
            await output.FlushAsync();
        }
    }

    private static object HandleMessage(NativeProtocol protocol, string rawRequest)
    {
        var requestType = "unknown";
        try
        {
            var request = JsonNode.Parse(rawRequest)?.AsObject() ?? throw new InvalidOperationException("INVALID_JSON");
            requestType = request["type"]?.GetValue<string>() ?? "unknown";
            return protocol.Handle(request);
        }
        catch (Exception ex)
        {
            protocol.LogTransportFailure(requestType, ex);
            return new { ok = false, errorCode = "HELPER_EXCEPTION", message = ex.Message };
        }
    }

    private static async Task<int> ReadExactOrEndAsync(Stream input, byte[] buffer, CancellationToken cancellationToken)
    {
        var totalBytesRead = 0;
        while (totalBytesRead < buffer.Length)
        {
            var bytesRead = await input.ReadAsync(
                buffer.AsMemory(totalBytesRead, buffer.Length - totalBytesRead),
                cancellationToken);

            if (bytesRead == 0)
            {
                return totalBytesRead;
            }

            totalBytesRead += bytesRead;
        }

        return totalBytesRead;
    }

    private static async Task ReadExactlyAsync(Stream input, byte[] buffer, CancellationToken cancellationToken)
    {
        var totalBytesRead = await ReadExactOrEndAsync(input, buffer, cancellationToken);
        if (totalBytesRead != buffer.Length)
        {
            throw new EndOfStreamException("NATIVE_MESSAGE_BODY_TRUNCATED");
        }
    }
}
