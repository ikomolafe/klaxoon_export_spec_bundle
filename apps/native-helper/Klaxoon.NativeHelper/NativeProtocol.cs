/*
Copyright © 2026 KD Computers Ltd. All rights reserved.

This software and associated source code are proprietary and confidential to KD Computers Ltd.
Use, reproduction, modification, distribution, sublicensing, disclosure, or reverse engineering
is prohibited except as expressly permitted under a valid written licence agreement.

Governing law: England and Wales.
*/

using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Klaxoon.NativeHelper;

public sealed class NativeProtocol
{
    private const string ExportRootFolderName = "Klaxoon_Bulk_Export";
    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private readonly AppPaths _paths;

    public NativeProtocol(AppPaths? paths = null)
    {
        _paths = paths ?? new AppPaths();
    }

    public void LogTransportFailure(string requestType, Exception exception)
    {
        ActivityLog.AppendException(_paths, $"Native helper request '{requestType}' failed.", exception);
    }

    public object Handle(JsonObject request)
    {
        var type = request["type"]?.GetValue<string>() ?? string.Empty;
        return type switch
        {
            "ping" => new { ok = true, type = "pong" },
            "chooseOutputRoot" => HandleChooseOutputRoot(),
            "prepareRun" => PrepareRun(request),
            "appendLog" => AppendLog(request),
            "writeManifest" => WriteManifest(request),
            "stageDownload" => StageDownload(request),
            "packageRun" => PackageRun(request),
            _ => new { ok = false, errorCode = "UNKNOWN_REQUEST", message = $"Unsupported request type '{type}'." }
        };
    }

    private object HandleChooseOutputRoot()
    {
        string? outputRoot;
        try
        {
            outputRoot = OutputRootChooser.Choose();
        }
        catch (InvalidOperationException error) when (string.Equals(error.Message, "FOLDER_PICKER_UNAVAILABLE", StringComparison.Ordinal))
        {
            return new
            {
                ok = false,
                errorCode = "FOLDER_PICKER_UNAVAILABLE",
                message = "Folder picker is unavailable on this system. Type a local folder path manually or install a supported picker such as zenity or kdialog."
            };
        }
        catch (InvalidOperationException error)
        {
            return new
            {
                ok = false,
                errorCode = "FOLDER_PICKER_UNAVAILABLE",
                message = error.Message
            };
        }

        if (string.IsNullOrWhiteSpace(outputRoot))
        {
            return new { ok = false, errorCode = "FOLDER_PICKER_CANCELLED", message = "Folder selection was cancelled." };
        }

        return new { ok = true, type = "outputRootChosen", outputRoot };
    }

    private object PrepareRun(JsonObject request)
    {
        var runId = request["runId"]!.GetValue<string>();
        var outputRoot = ResolveOutputRoot(request);
        var runsDirectory = GetRunsDirectory(outputRoot);
        var runFolderName = CreateRunFolderName(runId);
        var runRoot = Path.Combine(runsDirectory, runFolderName);

        Directory.CreateDirectory(outputRoot);
        Directory.CreateDirectory(runsDirectory);
        Directory.CreateDirectory(GetPackagesDirectory(outputRoot));
        Directory.CreateDirectory(GetRunIndexDirectory(outputRoot));
        Directory.CreateDirectory(runRoot);
        Directory.CreateDirectory(Path.Combine(runRoot, "logs"));
        Directory.CreateDirectory(Path.Combine(runRoot, "workspaces"));
        File.WriteAllText(GetRunIndexPath(outputRoot, runId), runFolderName, Encoding.UTF8);

        return new { ok = true, type = "runPrepared", runRoot, outputRoot };
    }

    private object AppendLog(JsonObject request)
    {
        var message = request["message"]!.GetValue<string>();
        ActivityLog.Append(_paths, message);

        var runId = request["runId"]?.GetValue<string>();
        if (!string.IsNullOrWhiteSpace(runId))
        {
            var runRoot = ResolveRunRoot(request, runId);
            var logPath = Path.Combine(runRoot, "logs", "app.log");
            Directory.CreateDirectory(Path.GetDirectoryName(logPath)!);
            File.AppendAllText(logPath, ActivityLog.FormatLine(message), Encoding.UTF8);
        }

        return new { ok = true, type = "logAppended" };
    }

    private object WriteManifest(JsonObject request)
    {
        var runId = request["runId"]!.GetValue<string>();
        var runRoot = ResolveRunRoot(request, runId);
        var manifestPath = Path.Combine(runRoot, "run-manifest.json");
        File.WriteAllText(manifestPath, request["manifest"]!.ToJsonString(_jsonOptions), Encoding.UTF8);
        var summaryPath = Path.Combine(runRoot, "run-summary.txt");
        File.WriteAllText(summaryPath, BuildRunSummary(request["manifest"] as JsonObject, runRoot), Encoding.UTF8);
        return new { ok = true, type = "manifestWritten", manifestPath };
    }

