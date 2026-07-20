import { afterEach, describe, expect, it, vi } from "vitest";
import { askGm, listModels, type GmConfig } from "./gm-client.js";

const config: GmConfig = {
  baseUrl: "https://gm.example.com/v1",
  apiKey: "sk-test",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("askGm", () => {
  it("returns content on the happy path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { choices: [{ message: { content: "hello there" } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await askGm(config, "gm-model", "hi");

    expect(result).toBe("hello there");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://gm.example.com/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws when content is empty or missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { choices: [{ message: { content: "   " } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(askGm(config, "gm-model", "hi")).rejects.toThrow(
      "gm returned empty content for model 'gm-model'",
    );
  });

  it("throws with status and body text on non-2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse(500, "internal error"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(askGm(config, "gm-model", "hi")).rejects.toThrow(
      "gm /chat/completions -> 500: internal error",
    );
  });
});

describe("listModels", () => {
  it("parses data[].id into newline-joined ids", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { data: [{ id: "model-a" }, { id: "model-b" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await listModels(config);

    expect(result).toBe("model-a\nmodel-b");
  });
});
