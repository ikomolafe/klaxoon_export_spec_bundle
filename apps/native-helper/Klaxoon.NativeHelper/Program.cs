/*
Copyright © 2026 KD Computers Ltd. All rights reserved.

This software and associated source code are proprietary and confidential to KD Computers Ltd.
Use, reproduction, modification, distribution, sublicensing, disclosure, or reverse engineering
is prohibited except as expressly permitted under a valid written licence agreement.

Governing law: England and Wales.
*/

using System.Text;
namespace Klaxoon.NativeHelper;

public static class Program
{
    public static async Task Main(string[] args)
    {
        Console.InputEncoding = Encoding.UTF8;
        Console.OutputEncoding = Encoding.UTF8;

        var protocol = new NativeProtocol();
        if (args.Contains("--line-mode", StringComparer.Ordinal))
        {
            await NativeMessagingTransport.RunLineModeAsync(protocol, Console.In, Console.Out);
            return;
        }

        await NativeMessagingTransport.RunAsync(protocol, Console.OpenStandardInput(), Console.OpenStandardOutput());
    }
}