    private object StageDownload(JsonObject request)
    {
        var runId = request["runId"]!.GetValue<string>();
        var runRoot = ResolveRunRoot(request, runId);
        var sourcePath = request["sourcePath"]!.GetValue<string>();
        var relativeDestination = request["relativeDestination"]!.GetValue<string>();
        var destinationPath = PathSafety.EnsureUnderRoot(runRoot, relativeDestination);

        Directory.CreateDirectory(Path.GetDirectoryName(destinationPath)!);
        File.Copy(sourcePath, destinationPath, overwrite: true);

        return new { ok = true, type = "downloadStaged", destinationPath };
    }

    private object PackageRun(JsonObject request)
    {
        var runId = request["runId"]!.GetValue<string>();
        var outputRoot = ResolveOutputRoot(request);
        var runRoot = ResolveRunRoot(request, runId);
        var packagesDir = GetPackagesDirectory(outputRoot);
        Directory.CreateDirectory(packagesDir);

        var runFolderName = Path.GetFileName(runRoot);
        var archivePath = Path.Combine(packagesDir, $"{runFolderName}.zip");
        var tempArchivePath = Path.Combine(Path.GetTempPath(), $"{runFolderName}.zip");
        if (File.Exists(archivePath))
        {
            File.Delete(archivePath);
        }

        if (File.Exists(tempArchivePath))
        {
            File.Delete(tempArchivePath);
        }

        ZipFile.CreateFromDirectory(runRoot, tempArchivePath);
        File.Move(tempArchivePath, archivePath, overwrite: true);
        return new { ok = true, type = "runPackaged", archivePath };
    }

    private string ResolveOutputRoot(JsonObject request)
    {
        return ResolveOutputRoot(request["outputRoot"]?.GetValue<string>(), _paths);
    }

    internal static string ResolveOutputRoot(string? outputRoot, AppPaths paths)
    {
        var baseDirectory = string.IsNullOrWhiteSpace(outputRoot)
            ? paths.ExportsDirectory
            : outputRoot;

        var normalizedBaseDirectory = Path.TrimEndingDirectorySeparator(Path.GetFullPath(baseDirectory));
        if (string.Equals(Path.GetFileName(normalizedBaseDirectory), ExportRootFolderName, StringComparison.Ordinal))
        {
            return normalizedBaseDirectory;
        }

        return Path.Combine(normalizedBaseDirectory, ExportRootFolderName);
    }

    private string ResolveRunRoot(JsonObject request, string runId)
    {
        var outputRoot = ResolveOutputRoot(request);
        var runIndexPath = GetRunIndexPath(outputRoot, runId);
        if (File.Exists(runIndexPath))
        {
            var runFolderName = File.ReadAllText(runIndexPath, Encoding.UTF8).Trim();
            if (!string.IsNullOrWhiteSpace(runFolderName))
            {
                return Path.Combine(GetRunsDirectory(outputRoot), runFolderName);
            }
        }

        var legacyRoot = Path.Combine(outputRoot, runId);
        if (Directory.Exists(legacyRoot))
        {
            return legacyRoot;
        }

        return Path.Combine(GetRunsDirectory(outputRoot), runId);
    }

    private static string GetRunsDirectory(string outputRoot)
        => Path.Combine(outputRoot, "runs");

    private static string GetPackagesDirectory(string outputRoot)
        => Path.Combine(outputRoot, "packages");

    private static string GetRunIndexDirectory(string outputRoot)
        => Path.Combine(outputRoot, ".run-index");

    private static string GetRunIndexPath(string outputRoot, string runId)
        => Path.Combine(GetRunIndexDirectory(outputRoot), $"{runId}.txt");

    private static string CreateRunFolderName(string runId)
        => $"{DateTimeOffset.UtcNow:yyyy-MM-dd_HH-mm-ss}__run-{runId}";

    private static string BuildRunSummary(JsonObject? manifest, string runRoot)
    {
        var boards = manifest?["boards"]?.AsArray();
        var boardCount = boards?.Count ?? 0;
        var zoneCount = boards?
            .Where(board => board is JsonObject)
            .Select(board => ((JsonObject)board!)["zones"]?.AsArray()?.Count ?? 0)
            .Sum() ?? 0;
        var generatedAt = DateTimeOffset.UtcNow.ToString("O");

        return string.Join(Environment.NewLine, new[]
        {
            "Klaxoon Bulk Export Run Summary",
            $"Generated at: {generatedAt}",
            $"Run folder: {runRoot}",
            $"Boards: {boardCount}",
            $"Zones: {zoneCount}",
            $"Manifest: {Path.Combine(runRoot, "run-manifest.json")}"
        }) + Environment.NewLine;
    }
}
