export interface GmConfig {
  baseUrl: string;
  apiKey: string;
}

interface CatalogModel {
  id: string;
  apiShapes: string[];
  available: boolean;
}

interface RawCatalogEntry {
  id?: unknown;
  api_shapes?: unknown;
  available?: unknown;
}

interface ModelsResponse {
  data?: unknown;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
}

interface AnthropicContentBlock {
  type?: unknown;
  text?: unknown;
}

interface AnthropicMessagesResponse {
  content?: unknown;
}

interface GeminiPart {
  text?: unknown;
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{ content?: { parts?: unknown } }>;
}

const ASK_TIMEOUT_MS = 300_000;
const CATALOG_TIMEOUT_MS = 60_000;
const CATALOG_TTL_MS = 60_000;

let catalogCache: { config: GmConfig; entries: CatalogModel[]; expiresAt: number } | null = null;

/** Drops the module-level catalog cache. Test-only escape hatch. */
export function clearCatalogCache(): void {
  catalogCache = null;
}

function originOf(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, "");
}

// Wraps fetch with a bounded timeout and consistent error text. The caller
// supplies the full URL and headers (including auth) since each gm surface
// authenticates differently — this helper stays surface-agnostic.
async function gmFetch(
  url: string,
  headers: Record<string, string>,
  init: Omit<RequestInit, "headers">,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, headers, signal: controller.signal });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`gm ${url} -> ${response.status}: ${body.slice(0, 500)}`);
    }
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`gm ${url} timed out after ${timeoutMs} ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseCatalogEntry(raw: RawCatalogEntry): CatalogModel | undefined {
  if (typeof raw.id !== "string") {
    return undefined;
  }
  const apiShapes = Array.isArray(raw.api_shapes)
    ? raw.api_shapes.filter((shape): shape is string => typeof shape === "string")
    : [];
  return { id: raw.id, apiShapes, available: raw.available === true };
}

async function fetchCatalog(config: GmConfig): Promise<CatalogModel[]> {
  const response = await gmFetch(
    `${config.baseUrl}/models`,
    { Authorization: `Bearer ${config.apiKey}` },
    { method: "GET" },
    CATALOG_TIMEOUT_MS,
  );
  const data = (await response.json()) as ModelsResponse;
  const rawEntries = Array.isArray(data.data) ? (data.data as RawCatalogEntry[]) : [];
  const entries: CatalogModel[] = [];
  for (const raw of rawEntries) {
    const entry = parseCatalogEntry(raw);
    if (entry !== undefined) {
      entries.push(entry);
    }
  }
  return entries;
}

async function getCatalog(config: GmConfig): Promise<CatalogModel[]> {
  const now = Date.now();
  if (catalogCache && catalogCache.config === config && catalogCache.expiresAt > now) {
    return catalogCache.entries;
  }
  const entries = await fetchCatalog(config);
  catalogCache = { config, entries, expiresAt: now + CATALOG_TTL_MS };
  return entries;
}

function isSupportedSurface(apiShapes: string[]): boolean {
  return (
    apiShapes.includes("chat.completions") ||
    apiShapes.includes("messages") ||
    apiShapes.some((shape) => shape.startsWith("generateContent"))
  );
}

async function askOpenAI(
  config: GmConfig,
  model: string,
  prompt: string,
  system?: string,
): Promise<string> {
  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (system !== undefined) {
    messages.push({ role: "system", content: system });
  }
  messages.push({ role: "user", content: prompt });

  const response = await gmFetch(
    `${config.baseUrl}/chat/completions`,
    { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    { method: "POST", body: JSON.stringify({ model, messages, stream: false }) },
    ASK_TIMEOUT_MS,
  );
  const data = (await response.json()) as ChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

async function askAnthropic(
  config: GmConfig,
  model: string,
  prompt: string,
  system?: string,
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  };
  if (system !== undefined) {
    body["system"] = system;
  }

  const response = await gmFetch(
    `${config.baseUrl}/messages`,
    {
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    { method: "POST", body: JSON.stringify(body) },
    ASK_TIMEOUT_MS,
  );
  const data = (await response.json()) as AnthropicMessagesResponse;
  const blocks = Array.isArray(data.content) ? (data.content as AnthropicContentBlock[]) : [];
  return blocks
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("");
}

async function askGemini(
  config: GmConfig,
  model: string,
  prompt: string,
  system?: string,
): Promise<string> {
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  };
  if (system !== undefined) {
    body["systemInstruction"] = { parts: [{ text: system }] };
  }

  // Gemini surface auth (x-goog-api-key) is unverified — no Gemini miner was
  // available to confirm during development; verify against a live miner.
  const response = await gmFetch(
    `${originOf(config.baseUrl)}/v1beta/models/${model}:generateContent`,
    { "x-goog-api-key": config.apiKey, "Content-Type": "application/json" },
    { method: "POST", body: JSON.stringify(body) },
    ASK_TIMEOUT_MS,
  );
  const data = (await response.json()) as GeminiGenerateContentResponse;
  const parts = data.candidates?.[0]?.content?.parts;
  const geminiParts = Array.isArray(parts) ? (parts as GeminiPart[]) : [];
  return geminiParts
    .filter((part) => typeof part.text === "string")
    .map((part) => part.text as string)
    .join("");
}

export async function askGm(
  config: GmConfig,
  model: string,
  prompt: string,
  system?: string,
): Promise<string> {
  const catalog = await getCatalog(config);
  const entry = catalog.find((candidate) => candidate.id === model);
  if (!entry) {
    throw new Error(`unknown model '${model}' — call gm_list_models to see available models`);
  }

  let text: string;
  if (entry.apiShapes.includes("chat.completions")) {
    text = await askOpenAI(config, model, prompt, system);
  } else if (entry.apiShapes.includes("messages")) {
    text = await askAnthropic(config, model, prompt, system);
  } else if (entry.apiShapes.some((shape) => shape.startsWith("generateContent"))) {
    text = await askGemini(config, model, prompt, system);
  } else {
    throw new Error(
      `model '${model}' uses an unsupported surface (api_shapes: ${entry.apiShapes.join(", ")})`,
    );
  }

  if (text.trim().length === 0) {
    throw new Error(`gm returned empty content for model '${model}'`);
  }
  return text;
}

export async function listModels(config: GmConfig): Promise<string> {
  const catalog = await getCatalog(config);
  const ids = catalog
    .filter((entry) => entry.available && isSupportedSurface(entry.apiShapes))
    .map((entry) => entry.id)
    .sort();
  return ids.join("\n");
}
