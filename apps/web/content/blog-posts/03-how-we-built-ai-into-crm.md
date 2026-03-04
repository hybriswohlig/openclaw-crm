---
title: "Two Ways AI Works in OpenClaw CRM: Built-in Assistant and Agent Integration"
slug: "how-we-built-ai-into-crm"
description: "A technical deep-dive into OpenClaw CRM's two AI systems: a built-in tool-calling assistant with dynamic schema awareness, and external agent integration through the OpenClaw Bot skill file system."
date: "2026-02-17"
author: "OpenClaw Team"
category: "engineering"
keywords: ["AI CRM", "AI agent CRM", "OpenClaw Bot integration", "CRM AI assistant", "tool calling", "LLM agents", "AI assistant", "OpenRouter", "skill file", "agent-native CRM"]
---

# Two Ways AI Works in OpenClaw CRM: Built-in Assistant and Agent Integration

**Last updated:** February 2026

There are two distinct AI stories in OpenClaw CRM, and they solve different problems.

The first: a built-in AI assistant inside the CRM web UI. You open the chat panel, ask a question in plain English, and the assistant queries your data, creates records, or updates deals. It uses tool calling (not RAG), streams responses over SSE, and requires confirmation before any write operation.

The second: external agent integration through OpenClaw Bot. Your agent, running in a terminal or connected to whatever tools you use, gets a skill file that teaches it the entire CRM API. Generate the file, drop it into your agent config, and your agent can manage contacts, deals, tasks, and notes from wherever you already talk to it.

This post is a technical deep-dive into both systems. If you're building AI features into your own product, or you want to understand how the integration works before setting it up, this is where to start.

## What Each System Does

### Built-in AI Assistant (In-App)

When you're inside the CRM, the assistant lives in the chat panel. It has 13 tools: 8 read and 5 write.

**Read tools (auto-execute):**
- `search_records`: full-text search across all records
- `list_records`: list records with optional filters
- `get_record`: get a specific record by ID
- `list_objects`: list all object types
- `get_object`: get object schema with attributes
- `list_tasks`: list tasks (optionally filtered)
- `get_notes`: get notes for a record
- `list_lists`: list saved lists

**Write tools (require confirmation):**
- `create_record`: create a new record
- `update_record`: update an existing record
- `delete_record`: delete a record
- `create_task`: create a task
- `create_note`: add a note to a record

Read tools execute immediately. Write tools show a confirmation card in the UI: you review the action, click Confirm or Cancel. No data changes without your approval.

### External Agent Integration (OpenClaw Bot)

When you're outside the CRM, your OpenClaw Bot handles it. The agent uses a skill file that documents the full REST API: 19 endpoint categories covering workspaces, objects, records, search, tasks, notes, lists, and notifications.

The skill file is a Markdown document with YAML frontmatter. The agent reads it, understands the API structure, and makes HTTP requests on your behalf. No SDK, no special client library. Just REST calls with a Bearer token.

Here's what that looks like in practice:

```
> add the people from yesterday's meeting to the CRM

  Found 3 contacts in your meeting notes.
  Creating records in OpenClaw CRM...

  done Sarah Chen, Meridian Health Group
  done Alex Dumont, Sterling & Co
  done Omar Hassan, Sterling & Co

  All 3 added. Want me to create follow-up tasks?
```

```
> show me all deals closing this month

  Querying OpenClaw CRM...

  3 deals closing before Feb 28:
  - Northwind ($89k, Negotiation)
  - Horizon Enterprise ($156k, Negotiation)
  - Atlas Rebrand ($67.5k, Won)

  Total pipeline: $312.5k
```

```
> add a note to the Sterling deal about today's call

  Added note to Sterling & Co ($156k, Negotiation):
  "Call with Alex Dumont, discussed timeline for Q2 rollout.
   They need a proposal by March 5."

  done. Want me to create a task for the proposal deadline?
```

The agent chains operations naturally. It searches for "Sterling," finds the deal, creates a note, then offers to create a follow-up task. Multi-step workflows, no manual API calls.

## Architecture: Built-in Assistant

The in-app assistant follows a straightforward pipeline:

```
User Message
    |
API: /api/v1/chat/completions (POST)
    |
Build System Prompt (dynamic schema)
    |
OpenRouter API (Claude, GPT-4o, Llama, etc.)
    |
Tool Calls (up to 10 rounds)
    |
Read Tools --> Auto-Execute
Write Tools --> Return for Confirmation
    |
Stream Response (SSE) --> Frontend
    |
User Confirms Write --> /api/v1/chat/tool-confirm
    |
Execute Write Tool
    |
Append Result --> Conversation
```

