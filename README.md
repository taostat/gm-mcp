# gm-mcp

An MCP (Model Context Protocol) server that exposes models available on the
[gm](https://saygm.com) inference gateway — a Bittensor subnet product — as
callable tools, so a coding agent (Codex, Claude Code) can call gm models by
name, list what's available, and check remaining budget on the current API
key.

## Install

```bash
npx -y gm-mcp
```

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `GM_API_KEY` | yes | — | gm API key used as the bearer token for all requests |
| `GM_BASE_URL` | no | `https://api.saygm.com/v1` | gm gateway base URL |
| `GM_UMS_URL` | no | — | gm user-management-api base URL; only needed for `gm_balance` |

## Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.gm]
command = "npx"
args = ["-y", "gm-mcp"]
env = { "GM_API_KEY" = "sk-...", "GM_BASE_URL" = "https://api.saygm.com/v1", "GM_UMS_URL" = "https://ums.saygm.com" }
```

(`GM_UMS_URL` above is a placeholder — substitute the real gm UMS base URL.)

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
        "GM_BASE_URL": "https://api.saygm.com/v1",
        "GM_UMS_URL": "https://ums.saygm.com"
      }
    }
  }
}
```

## Notes

`gm_ask` uses non-streaming (`stream: false`) intentionally — it sidesteps a
gm gateway streaming bug and returns the full response in one shot; a
5-minute client timeout covers long-reasoning models.

`gm_balance` requires `GM_UMS_URL`; public reachability of the UMS host may
need to be configured separately from the gateway itself.
