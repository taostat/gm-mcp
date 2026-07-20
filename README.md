# goodmorning-mcp

An MCP (Model Context Protocol) server that exposes models available on the
[gm](https://saygm.com) inference gateway — a Bittensor subnet product — as
callable tools, so a coding agent (Codex, Claude Code) can call gm models by
name and list what's available.

## Install

```bash
npx -y goodmorning-mcp
```

## Requirements

Node >= 22.

## Getting an API key

Sign up at [saygm.com](https://saygm.com) to get a `GM_API_KEY`.

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `GM_API_KEY` | yes | — | gm API key used as the bearer token for all requests |
| `GM_BASE_URL` | no | `https://api.saygm.com/v1` | gm gateway base URL |

## Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.gm]
command = "npx"
args = ["-y", "goodmorning-mcp"]
env = { "GM_API_KEY" = "sk-...", "GM_BASE_URL" = "https://api.saygm.com/v1" }
```

## Claude Code

Add to `.mcp.json`:

```json
{
  "mcpServers": {
    "gm": {
      "command": "npx",
      "args": ["-y", "goodmorning-mcp"],
      "env": {
        "GM_API_KEY": "sk-...",
        "GM_BASE_URL": "https://api.saygm.com/v1"
      }
    }
  }
}
```

## Tools

### `gm_ask`

Ask a specific gm model a prompt and get back its full response text.

| Param | Type | Required | Notes |
|---|---|---|---|
| `model` | string | yes | A gm catalog model id (see `gm_list_models`) |
| `prompt` | string | yes | The user prompt |
| `system` | string | no | Optional system prompt |

Non-streaming: the call blocks until the model finishes, then returns the
full text in one shot. If the model returns empty content, the tool throws
a clear error naming the model. The client applies a 5-minute timeout to
accommodate long-reasoning models.

### `gm_list_models`

No params. Returns the model ids available on the gm gateway as a
newline-separated string, for use as the `model` argument to `gm_ask`.

## Usage

Once the server is configured, prompt your agent in natural language. It
will call `gm_list_models` to discover valid model ids, then `gm_ask` to
query one. For example:

> Use gm to check the last response with kimi-k3.

> Ask gm_list_models what's available, then get a second opinion from
> claude-fable-5, gpt-5.6, and gemini-3.1-pro-preview.

Model ids come and go with the gm catalog, so call `gm_list_models` rather
than hardcoding one.

## Notes

`gm_ask` uses non-streaming (`stream: false`) intentionally — it sidesteps a
gm gateway streaming bug and returns the full response in one shot; a
5-minute client timeout covers long-reasoning models.
