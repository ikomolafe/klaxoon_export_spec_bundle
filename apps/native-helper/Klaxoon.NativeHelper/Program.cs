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
    public static async Task<int> Main(string[] args)
    {
        Console.InputEncoding = Encoding.UTF8;
        Console.OutputEncoding = Encoding.UTF8;

        var paths = new AppPaths();
        RegisterGlobalExceptionLogging(paths);

        try
        {
            var protocol = new NativeProtocol(paths);
            if (args.Contains("--line-mode", StringComparer.Ordinal))
            {
                await NativeMessagingTransport.RunLineModeAsync(protocol, Console.In, Console.Out);
                return 0;
            }

            await NativeMessagingTransport.RunAsync(protocol, Console.OpenStandardInput(), Console.OpenStandardOutput());
            return 0;
        }
        catch (Exception exception)
        {
            ActivityLog.AppendException(paths, "Native helper terminated with an unhandled fatal error.", exception);
            Console.Error.WriteLine(exception);
            return 1;
        }
    }

    private static void RegisterGlobalExceptionLogging(AppPaths paths)
    {
        AppDomain.CurrentDomain.UnhandledException += (_, eventArgs) =>
        {
            if (eventArgs.ExceptionObject is Exception exception)
            {
                ActivityLog.AppendException(paths, "Unhandled AppDomain exception.", exception);
                return;
            }

            ActivityLog.Append(paths, $"Unhandled non-exception AppDomain failure: {eventArgs.ExceptionObject}");
        };

        TaskScheduler.UnobservedTaskException += (_, eventArgs) =>
        {
            ActivityLog.AppendException(paths, "Unobserved task exception.", eventArgs.Exception);
            eventArgs.SetObserved();
        };
    }
}
