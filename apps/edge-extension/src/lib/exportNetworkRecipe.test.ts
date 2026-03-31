import { describe, expect, it } from "vitest";
import { applyTemplateValue, buildTemplateContext, learnExportRecipe } from "./exportNetworkRecipe";

describe("exportNetworkRecipe", () => {
  it("applies placeholders from the learned context", () => {
    const context = buildTemplateContext({
      origin: "https://europa.klaxoon.com",
      boardUrl: "https://europa.klaxoon.com/participate/board/GBKJJCQ",
      boardKey: "GBKJJCQ",
      format: "pdf",
      mode: "board"
    });

    expect(
      applyTemplateValue(
        "https://europa.klaxoon.com/manager/api/v1/export/{{context.board_access_code_upper}}?format={{context.format}}",
        context
      )
    ).toBe("https://europa.klaxoon.com/manager/api/v1/export/GBKJJCQ?format=pdf");
  });

  it("learns a replay recipe from a kickoff, poll, and signed download chain", () => {
    const recipe = learnExportRecipe(
      [
        {
          url: "https://europa.klaxoon.com/manager/api/v1/exports/boards/GBKJJCQ",
          method: "POST",
          requestHeaders: {
            "content-type": "application/json",
            accept: "application/json"
          },
          requestBody: "{\"format\":\"pdf\"}",
          responseStatus: 200,
          responseHeaders: {
            "content-type": "application/json"
          },
          responseBody:
            "{\"jobId\":\"job-123\",\"pollUrl\":\"https://europa.klaxoon.com/manager/api/v1/exports/jobs/job-123\"}",
          mimeType: "application/json",
          startedAtMs: 100
        },
        {
          url: "https://europa.klaxoon.com/manager/api/v1/exports/jobs/job-123",
          method: "GET",
          requestHeaders: {
            accept: "application/json"
          },
          responseStatus: 200,
          responseHeaders: {
            "content-type": "application/json"
          },
          responseBody:
            "{\"status\":\"ready\",\"downloadUrl\":\"https://downloads.klaxoon.com/file/job-123/board.pdf?signature=test\"}",
          mimeType: "application/json",
          startedAtMs: 350
        },
        {
          url: "https://downloads.klaxoon.com/file/job-123/board.pdf?signature=test",
          method: "GET",
          responseStatus: 200,
          responseHeaders: {
            "content-type": "application/pdf",
            "content-disposition": "attachment; filename=\"board.pdf\""
          },
          mimeType: "application/pdf",
          startedAtMs: 650
        }
      ],
      {
        context: {
          origin: "https://europa.klaxoon.com",
          boardUrl: "https://europa.klaxoon.com/participate/board/GBKJJCQ",
          boardKey: "GBKJJCQ",
          format: "pdf",
          mode: "board"
        },
        filenameHints: ["pdf"]
      }
    );

    expect(recipe).not.toBeNull();
    expect(recipe?.requests).toHaveLength(3);
    expect(recipe?.requests[0]).toMatchObject({
      method: "POST",
      urlTemplate: "{{context.origin}}/manager/api/v1/exports/boards/{{context.board_key}}",
      bodyTemplate: "{\"format\":\"{{context.format}}\"}",
      execution: "fetch",
      expectDownload: false
    });
    expect(recipe?.requests[1]).toMatchObject({
      method: "GET",
      urlTemplate: "{{responses.0.body.pollUrl}}",
      execution: "fetch",
      expectDownload: false
    });
    expect(recipe?.requests[2]).toMatchObject({
      method: "GET",
      urlTemplate: "{{responses.1.body.downloadUrl}}",
      execution: "navigate",
      expectDownload: true
    });
  });

  it("rejects a direct temporary download URL as a reusable recipe", () => {
    const recipe = learnExportRecipe(
      [
        {
          url: "https://europa.klaxoon.com/manager/api/brainstorms/68bf2773-d40b-4bc5-934f-ae930c626869/file/2d7c3a54-bc9e-4ecb-aee4-6c058f8deba5/download-temporary",
          method: "GET",
          responseStatus: 200,
          responseHeaders: {
            "content-type": "application/pdf",
            "content-disposition": "attachment; filename=\"board.pdf\""
          },
          mimeType: "application/pdf",
          startedAtMs: 100
        }
      ],
      {
        context: {
          origin: "https://europa.klaxoon.com",
          boardUrl: "https://europa.klaxoon.com/participate/board/GBKJJCQ",
          boardKey: "GBKJJCQ",
          format: "pdf",
          mode: "board"
        },
        filenameHints: ["pdf"]
      }
    );

    expect(recipe).toBeNull();
  });

  it("learns a recipe from kickoff and poll when the final browser download request is not captured", () => {
    const recipe = learnExportRecipe(
      [
        {
          url: "https://europa.klaxoon.com/manager/api/v1/exports/boards/NU2RXFX",
          method: "POST",
          requestHeaders: {
            "content-type": "application/json",
            accept: "application/json"
          },
          requestBody: "{\"format\":\"pdf\"}",
          responseStatus: 200,
          responseHeaders: {
            "content-type": "application/json"
          },
          responseBody: "{\"jobId\":\"job-456\",\"pollUrl\":\"https://europa.klaxoon.com/manager/api/v1/exports/jobs/job-456\"}",
          mimeType: "application/json",
          startedAtMs: 100
        },
        {
          url: "https://europa.klaxoon.com/manager/api/v1/exports/jobs/job-456",
          method: "GET",
          requestHeaders: {
            accept: "application/json"
          },
          responseStatus: 200,
          responseHeaders: {
            "content-type": "application/json"
          },
          responseBody: "{\"status\":\"ready\",\"downloadUrl\":\"https://europa.klaxoon.com/manager/api/brainstorms/68bf2773-d40b-4bc5-934f-ae930c626869/file/2d7c3a54-bc9e-4ecb-aee4-6c058f8deba5/download-temporary\"}",
          mimeType: "application/json",
          startedAtMs: 350
        }
      ],
      {
        context: {
          origin: "https://europa.klaxoon.com",
          boardUrl: "https://europa.klaxoon.com/participate/board/NU2RXFX",
          boardKey: "NU2RXFX",
          format: "pdf",
          mode: "board"
        },
        filenameHints: ["pdf"]
      }
    );

    expect(recipe).not.toBeNull();
    expect(recipe?.requests).toHaveLength(3);
    expect(recipe?.requests[1]).toMatchObject({
      method: "GET",
      urlTemplate: "{{responses.0.body.pollUrl}}",
      execution: "fetch",
      expectDownload: false
    });
    expect(recipe?.requests[2]).toMatchObject({
      method: "GET",
      urlTemplate: "{{responses.1.body.downloadUrl}}",
      execution: "navigate",
      expectDownload: true
    });
  });
});
