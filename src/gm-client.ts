export interface GmConfig {
  baseUrl: string;
  apiKey: string;
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
}

interface ModelsResponse {
  data?: Array<{ id?: unknown }>;
}

const ASK_TIMEOUT_MS = 300_000;
const LIST_TIMEOUT_MS = 60_000;

// Wraps fetch with a bounded timeout, bearer auth, and consistent error text.
// A timed-out request surfaces as a clear "timed out" message rather than the
// opaque AbortError the runtime would otherwise throw.
async function gmFetch(
  config: GmConfig,
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${config.apiKey}`, ...init.headers },
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`gm ${path} -> ${response.status}: ${body.slice(0, 500)}`);
    }
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`gm ${path} timed out after ${timeoutMs} ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function askGm(
  config: GmConfig,
  model: string,
  prompt: string,
  system?: string,
): Promise<string> {
  const messages: ChatMessage[] = [];
  if (system !== undefined) {
    messages.push({ role: "system", content: system });
  }
  messages.push({ role: "user", content: prompt });

  const response = await gmFetch(
    config,
    "/chat/completions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false }),
    },
    ASK_TIMEOUT_MS,
  );

  const data = (await response.json()) as ChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error(`gm returned empty content for model '${model}'`);
  }
  return content;
}

export async function listModels(config: GmConfig): Promise<string> {
  const response = await gmFetch(config, "/models", { method: "GET" }, LIST_TIMEOUT_MS);
  const data = (await response.json()) as ModelsResponse;
  const ids = (data.data ?? [])
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === "string");
  return ids.join("\n");
}
