# OpenClaw CRM MCP Server

Model Context Protocol (MCP) access to your OpenClaw / Kottke CRM for **Claude Code** and **Claude Desktop**.

There are **two ways** to connect:

| Mode | When to use | Endpoint |
|------|-------------|----------|
| **Remote (Vercel)** | Production / always on | `https://YOUR-CRM/api/mcp` |
| **Local stdio** (this package) | Offline, local dev, or custom host | `node apps/mcp/dist/index.js` |

## Remote MCP on Vercel (recommended)

The CRM web app exposes Streamable HTTP MCP at **`/api/mcp`** (deployed with the main Vercel project).

1. Create an API key in the CRM: **Settings → API Keys** → copy `oc_sk_…`
2. Point Claude at the URL with the key.

### Claude Code

```bash
claude mcp add kottke-crm \
  --transport http \
  --header "Authorization: Bearer oc_sk_YOUR_KEY" \
  -- https://darioushkottke.online/api/mcp
```

Or in `.mcp.json` / user config:

```json
{
  "mcpServers": {
    "kottke-crm": {
      "url": "https://darioushkottke.online/api/mcp",
      "headers": {
        "Authorization": "Bearer oc_sk_YOUR_KEY"
      }
    }
  }
}
```

### Claude Desktop (remote via mcp-remote)

```json
{
  "mcpServers": {
    "kottke-crm": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://darioushkottke.online/api/mcp",
        "--header",
        "Authorization: Bearer oc_sk_YOUR_KEY"
      ]
    }
  }
}
```

Use the **custom domain** (`darioushkottke.online`), not the `*.vercel.app` alias — the alias 307-redirects and some MCP clients mishandle that.

---

## Local stdio package (this folder)

## What you get

~50 tools covering:

| Area | Examples |
|------|----------|
| **Auth** | `crm_login`, `crm_logout`, `crm_status`, `crm_whoami` |
| **Search** | `crm_search`, `crm_browse_records` |
| **Records** | list / get / create / update / delete / query people, companies, deals, … |
| **Tasks & notes** | full CRUD |
| **Lists** | boards / collections |
| **Inbox** | conversations, messages, link deal, suggest reply |
| **Deals** | insights, lifecycle, profit, documents, quotation, payments |
| **Finance** | overview, bookings, employees |
| **Stats** | overview, pipeline, operations, team |
| **Escape hatch** | `crm_api` — raw authenticated call to any `/api/…` path |

## Auth (pick one)

The CRM already supports two auth methods; the MCP uses both.

### 1. API key (recommended for Claude Desktop / permanent config)

1. Open the CRM → **Settings → API Keys**
2. Create a key (starts with `oc_sk_`)
3. Put it in the MCP env as `CRM_API_KEY`

### 2. Email + password login (staff account)

Better-auth email/password. Either:

- Set `CRM_EMAIL` + `CRM_PASSWORD` in the MCP env (auto-login on first tool call), or
- Call the `crm_login` tool from Claude at runtime

Optional: set `CRM_SESSION_FILE` to a path (e.g. `~/.config/openclaw-crm/session`) so the session cookie survives MCP process restarts.

> Employee-portal accounts cannot access the CRM API (by design). Use a staff/admin user or an API key.

## Install

From the monorepo root:

```bash
pnpm install
pnpm --filter @openclaw-crm/mcp build
```

For local iteration without building:

```bash
pnpm --filter @openclaw-crm/mcp dev
```

## Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "kottke-crm": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/Kottke New CRM/Untitled/apps/mcp/dist/index.js"
      ],
      "env": {
        "CRM_BASE_URL": "https://YOUR-CRM-HOST",
        "CRM_API_KEY": "oc_sk_..."
      }
    }
  }
}
```

**Login-only variant** (no API key):

```json
{
  "mcpServers": {
    "kottke-crm": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/Kottke New CRM/Untitled/apps/mcp/dist/index.js"
      ],
      "env": {
        "CRM_BASE_URL": "https://YOUR-CRM-HOST",
        "CRM_EMAIL": "you@example.com",
        "CRM_PASSWORD": "your-password",
        "CRM_SESSION_FILE": "/Users/YOU/.config/openclaw-crm/session"
      }
    }
  }
}
```

Or run via `tsx` without a build step:

```json
"command": "npx",
"args": ["tsx", "/ABSOLUTE/PATH/TO/apps/mcp/src/index.ts"]
```

Restart Claude Desktop after saving.

## Claude Code

Add to project or user MCP config (`.mcp.json` or Claude Code settings):

```json
{
  "mcpServers": {
    "kottke-crm": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/apps/mcp/dist/index.js"
      ],
      "env": {
        "CRM_BASE_URL": "https://YOUR-CRM-HOST",
        "CRM_API_KEY": "oc_sk_..."
      }
    }
  }
}
```

Claude Code CLI equivalent:

```bash
claude mcp add kottke-crm \
  --env CRM_BASE_URL=https://YOUR-CRM-HOST \
  --env CRM_API_KEY=oc_sk_... \
  -- node "/ABSOLUTE/PATH/TO/apps/mcp/dist/index.js"
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CRM_BASE_URL` | **yes** | Origin only, e.g. `https://crm.example.com` or `http://localhost:3001` |
| `CRM_API_KEY` | one of auth | Bearer key `oc_sk_…` |
| `CRM_EMAIL` | one of auth | Staff email for better-auth |
| `CRM_PASSWORD` | with email | Password |
| `CRM_SESSION_FILE` | no | Persist session cookie path |
| `OPENCLAW_CRM_URL` | alias | Same as `CRM_BASE_URL` |
| `OPENCLAW_CRM_API_KEY` | alias | Same as `CRM_API_KEY` |

## Example prompts for Claude

- “Search the CRM for Müller and open the latest deal.”
- “List open inbox conversations in the lead lane.”
- “Show pipeline stats and overdue tasks.”
- “Create a task on deal \<id\>: call customer tomorrow.”
- “Use `crm_api` to GET `/api/v1/deals/<id>/inventory`.”

## Security notes

- Prefer **API keys** over storing passwords in config files.
- Restrict file permissions on config and `CRM_SESSION_FILE` (`chmod 600`).
- The MCP process has the same permissions as the key/user — treat it as a full CRM session.
- Do not commit real keys or passwords.

## Dev

```bash
cd apps/mcp
pnpm lint    # tsc --noEmit
pnpm build
CRM_BASE_URL=http://localhost:3001 CRM_API_KEY=oc_sk_test node dist/index.js
```

stdio is the MCP protocol channel; logs go to stderr.
