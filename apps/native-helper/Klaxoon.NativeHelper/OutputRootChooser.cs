/*
Copyright © 2026 KD Computers Ltd. All rights reserved.

This software and associated source code are proprietary and confidential to KD Computers Ltd.
Use, reproduction, modification, distribution, sublicensing, disclosure, or reverse engineering
is prohibited except as expressly permitted under a valid written licence agreement.

Governing law: England and Wales.
*/

using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Klaxoon.NativeHelper;

public static class OutputRootChooser
{
    public static string? Choose()
    {
        var overridePath = Environment.GetEnvironmentVariable("KD_PICK_FOLDER_RESULT");
        if (!string.IsNullOrWhiteSpace(overridePath))
        {
            return overridePath.Trim();
        }

        var overrideError = Environment.GetEnvironmentVariable("KD_PICK_FOLDER_ERROR");
        if (!string.IsNullOrWhiteSpace(overrideError))
        {
            throw new InvalidOperationException(overrideError.Trim());
        }

        if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
        {
            return RunProcess(
                "osascript",
                [
                    "-e",
                    "POSIX path of (choose folder with prompt \"Select Klaxoon export folder\")"
                ]);
        }

        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            var shell = FindFirstCommand("pwsh", "powershell")
                ?? throw new InvalidOperationException("FOLDER_PICKER_UNAVAILABLE");

            return RunProcess(
                shell,
                [
                    "-NoProfile",
                    "-STA",
                    "-Command",
                    "[void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms');" +
                    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;" +
                    "$dialog.Description = 'Select Klaxoon export folder';" +
                    "$dialog.UseDescriptionForTitle = $true;" +
                    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }"
                ]);
        }

        if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
        {
            var picker = FindFirstCommand("zenity", "kdialog");
            return picker switch
            {
                "zenity" => RunProcess("zenity", ["--file-selection", "--directory", "--title=Select Klaxoon export folder"]),
                "kdialog" => RunProcess("kdialog", ["--getexistingdirectory", Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)]),
                _ => throw new InvalidOperationException("FOLDER_PICKER_UNAVAILABLE")
            };
        }

        throw new InvalidOperationException("FOLDER_PICKER_UNSUPPORTED_PLATFORM");
    }

    private static string? RunProcess(string fileName, IReadOnlyList<string> arguments)
    {
        using var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = fileName,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            }
        };

        foreach (var argument in arguments)
        {
            process.StartInfo.ArgumentList.Add(argument);
        }

        process.Start();
        var output = process.StandardOutput.ReadToEnd().Trim();
        process.WaitForExit();

        if (process.ExitCode != 0)
        {
            return null;
        }

        return string.IsNullOrWhiteSpace(output) ? null : output.TrimEnd(Path.DirectorySeparatorChar);
    }

    private static string? FindFirstCommand(params string[] commands)
    {
        var pathEntries = (Environment.GetEnvironmentVariable("PATH") ?? string.Empty)
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        foreach (var command in commands)
        {
            foreach (var entry in pathEntries)
            {
                var fullPath = Path.Combine(entry, command);
                if (File.Exists(fullPath))
                {
                    return fullPath;
                }

                if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
                {
                    var fullPathExe = $"{fullPath}.exe";
                    if (File.Exists(fullPathExe))
                    {
                        return fullPathExe;
                    }
                }
            }
        }

        return null;
    }
}