### Dynamic System Prompt

The system prompt is not static. It's built from the database schema at request time. Every object type, every attribute, every status value, injected fresh on each request.

```typescript
export async function buildSystemPrompt(workspaceId: string): Promise<string> {
  const objs = await listObjects(workspaceId);

  const objectDetails = await Promise.all(
    objs.map(async (o) => {
      const full = await getObjectWithAttributes(workspaceId, o.slug);
      if (!full) return `- ${o.pluralName} (slug: "${o.slug}")`;

      const attrLines = (full.attributes as any[]).map((a) => {
        let desc = `    - "${a.slug}" (${a.type}${a.isMultiselect ? ", array" : ""})`;
        if (a.statuses?.length) {
          desc += `: values: ${a.statuses.map((s: any) => `"${s.title}"`).join(", ")}`;
        }
        return desc;
      });
      return `- ${o.pluralName} (slug: "${o.slug}")\n${attrLines.join("\n")}`;
    })
  );

  return `You are an AI assistant for OpenClaw CRM...

Available object types and their attributes:
${objectDetails.join("\n\n")}

When users ask about records, use the search_records or list_records tools.
When users want to create/update data, use create_record, update_record, or create_task.
Always prefer specific tools over generic responses.`;
}
```

Add a "Projects" object with custom attributes, and the assistant knows about it on the next message. No configuration, no retraining. The schema is the prompt.

**Example output:**
```
Available object types and their attributes:

- People (slug: "people")
    - "full_name" (personal_name)
    - "email" (email_address)
    - "phone" (phone_number)
    - "company" (record_reference)

- Companies (slug: "companies")
    - "name" (text)
    - "domain" (domain)
    - "industry" (select): values: "Technology", "Finance", "Healthcare"
    - "stage" (status): values: "Lead", "Qualified", "Customer"
```

### Tool Definitions and Handlers

Tools are defined with JSON schemas. Each has a handler with a `requiresConfirmation` flag:

```typescript
export const toolHandlers: Record<string, ToolHandler> = {
  search_records: {
    requiresConfirmation: false,
    async execute(args, ctx) {
      const results = await globalSearch(args.query, ctx.workspaceId);
      return results.slice(0, 10);
    },
  },

  create_record: {
    requiresConfirmation: true,
    async execute(args, ctx) {
      const record = await createRecord(
        ctx.workspaceId,
        args.objectSlug,
        args.values,
        ctx.userId
      );
      return { success: true, record };
    },
  },
  // ... 11 more handlers
};
```

Read tools (`requiresConfirmation: false`) execute immediately. Write tools (`requiresConfirmation: true`) return a confirmation card to the frontend:

```json
{
  "action": "create_record",
  "args": {
    "objectSlug": "companies",
    "values": {
      "name": "Acme Corp",
      "domain": "acme.com",
      "industry": "Technology"
    }
  }
}
```

The user sees: **Create Company**, Name: Acme Corp, Domain: acme.com, Industry: Technology. Two buttons: Confirm and Cancel. Only Confirm triggers the write.

### Multi-Round Tool Calling

Up to 10 rounds of tool calling per message. Example: "Create a deal for Acme Corp worth $50k." Round 1: AI calls `search_records` to find Acme Corp (returns `rec_123`). Round 2: AI calls `create_record` with the resolved reference.

```typescript
let rounds = 0;
const MAX_ROUNDS = 10;

while (rounds < MAX_ROUNDS) {
  const response = await callOpenRouter(messages, tools);

  if (response.finish_reason === "stop") {
    return response.content;
  }

  if (response.finish_reason === "tool_calls") {
    for (const toolCall of response.tool_calls) {
      const handler = toolHandlers[toolCall.function.name];
      const args = JSON.parse(toolCall.function.arguments);

      if (handler.requiresConfirmation) {
        return { needsConfirmation: true, toolCall, args };
      } else {
        const result = await handler.execute(args, { workspaceId, userId });
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: JSON.stringify(result),
        });
      }
    }
    rounds++;
  } else {
    break;
  }
}
```

### SSE Streaming and OpenRouter

Responses stream over Server-Sent Events. Tokens arrive as they're generated, so the UI updates in real time instead of making the user wait for a complete response.

