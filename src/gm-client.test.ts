import { afterEach, describe, expect, it, vi } from "vitest";
import { askGm, keyStatus, listModels, type GmConfig } from "./gm-client.js";

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

describe("keyStatus", () => {
  it("parses the full field set into a summary containing key numbers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        ru_budget: 1000,
        ru_consumed: 250,
        ru_remaining: 750,
        ru_remaining_percent: 75,
        is_exhausted: false,
        period_start: "2026-07-01",
        period_end: "2026-07-31",
        requests: 42,
        rate_limit_rpm: 60,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await keyStatus({ ...config, umsUrl: "https://ums.example.com" });

    expect(result).toContain("750");
    expect(result).toContain("1000");
    expect(result).toContain("250");
    expect(result).toContain("75");
    expect(result).toContain("false");
  });

  it("maps 401 to an invalid-key string instead of throwing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse(401, "unauthorized"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await keyStatus({ ...config, umsUrl: "https://ums.example.com" });

    expect(result).toBe("invalid or inactive API key");
  });

  it("maps 403 to a no-subscription string instead of throwing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse(403, "forbidden"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await keyStatus({ ...config, umsUrl: "https://ums.example.com" });

    expect(result).toBe("no active subscription for this key");
  });

  it("returns a not-configured string without calling fetch when umsUrl is undefined", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await keyStatus(config);

    expect(result).toBe(
      "gm_balance is not configured: set GM_UMS_URL to the gm user-management-api base URL.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
