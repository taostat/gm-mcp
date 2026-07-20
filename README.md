# gm-mcp

An MCP (Model Context Protocol) server that exposes models available on the
[gm](https://saygm.com) inference gateway — a Bittensor subnet product — as
callable tools, so a coding agent (Codex, Claude Code) can call gm models by
name and list what's available.

## Install

```bash
npx -y gm-mcp
```

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
args = ["-y", "gm-mcp"]
env = { "GM_API_KEY" = "sk-...", "GM_BASE_URL" = "https://api.saygm.com/v1" }
```

## Claude Code

Add to `.mcp.json`:

```json
{
  "mcpServers": {
    "gm": {
      "command": "npx",
      "args": ["-y", "gm-mcp"],
      "env": {
        "GM_API_KEY": "sk-...",
        "GM_BASE_URL": "https://api.saygm.com/v1"
      }
    }
  }
}
```

## Notes

`gm_ask` uses non-streaming (`stream: false`) intentionally — it sidesteps a
gm gateway streaming bug and returns the full response in one shot; a
5-minute client timeout covers long-reasoning models.