```
data: {"token":"Here"}

data: {"token":" are"}

data: {"token":" the"}

data: {"token":" results"}

data: {"tool_call":{"id":"call_123","name":"search_records","args":"{\"query\":\"Acme\"}"}}

data: {"tool_result":{"id":"call_123","result":[...]}}
```

The assistant uses OpenRouter instead of direct OpenAI or Anthropic APIs. Model flexibility: users choose from Claude, GPT-4o, Llama, Gemini, and 200+ other models. One API integration, every model available. Set an OpenRouter API key and pick a model in workspace settings.

## Architecture: OpenClaw Bot Integration

The external agent integration is architecturally different from the built-in assistant. Instead of tools defined in TypeScript, the agent learns the API from a skill file: a Markdown document with structured instructions.

### The Skill File Format

The skill file is a `SKILL.md` with YAML frontmatter:

```yaml
---
name: openclaw
description: Interact with OpenClaw CRM, manage workspaces,
  records, contacts, companies, deals, tasks, notes, and lists.
homepage: https://your-instance.com
user-invocable: true
metadata:
  clawdbot:
    requires:
      env:
        - OPENCLAW_API_URL
        - OPENCLAW_API_KEY
---
```

The frontmatter declares:
- **name**: the skill identifier (`openclaw`)
- **description**: what the skill does (the agent reads this to decide when to invoke it)
- **homepage**: the CRM instance URL
- **user-invocable**: whether users can explicitly request this skill
- **metadata.clawdbot.requires.env**: environment variables the skill needs

Below the frontmatter, the body is a structured guide to the REST API. It covers core concepts (workspaces, objects, records, attributes, lists, tasks, notes), then documents every endpoint with method, path, parameters, and example payloads.

### The 19 API Endpoint Categories

The skill file documents these endpoint groups:

| Category | Endpoints | Operations |
|----------|-----------|------------|
| Workspace | 2 | Get details, update settings |
| Workspace Members | 2 | List members, add member |
| Objects | 3 | List objects, get object, get attributes |
| Records | 5 | List, create, get, update, delete |
| Search | 1 | Full-text search across all records |
| Tasks | 5 | List, create, update, delete, get by record |
| Notes | 6 | List all, get by ID, get by record, create, update, delete |
| Lists | 6 | List all, get details, get entries, add entry, update entry, remove entry |
| Notifications | 3 | Get notifications, mark read, mark all read |

Every endpoint includes the HTTP method, path, parameters, and expected request/response format. The agent reads this once, then makes standard HTTP requests with the Bearer token.

### Environment Variables and Auth

Two environment variables power the integration:

- `OPENCLAW_API_URL`: the base URL of your CRM instance (e.g., `https://crm.yourcompany.com`)
- `OPENCLAW_API_KEY`: a workspace-scoped API key (prefixed with `oc_sk_`)

API keys are generated in Settings > API Keys inside the CRM. Each key is scoped to a single workspace. All requests include `Authorization: Bearer $OPENCLAW_API_KEY`.

The response envelope is consistent across all endpoints:
- Success: `{ "data": ... }`
- Error: `{ "error": { "code": "...", "message": "..." } }`

### How the Agent Uses the Skill File

When you ask your OpenClaw Bot to do something CRM-related, it recognizes the request matches the `openclaw` skill, reads the skill file, plans a sequence of API calls, executes them over HTTP, and formats the results.

For "add the people from yesterday's meeting to the CRM," the agent reads its meeting notes (from another skill or context), calls `GET /api/v1/objects/people/attributes` to learn the schema, calls `POST /api/v1/objects/people/records` once per contact, and returns a summary.

The agent chains operations naturally because it has the full API documentation in context. Search for a record, get its ID, create a note attached to it.

### Setup: 2 Minutes

1. Go to Settings > OpenClaw in the CRM
2. Select an API key (or create one in Settings > API Keys)
3. Download the generated SKILL.md
4. Place it at `~/.openclaw/skills/openclaw/SKILL.md`
5. Add the config to your `openclaw.json`:

```json
{
  "skills": {
    "openclaw": {
      "enabled": true,
      "env": {
        "OPENCLAW_API_URL": "https://your-instance.com",
        "OPENCLAW_API_KEY": "oc_sk_your_key_here"
      }
    }
  }
}
```

6. Restart your OpenClaw Bot

