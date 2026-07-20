#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { askGm, listModels, type GmConfig } from "./gm-client.js";

const SERVER_VERSION = "0.1.0";
const DEFAULT_BASE_URL = "https://api.saygm.com/v1";

function loadConfig(): GmConfig {
  const apiKey = process.env["GM_API_KEY"];
  if (!apiKey) {
    throw new Error("GM_API_KEY environment variable is required");
  }
  const baseUrl = process.env["GM_BASE_URL"] ?? DEFAULT_BASE_URL;
  return { baseUrl, apiKey };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function registerTools(server: McpServer, config: GmConfig): void {
  server.registerTool(
    "gm_ask",
    {
      description:
        "Ask a specific gm model. Use to audit or get a second opinion on a response from a different model.",
      inputSchema: {
        model: z.string(),
        prompt: z.string(),
        system: z.string().optional(),
      },
    },
    async ({ model, prompt, system }) => {
      try {
        const text = await askGm(config, model, prompt, system);
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: errorText(error) }], isError: true };
      }
    },
  );

  server.registerTool(
    "gm_list_models",
    {
      description: "List models available on gm so you can pick one for gm_ask.",
      inputSchema: {},
    },
    async () => {
      try {
        const text = await listModels(config);
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return { content: [{ type: "text", text: errorText(error) }], isError: true };
      }
    },
  );
}

async function main(): Promise<void> {
  const config = loadConfig();
  const server = new McpServer({ name: "gm-mcp", version: SERVER_VERSION });
  registerTools(server, config);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error(errorText(error));
  process.exit(1);
});
