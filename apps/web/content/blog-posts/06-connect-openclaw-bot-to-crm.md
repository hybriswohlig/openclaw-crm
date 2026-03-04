---
title: "How to Connect Your OpenClaw Bot to OpenClaw CRM in 2 Minutes"
slug: "connect-openclaw-bot-to-crm"
description: "Step-by-step tutorial: generate a skill file, drop it into your OpenClaw Bot, and your agent manages your CRM. 2-minute setup."
date: "2026-02-19"
author: "OpenClaw Team"
category: "tutorial"
keywords: ["OpenClaw Bot CRM", "CRM skill", "connect AI agent to CRM", "OpenClaw Bot tutorial", "agent CRM integration"]
---

# How to Connect Your OpenClaw Bot to OpenClaw CRM in 2 Minutes

**Last updated:** February 2026

Your OpenClaw Bot already manages your email, calendar, and whatever other tools you have connected. Adding a CRM to that list takes about 2 minutes. You generate a skill file inside OpenClaw CRM, drop it into your agent config, restart, and you are done. Your agent can then create contacts, update deals, log notes, and search your data from wherever you already talk to it.

This tutorial walks through every step. No guesswork, no ambiguity.

## Prerequisites

Before you start, you need two things:

1. **A running OpenClaw CRM instance.** You have two options:
   - **Hosted (no setup):** Sign up at [openclaw-crm.402box.io](https://openclaw-crm.402box.io). You get a working CRM instance immediately, no infrastructure required. The web UI is your frontend for everything your bot adds.
   - **Self-hosted:** Deploy via Docker Compose on your own server. See the [README on GitHub](https://github.com/openclaw-crm/openclaw-crm) for setup instructions. Your instance will be accessible at a URL you control (e.g., `https://crm.yourcompany.com` or `http://localhost:3001` for local development).

2. **An OpenClaw Bot.** Your agent should already be running and configured with at least a basic `openclaw.json` config file. If you are new to OpenClaw Bot, the [OpenClaw Bot quickstart](https://docs.openclaw.dev/bot/quickstart) covers initial setup.

That is it. No additional dependencies, no paid services required. The hosted version works out of the box, self-hosting gives you full data ownership.

## Step 1: Create an API Key

Your OpenClaw Bot needs a way to authenticate with the CRM. API keys handle this.

1. Open your OpenClaw CRM in a browser.
2. Navigate to **Settings > API Keys** (in the sidebar under your workspace settings).
3. Click **"Create Key"**.
4. Give the key a descriptive name, something like `openclaw-bot-production` or `agent-dev`.
5. Click **Create**.
6. Copy the key immediately. It starts with `oc_sk_` and looks like this:

```
oc_sk_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

**Important:** You will only see the full key once. If you lose it, you will need to create a new one. Store it somewhere safe.

## Step 2: Open the Skill File Generator

1. In OpenClaw CRM, navigate to **Settings > OpenClaw**.
2. This is the integration configuration page. It knows your CRM's URL, your workspace schema, and all available API endpoints.

You will see a 4-step wizard that generates a complete `SKILL.md` file for your agent.

## Step 3: Generate the Skill File

The wizard walks you through four panels. Here is what each one does.

### Panel 1: Base URL

The wizard detects your CRM instance URL automatically (e.g., `https://crm.yourcompany.com`). Confirm it is correct. If you are running behind a reverse proxy or using a custom domain, update it here.

### Panel 2: Authentication

Paste the API key you created in Step 1. The wizard embeds authentication instructions into the skill file so your agent knows to include the `Authorization: Bearer oc_sk_...` header on every request.

### Panel 3: API Endpoints

The wizard includes all **19 API endpoint categories** with request/response examples:

- Objects (list, get, create, update, delete)
- Records (list, get, create, update, delete, search)
- Attributes (list, get, create, update, delete)
- Record Values (get, set)
- Tasks (list, get, create, update, delete)
- Notes (list, create, delete)
- Lists (list, get, create, update, delete)
- Chat (completions, tool confirm)
- Search (global search)
- Workspace (get, update)
- Members (list, invite, remove)
- API Keys (list, create, revoke)
- Views (list, get, create, update, delete)
- Import (CSV import)
- Notifications (list, mark read)
- Activity (list)
- Tags (list, create, delete)
- Relationships (list, create, delete)
- Analytics (dashboard, reports)

Each endpoint includes the HTTP method, path, example request body, and example response. Your agent reads these to understand exactly what it can do.

### Panel 4: Dynamic System Prompt

The wizard generates a system prompt section that describes your specific workspace: what objects you have (People, Companies, Deals, plus any custom objects), what attributes exist on each, and what status/select values are valid. This means your agent understands your schema out of the box.

Click **"Generate Skill File"** and the wizard produces a complete `SKILL.md` file. Click **"Copy to Clipboard"** or **"Download"**.

## Step 4: Drop It Into Your Agent Config

Create the skill directory if it does not already exist, then save the file:

```bash
mkdir -p ~/.openclaw/skills/openclaw
```

Paste or move the downloaded file into the directory:

```bash
# If you copied to clipboard:
pbpaste > ~/.openclaw/skills/openclaw/SKILL.md

# Or if you downloaded the file:
mv ~/Downloads/SKILL.md ~/.openclaw/skills/openclaw/SKILL.md
```

## Step 5: Add the Config Snippet

Open your `openclaw.json` configuration file and add the CRM skill reference. If you already have other skills configured, add this to the `skills` array:

```json
{
  "skills": [
    {
      "name": "openclaw-crm",
      "path": "~/.openclaw/skills/openclaw/SKILL.md",
      "description": "Manage CRM data: contacts, companies, deals, tasks, notes, and more.",
      "enabled": true
    }
  ]
}
```

If you already have other skills configured (such as Slack, Discord, or email), add the new entry alongside them in the same `skills` array. Save the file.

## Step 6: Restart Your Agent

Your OpenClaw Bot picks up new skills on restart. Stop the agent and start it again:

```bash
openclaw stop
openclaw start
```

Or if you are running in development mode:

```bash
# Ctrl+C to stop, then:
openclaw dev
```

On startup, you should see a log line confirming the skill was loaded:

```
[info] Loaded skill: openclaw-crm (19 endpoint categories)
```

If you see an error instead, double-check that the file path in `openclaw.json` matches the actual location of your `SKILL.md` file.

## Step 7: Test It

Time to verify everything works. Open a conversation with your OpenClaw Bot (in your terminal, chat interface, or wherever you normally talk to it) and ask:

```
List all objects in the CRM.
```

Your agent should respond with something like:

```
Here are the object types in your CRM:

1. People (slug: "people") - 12 attributes
2. Companies (slug: "companies") - 9 attributes
3. Deals (slug: "deals") - 11 attributes

You have 3 object types configured.
```

If you see People, Companies, and Deals (plus any custom objects you have created), the connection is working.

### A Few More Test Commands

Try these to confirm the full range of operations:

**Search:**
```
Search for all companies with "tech" in the name.
```

**Create:**
```
Create a new company called "Acme Corp" with domain "acme.com".
```

**Update:**
```
Update the Acme Corp deal stage to "Qualified".
```

**Tasks:**
```
Create a task to follow up with Acme Corp next Monday.
```

**Notes:**
```
Add a note to Acme Corp: "Initial call went well, scheduling demo for Friday."
```

Your agent handles each of these through the REST API, using the authentication and endpoint details from the skill file.

## Troubleshooting

**401 Unauthorized:** Your API key is missing, expired, or incorrect. Verify it in **Settings > API Keys**. Generate a new one if needed, then regenerate the skill file.

**Agent ignores CRM commands:** Confirm the skill is in `openclaw.json` with `"enabled": true` and restart the agent. Check startup logs for the loaded skill confirmation.

**Connection refused:** Your CRM is not reachable from where the agent runs. Verify the base URL in the skill file. For local dev, use `http://localhost:3001`. For remote servers, check that the port is open.

**Stale schema:** If you add custom objects or attributes after generating the skill file, regenerate it from **Settings > OpenClaw**, replace the old file, and restart.

## What to Try Next

Once your OpenClaw Bot is connected to the CRM, here are some things worth exploring:

1. **"Summarize all deals closing this month and their total value."** Your agent queries the deals pipeline, filters by close date, and gives you a summary without opening the CRM.

2. **"Every time I mention a new contact in Slack, create them in the CRM."** If your agent is also connected to tools like Slack or Discord, you can set up cross-tool workflows where a message in one place triggers a CRM action.

3. **"What tasks are overdue? Prioritize them by deal value."** Combine task management with deal data to get prioritized action items.

4. **"Find all people at companies in the 'Qualified' stage and export their emails."** Your agent can search across objects, filter by status values, and compile results into whatever format you need.

The real power is not any single command. It is your agent working across all your tools at once, with the CRM as one of them. Your contacts, deals, tasks, and notes are now part of every conversation you have with your agent.

---

> [OpenClaw CRM on GitHub](https://github.com/openclaw-crm/openclaw-crm)
> [OpenClaw Bot Documentation](https://docs.openclaw.dev/bot)
> [Full API Reference](https://github.com/openclaw-crm/openclaw-crm/blob/main/docs/api-reference.md)

---

**Related:**
- [Two Ways AI Works in OpenClaw CRM: Built-in Assistant and Agent Integration](/blog/how-we-built-ai-into-crm)
- [Why Self-Hosting Your CRM Matters When You Run an AI Agent](/blog/why-self-hosted-crm)
- [CRM for Freelancers: Let Your AI Agent Handle the Busywork](/blog/crm-for-freelancers)
