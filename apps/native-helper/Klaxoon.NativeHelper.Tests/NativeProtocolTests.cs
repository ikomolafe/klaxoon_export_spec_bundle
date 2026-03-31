/*
Copyright © 2026 KD Computers Ltd. All rights reserved.

This software and associated source code are proprietary and confidential to KD Computers Ltd.
Use, reproduction, modification, distribution, sublicensing, disclosure, or reverse engineering
is prohibited except as expressly permitted under a valid written licence agreement.

Governing law: England and Wales.
*/

using System.Text.Json;
using System.Text.Json.Nodes;
using Xunit;

namespace Klaxoon.NativeHelper.Tests;

public sealed class NativeProtocolTests
{
    private static JsonObject SerializeResponse(object response)
        => JsonNode.Parse(JsonSerializer.Serialize(response))!.AsObject();

    private static NativeProtocol CreateProtocol(string? root = null)
        => new(new AppPaths(root ?? Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"))));

    [Fact]
    public void HandlePrepareRunUsesDefaultExportRootWhenMissing()
    {
        var root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        var protocol = CreateProtocol(root);

        var response = SerializeResponse(protocol.Handle(new JsonObject
        {
            ["type"] = "prepareRun",
            ["runId"] = "run-001"
        }));

        var runRoot = response["runRoot"]!.GetValue<string>();
        var outputRoot = response["outputRoot"]!.GetValue<string>();

        Assert.Equal("runPrepared", response["type"]!.GetValue<string>());
        Assert.Equal(Path.Combine(root, "exports", "Klaxoon_Bulk_Export"), outputRoot);
        Assert.StartsWith(Path.Combine(root, "exports", "Klaxoon_Bulk_Export", "runs"), runRoot, StringComparison.Ordinal);
        Assert.Contains("__run-run-001", runRoot, StringComparison.Ordinal);
        Assert.True(Directory.Exists(Path.Combine(outputRoot, ".run-index")));
    }

    [Fact]
    public void HandleChooseOutputRootReturnsPickerSelection()
    {
        Environment.SetEnvironmentVariable("KD_PICK_FOLDER_RESULT", "/tmp/klaxoon-export-target");

        try
        {
            var response = CreateProtocol().Handle(new JsonObject
            {
                ["type"] = "chooseOutputRoot"
            }).ToString();

            Assert.Contains("outputRootChosen", response, StringComparison.Ordinal);
            Assert.Contains("/tmp/klaxoon-export-target", response, StringComparison.Ordinal);
        }
        finally
        {
            Environment.SetEnvironmentVariable("KD_PICK_FOLDER_RESULT", null);
        }
    }

    [Fact]
    public void HandleChooseOutputRootReturnsUnavailableMessage()
    {
        Environment.SetEnvironmentVariable("KD_PICK_FOLDER_ERROR", "FOLDER_PICKER_UNAVAILABLE");

        try
        {
            var response = SerializeResponse(CreateProtocol().Handle(new JsonObject
            {
                ["type"] = "chooseOutputRoot"
            }));

            Assert.False(response["ok"]!.GetValue<bool>());
            Assert.Equal("FOLDER_PICKER_UNAVAILABLE", response["errorCode"]!.GetValue<string>());
            Assert.Contains("Type a local folder path manually", response["message"]!.GetValue<string>(), StringComparison.Ordinal);
        }
        finally
        {
            Environment.SetEnvironmentVariable("KD_PICK_FOLDER_ERROR", null);
        }
    }

    [Fact]
    public void HandlePackageRunCreatesArchiveOutsideRunDirectory()
    {
        var root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        var protocol = CreateProtocol(root);

        var prepared = SerializeResponse(protocol.Handle(new JsonObject
        {
            ["type"] = "prepareRun",
            ["runId"] = "run-002"
        }));

        var runRoot = prepared["runRoot"]!.GetValue<string>();
        File.WriteAllText(Path.Combine(runRoot, "logs", "app.log"), "hello");

        var response = SerializeResponse(protocol.Handle(new JsonObject
        {
            ["type"] = "packageRun",
            ["runId"] = "run-002"
        }));

        var archivePath = response["archivePath"]!.GetValue<string>();
        Assert.Equal("runPackaged", response["type"]!.GetValue<string>());
        Assert.StartsWith(Path.Combine(root, "exports", "Klaxoon_Bulk_Export", "packages"), archivePath, StringComparison.Ordinal);
        Assert.EndsWith(".zip", archivePath, StringComparison.Ordinal);
        Assert.Contains("__run-run-002", archivePath, StringComparison.Ordinal);
        Assert.True(File.Exists(archivePath));
        Assert.False(File.Exists(Path.Combine(runRoot, Path.GetFileName(archivePath))));
    }

    [Fact]
    public void HandleWriteManifestCreatesSummaryBesideManifest()
    {
        var root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        var protocol = CreateProtocol(root);

        var prepared = SerializeResponse(protocol.Handle(new JsonObject
        {
            ["type"] = "prepareRun",
            ["runId"] = "run-003"
        }));

        var manifest = new JsonObject
        {
            ["schemaVersion"] = "1.0.0",
            ["runId"] = "run-003",
            ["startedAt"] = "2026-03-13T00:00:00Z",
            ["outputRoot"] = Path.Combine(root, "exports", "Klaxoon_Bulk_Export"),
            ["boards"] = new JsonArray
            {
                new JsonObject
                {
                    ["workspaceName"] = "Delivery",
                    ["boardName"] = "Quarterly Planning",
                    ["boardKey"] = "board-12345",
                    ["statuses"] = new JsonObject
                    {
                        ["pdf"] = "done"
                    },
                    ["files"] = new JsonArray("workspaces/delivery/quarterly-planning__board-12345/zones/00-overview/board.pdf"),
                    ["zones"] = new JsonArray
                    {
                        new JsonObject
                        {
                            ["zoneName"] = "Overview",
                            ["zoneKey"] = "zone-001",
                            ["statuses"] = new JsonObject
                            {
                                ["pdf"] = "done"
                            },
                            ["files"] = new JsonArray("workspaces/delivery/quarterly-planning__board-12345/zones/00-overview/board.pdf")
                        }
                    }
                }
            }
        };

        var response = SerializeResponse(protocol.Handle(new JsonObject
        {
            ["type"] = "writeManifest",
            ["runId"] = "run-003",
            ["manifest"] = manifest
        }));

        var runRoot = prepared["runRoot"]!.GetValue<string>();
        var manifestPath = response["manifestPath"]!.GetValue<string>();
        var summaryPath = Path.Combine(runRoot, "run-summary.txt");
        var summaryText = File.ReadAllText(summaryPath);

        Assert.Equal("manifestWritten", response["type"]!.GetValue<string>());
        Assert.True(File.Exists(manifestPath));
        Assert.True(File.Exists(summaryPath));
        Assert.Contains("Boards: 1", summaryText, StringComparison.Ordinal);
        Assert.Contains("Zones: 1", summaryText, StringComparison.Ordinal);
    }

    [Fact]
    public void ResolvedOutputRootIsNotNestedWhenReusedAcrossRequests()
    {
        var root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        var protocol = CreateProtocol(root);

        var prepared = SerializeResponse(protocol.Handle(new JsonObject
        {
            ["type"] = "prepareRun",
            ["runId"] = "run-004"
        }));

        var outputRoot = prepared["outputRoot"]!.GetValue<string>();
        var runRoot = prepared["runRoot"]!.GetValue<string>();

        protocol.Handle(new JsonObject
        {
            ["type"] = "appendLog",
            ["runId"] = "run-004",
            ["outputRoot"] = outputRoot,
            ["message"] = "hello"
        });

        var response = SerializeResponse(protocol.Handle(new JsonObject
        {
            ["type"] = "packageRun",
            ["runId"] = "run-004",
            ["outputRoot"] = outputRoot
        }));

        var archivePath = response["archivePath"]!.GetValue<string>();
        Assert.True(File.Exists(Path.Combine(runRoot, "logs", "app.log")));
        Assert.StartsWith(Path.Combine(outputRoot, "packages"), archivePath, StringComparison.Ordinal);
        Assert.DoesNotContain("Klaxoon_Bulk_Export/Klaxoon_Bulk_Export", archivePath, StringComparison.Ordinal);
    }
}
