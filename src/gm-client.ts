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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ASK_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages, stream: false }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`gm /chat/completions -> ${response.status}: ${body.slice(0, 500)}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new Error(`gm returned empty content for model '${model}'`);
    }
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

export async function listModels(config: GmConfig): Promise<string> {
  const response = await fetch(`${config.baseUrl}/models`, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`gm /models -> ${response.status}: ${body.slice(0, 500)}`);
  }

  const data = (await response.json()) as ModelsResponse;
  const ids = (data.data ?? [])
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === "string");
  return ids.join("\n");
}
