import { afterEach, describe, expect, it, vi } from "vitest";
import { askGm, clearCatalogCache, listModels, type GmConfig } from "./gm-client.js";

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

function catalogResponse(
  entries: Array<{ id: string; api_shapes: string[]; available: boolean }>,
): Response {
  return jsonResponse(200, { data: entries });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  clearCatalogCache();
});

describe("askGm surface routing", () => {
  it("routes chat.completions models to the OpenAI surface", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        catalogResponse([{ id: "gpt-5.6", api_shapes: ["chat.completions"], available: true }]),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { choices: [{ message: { content: "hi from openai" } }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await askGm(config, "gpt-5.6", "hi", "be terse");

    expect(result).toBe("hi from openai");
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://gm.example.com/v1/chat/completions");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer sk-test",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      model: "gpt-5.6",
      messages: [
        { role: "system", content: "be terse" },
        { role: "user", content: "hi" },
      ],
      stream: false,
    });
  });

  it("routes messages models to the Anthropic surface", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        catalogResponse([{ id: "claude-fable-5", api_shapes: ["messages"], available: true }]),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          content: [
            { type: "text", text: "hi " },
            { type: "text", text: "from anthropic" },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await askGm(config, "claude-fable-5", "hi", "be terse");

    expect(result).toBe("hi from anthropic");
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://gm.example.com/v1/messages");
    expect(init.headers).toMatchObject({
      "x-api-key": "sk-test",
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    });
    expect(init.headers).not.toHaveProperty("Authorization");
    expect(JSON.parse(init.body as string)).toEqual({
      model: "claude-fable-5",
      max_tokens: 8192,
      system: "be terse",
      messages: [{ role: "user", content: "hi" }],
    });
  });

  it("routes generateContent models to the Gemini surface at the origin, under /v1beta", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        catalogResponse([
          {
            id: "gemini-3.1-pro-preview",
            api_shapes: ["generateContent+streamGenerateContent"],
            available: true,
          },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          candidates: [{ content: { parts: [{ text: "hi " }, { text: "from gemini" }] } }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await askGm(config, "gemini-3.1-pro-preview", "hi", "be terse");

    expect(result).toBe("hi from gemini");
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(
      "https://gm.example.com/v1beta/models/gemini-3.1-pro-preview:generateContent",
    );
    expect(init.headers).toMatchObject({
      "x-goog-api-key": "sk-test",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      systemInstruction: { parts: [{ text: "be terse" }] },
    });
  });

  it("throws a clear error for an unknown model", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        catalogResponse([{ id: "gpt-5.6", api_shapes: ["chat.completions"], available: true }]),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(askGm(config, "no-such-model", "hi")).rejects.toThrow(
      "unknown model 'no-such-model' — call gm_list_models to see available models",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws for a model whose only surface is unsupported", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        catalogResponse([{ id: "o5-responses", api_shapes: ["responses"], available: true }]),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(askGm(config, "o5-responses", "hi")).rejects.toThrow(
      "model 'o5-responses' uses an unsupported surface (api_shapes: responses)",
    );
  });

  it.each([
    ["openai", ["chat.completions"], { choices: [{ message: { content: "   " } }] }],
    ["anthropic", ["messages"], { content: [{ type: "text", text: "" }] }],
    ["gemini", ["generateContent"], { candidates: [{ content: { parts: [] } }] }],
  ] as const)("throws when %s returns empty content", async (_surface, apiShapes, surfaceBody) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        catalogResponse([{ id: "gm-model", api_shapes: [...apiShapes], available: true }]),
      )
      .mockResolvedValueOnce(jsonResponse(200, surfaceBody));
    vi.stubGlobal("fetch", fetchMock);

    await expect(askGm(config, "gm-model", "hi")).rejects.toThrow(
      "gm returned empty content for model 'gm-model'",
    );
  });

  it("throws with status and body text on a non-2xx surface response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        catalogResponse([{ id: "gpt-5.6", api_shapes: ["chat.completions"], available: true }]),
      )
      .mockResolvedValueOnce(textResponse(500, "internal error"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(askGm(config, "gpt-5.6", "hi")).rejects.toThrow(
      "gm https://gm.example.com/v1/chat/completions -> 500: internal error",
    );
  });
});

describe("listModels", () => {
  it("returns only available, supported-surface models, sorted", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      catalogResponse([
        { id: "gpt-5.6", api_shapes: ["chat.completions"], available: true },
        { id: "claude-fable-5", api_shapes: ["messages"], available: true },
        { id: "unavailable-model", api_shapes: ["chat.completions"], available: false },
        { id: "responses-only-model", api_shapes: ["responses"], available: true },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await listModels(config);

    expect(result).toBe("claude-fable-5\ngpt-5.6");
  });

  it("surfaces a clear timeout error when the catalog request aborts", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const assertion = expect(listModels(config)).rejects.toThrow(
      "gm https://gm.example.com/v1/models timed out after 60000 ms",
    );
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
  });
});