The CRM generates the skill file with your instance URL pre-filled. The only manual step is pasting your API key into the config.

## Why Two Systems Instead of One

**Built-in assistant**: you're already in the CRM and want to ask a quick question or create a record without navigating forms.

**Agent integration**: you're not in the CRM. You're in your terminal or talking to your agent through whatever interface you use, and the agent handles CRM operations without you opening a browser.

Same underlying API, different access patterns. The built-in assistant calls service functions directly (server-side, same Next.js app). The agent calls the REST API over HTTP.

## The Hard Parts

**Tool call parsing.** LLMs sometimes return malformed JSON in tool arguments. Fix: try-catch around execution, return the error to the LLM, and it self-corrects on the next round.

**Context window management.** Tool results add up fast. A search returning 50 results burns 10K tokens. Fix: cap results at 10, omit large fields, summarize where possible.

**Streaming + tool calls.** OpenRouter streams tool calls incrementally as partial JSON chunks. You have to buffer deltas and only execute when `finish_reason === "tool_calls"`.

**Schema size in prompts.** For a workspace with 20 custom objects, the dynamic system prompt can hit 5K-10K tokens. Fix: cache aggressively, invalidate only on schema changes.

**Skill file maintenance.** The skill file is generated once and lives on the user's machine. If the API changes, regeneration is currently manual. The roadmap includes versioned skill files with change detection.

## Lessons Learned

### Tool Calling Over RAG for Structured Data

CRM data is structured. Users ask "show me deals over $50k" (SQL query) or "create a task for Monday" (API call). Vector search adds complexity without benefit. Tool calling lets the LLM decide when to query, what parameters to use, and how to format results.

### Dynamic System Prompts Make AI Feel Smart

Users think the assistant is "learning" their schema. It's not. We inject fresh schema data every request. Add a custom object, and the AI knows about it on the next message. The trick is making the prompt dynamic, not the model.

### The Read/Write Safety Split is Non-Negotiable

Read operations are safe. Worst case: wrong results, user ignores them. Write operations are dangerous. If the AI misinterprets "delete the deal" and deletes 50 records, trust is gone. Confirmation cards solve this cleanly.

### Skill Files are a Powerful Pattern

Teaching an agent through a Markdown document (instead of a custom SDK) has advantages: it's human-readable, easy to edit, and works with any agent that can read text. The YAML frontmatter provides structure for configuration. The Markdown body provides context for the LLM. Simple format, powerful result.

### Streaming Makes AI Feel Fast

Without streaming, users wait 3-5 seconds for a full response. With SSE streaming, tokens appear as they're generated. Users see progress. It feels fast even when total generation time is the same.

## Code Summary

### Built-in Assistant

The full assistant is around 800 lines of TypeScript:
- `services/ai-chat.ts`: tool definitions, handlers, system prompt builder
- `app/api/v1/chat/completions/route.ts`: SSE streaming API
- `app/api/v1/chat/tool-confirm/route.ts`: write tool confirmation
- `app/chat/page.tsx`: frontend UI

### Agent Integration

The skill file system:
- `app/(dashboard)/settings/openclaw/page.tsx`: skill file generator UI
- Generated `SKILL.md`: the skill file itself (around 350 lines of Markdown)
- `app/api/v1/*`: the 33 REST endpoints the agent calls

External dependencies: OpenRouter API (for the built-in assistant), Drizzle ORM (database), Next.js API routes (for both systems).

## Try It

**Built-in assistant**: open the CRM, navigate to [Chat](/chat), and start asking questions.

**Agent integration**: go to [Settings > OpenClaw](/settings/openclaw), generate your skill file, and connect your OpenClaw Bot. Two minutes. For the full walkthrough, see [How to Connect Your OpenClaw Bot to OpenClaw CRM in 2 Minutes](/blog/connect-openclaw-bot-to-crm).

Both systems work independently. Use one or both. The CRM is the same underneath.

---

[OpenClaw on GitHub](https://github.com/openclaw-crm/openclaw-crm) | [Live Demo](https://openclaw-crm.402box.io/chat) | [Full AI Service Code](https://github.com/openclaw-crm/openclaw-crm/blob/main/apps/web/src/services/ai-chat.ts)

---

**Related:**
- [Why Self-Hosting Your CRM Matters When You Run an AI Agent](/blog/why-self-hosted-crm)
- [Which Open-Source CRMs Work With AI Agents?](/blog/open-source-crm-landscape)
