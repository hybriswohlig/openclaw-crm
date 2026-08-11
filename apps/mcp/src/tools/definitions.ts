/**
 * MCP tool definitions for the OpenClaw / Kottke CRM.
 * Each tool maps to one or more REST endpoints under /api/v1.
 */

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

const pagination = {
  limit: {
    type: "number",
    description: "Page size (default 50, max usually 200)",
  },
  offset: {
    type: "number",
    description: "Pagination offset (default 0)",
  },
};

export const TOOLS: ToolDef[] = [
  // ── Auth ──────────────────────────────────────────────────────────
  {
    name: "crm_login",
    description:
      "Log in to the CRM with email and password (better-auth). Stores a session cookie for this MCP process. Prefer CRM_API_KEY for unattended use.",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "CRM staff email" },
        password: { type: "string", description: "Account password" },
      },
      required: ["email", "password"],
    },
  },
  {
    name: "crm_logout",
    description: "Clear the stored session cookie from this MCP process.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "crm_status",
    description:
      "Show connection status: base URL, auth mode, and whether credentials are present (never returns secrets).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "crm_whoami",
    description: "Return the current workspace context (GET /api/v1/workspace).",
    inputSchema: { type: "object", properties: {} },
  },

  // ── Search ────────────────────────────────────────────────────────
  {
    name: "crm_search",
    description:
      "Global full-text search across people, companies, deals and other records (GET /api/v1/search).",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max results (default 20, max 50)" },
      },
      required: ["q"],
    },
  },
  {
    name: "crm_browse_records",
    description: "Browse recent records (GET /api/v1/records/browse).",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max results (default 20)" },
      },
    },
  },

  // ── Objects & schema ──────────────────────────────────────────────
  {
    name: "crm_list_objects",
    description:
      "List all CRM object types (people, companies, deals, …) with their schema metadata.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "crm_get_object",
    description: "Get one object type including its attributes (fields).",
    inputSchema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: "Object slug, e.g. people, companies, deals",
        },
      },
      required: ["slug"],
    },
  },
  {
    name: "crm_list_attributes",
    description: "List attributes (fields) for an object type.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Object slug" },
      },
      required: ["slug"],
    },
  },

  // ── Records ───────────────────────────────────────────────────────
  {
    name: "crm_list_records",
    description:
      "List records for an object type (paginated). Use crm_query_records for filters.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Object slug (people, deals, …)" },
        ...pagination,
      },
      required: ["slug"],
    },
  },
  {
    name: "crm_get_record",
    description: "Get a single record by ID with all attribute values.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Object slug" },
        recordId: { type: "string", description: "Record UUID" },
      },
      required: ["slug", "recordId"],
    },
  },
  {
    name: "crm_create_record",
    description:
      "Create a record. values is a map of attribute slug → value (formats per attribute type).",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        values: {
          type: "object",
          description: "Attribute values, e.g. { name: { first_name, last_name }, email_addresses: \"a@b.com\" }",
          additionalProperties: true,
        },
      },
      required: ["slug", "values"],
    },
  },
  {
    name: "crm_update_record",
    description: "Patch record attribute values.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        recordId: { type: "string" },
        values: { type: "object", additionalProperties: true },
      },
      required: ["slug", "recordId", "values"],
    },
  },
  {
    name: "crm_delete_record",
    description: "Delete a record permanently.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        recordId: { type: "string" },
      },
      required: ["slug", "recordId"],
    },
  },
  {
    name: "crm_query_records",
    description:
      "Filter and sort records. filter: { operator: and|or, conditions: [{ attribute, operator, value }] }. operators: equals, not_equals, contains, starts_with, ends_with, is_empty, is_not_empty, gt, gte, lt, lte. mode assert: find-or-create.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        filter: { type: "object", additionalProperties: true },
        sorts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              attribute: { type: "string" },
              direction: { type: "string", enum: ["asc", "desc"] },
            },
          },
        },
        limit: { type: "number" },
        offset: { type: "number" },
        mode: { type: "string", enum: ["query", "assert"], description: "assert = find-or-create" },
        matchAttribute: { type: "string", description: "For assert mode" },
        matchValue: { description: "For assert mode" },
        values: {
          type: "object",
          description: "For assert mode: values to set/create",
          additionalProperties: true,
        },
      },
      required: ["slug"],
    },
  },
  {
    name: "crm_get_record_related",
    description: "Related records (forward + inverse references).",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        recordId: { type: "string" },
      },
      required: ["slug", "recordId"],
    },
  },
  {
    name: "crm_get_record_activity",
    description: "Activity feed for a record.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        recordId: { type: "string" },
      },
      required: ["slug", "recordId"],
    },
  },

  // ── Tasks ─────────────────────────────────────────────────────────
  {
    name: "crm_list_tasks",
    description: "List tasks (optionally hide completed).",
    inputSchema: {
      type: "object",
      properties: {
        showCompleted: { type: "boolean", description: "Default false" },
        ...pagination,
      },
    },
  },
  {
    name: "crm_create_task",
    description: "Create a task.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string" },
        deadline: { type: "string", description: "ISO date/datetime" },
        recordIds: { type: "array", items: { type: "string" } },
        assigneeIds: { type: "array", items: { type: "string" } },
      },
      required: ["content"],
    },
  },
  {
    name: "crm_update_task",
    description: "Update a task (content, completed, deadline).",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        content: { type: "string" },
        isCompleted: { type: "boolean" },
        deadline: { type: "string" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "crm_delete_task",
    description: "Delete a task.",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
    },
  },
  {
    name: "crm_tasks_pulse",
    description: "Task pulse / summary for the dashboard.",
    inputSchema: { type: "object", properties: {} },
  },

  // ── Notes ─────────────────────────────────────────────────────────
  {
    name: "crm_list_notes",
    description: "List all notes (paginated).",
    inputSchema: {
      type: "object",
      properties: { ...pagination },
    },
  },
  {
    name: "crm_create_note",
    description: "Create a note on a record.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Object slug of the parent record" },
        recordId: { type: "string" },
        title: { type: "string" },
        content: { type: "string" },
      },
      required: ["slug", "recordId", "content"],
    },
  },
  {
    name: "crm_update_note",
    description: "Update note title/content.",
    inputSchema: {
      type: "object",
      properties: {
        noteId: { type: "string" },
        title: { type: "string" },
        content: { type: "string" },
      },
      required: ["noteId"],
    },
  },
  {
    name: "crm_delete_note",
    description: "Delete a note.",
    inputSchema: {
      type: "object",
      properties: { noteId: { type: "string" } },
      required: ["noteId"],
    },
  },

  // ── Lists ─────────────────────────────────────────────────────────
  {
    name: "crm_list_lists",
    description: "List all curated lists (boards/collections).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "crm_get_list",
    description: "Get list metadata.",
    inputSchema: {
      type: "object",
      properties: { listId: { type: "string" } },
      required: ["listId"],
    },
  },
  {
    name: "crm_list_entries",
    description: "List entries in a list.",
    inputSchema: {
      type: "object",
      properties: {
        listId: { type: "string" },
        ...pagination,
      },
      required: ["listId"],
    },
  },
  {
    name: "crm_add_list_entry",
    description: "Add a record to a list.",
    inputSchema: {
      type: "object",
      properties: {
        listId: { type: "string" },
        recordId: { type: "string" },
        values: { type: "object", additionalProperties: true },
      },
      required: ["listId", "recordId"],
    },
  },

  // ── Inbox ─────────────────────────────────────────────────────────
  {
    name: "crm_list_conversations",
    description:
      "List inbox conversations (email/WhatsApp). Default status=open, lane=lead.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "resolved", "spam"] },
        lane: { type: "string", enum: ["lead", "info", "spam", "review", "all"] },
        channelType: { type: "string", enum: ["email", "whatsapp"] },
        channelAccountId: { type: "string" },
        operatingCompanyRecordId: { type: "string" },
        q: { type: "string", description: "Free-text search in conversations" },
        limit: { type: "number" },
        excludeLane: {
          type: "string",
          description: "Comma-separated lanes to exclude",
        },
      },
    },
  },
  {
    name: "crm_get_conversation",
    description: "Get one inbox conversation.",
    inputSchema: {
      type: "object",
      properties: { conversationId: { type: "string" } },
      required: ["conversationId"],
    },
  },
  {
    name: "crm_list_messages",
    description: "List messages in a conversation.",
    inputSchema: {
      type: "object",
      properties: {
        conversationId: { type: "string" },
        limit: { type: "number" },
      },
      required: ["conversationId"],
    },
  },
  {
    name: "crm_update_conversation_status",
    description: "Set conversation status (open/resolved/spam).",
    inputSchema: {
      type: "object",
      properties: {
        conversationId: { type: "string" },
        status: { type: "string", enum: ["open", "resolved", "spam"] },
      },
      required: ["conversationId", "status"],
    },
  },
  {
    name: "crm_link_conversation_deal",
    description: "Link an inbox conversation to a deal record.",
    inputSchema: {
      type: "object",
      properties: {
        conversationId: { type: "string" },
        dealRecordId: { type: "string" },
      },
      required: ["conversationId", "dealRecordId"],
    },
  },
  {
    name: "crm_suggest_reply",
    description: "AI suggested reply for a conversation.",
    inputSchema: {
      type: "object",
      properties: { conversationId: { type: "string" } },
      required: ["conversationId"],
    },
  },
  {
    name: "crm_inbox_unread_count",
    description: "Unread conversation count.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "crm_list_channel_accounts",
    description: "List connected inbox channel accounts (email/WhatsApp).",
    inputSchema: { type: "object", properties: {} },
  },

  // ── Deals (domain) ────────────────────────────────────────────────
  {
    name: "crm_get_deal_insights",
    description: "AI/structured insights for a deal record.",
    inputSchema: {
      type: "object",
      properties: { recordId: { type: "string", description: "Deal record UUID" } },
      required: ["recordId"],
    },
  },
  {
    name: "crm_get_deal_lifecycle",
    description: "Deal lifecycle / stage state.",
    inputSchema: {
      type: "object",
      properties: { recordId: { type: "string" } },
      required: ["recordId"],
    },
  },
  {
    name: "crm_get_deal_profit",
    description: "Deal profit breakdown.",
    inputSchema: {
      type: "object",
      properties: { recordId: { type: "string" } },
      required: ["recordId"],
    },
  },
  {
    name: "crm_list_deal_documents",
    description: "Documents attached to a deal (quotes, KVA, invoices).",
    inputSchema: {
      type: "object",
      properties: { recordId: { type: "string" } },
      required: ["recordId"],
    },
  },
  {
    name: "crm_get_deal_quotation",
    description: "Quotation / offer data for a deal.",
    inputSchema: {
      type: "object",
      properties: { recordId: { type: "string" } },
      required: ["recordId"],
    },
  },
  {
    name: "crm_list_deal_payments",
    description: "Payments on a deal.",
    inputSchema: {
      type: "object",
      properties: { recordId: { type: "string" } },
      required: ["recordId"],
    },
  },
  {
    name: "crm_get_customer_link",
    description: "Customer portal link / token info for a deal.",
    inputSchema: {
      type: "object",
      properties: { dealRecordId: { type: "string" } },
      required: ["dealRecordId"],
    },
  },

  // ── Employees & finance ───────────────────────────────────────────
  {
    name: "crm_list_employees",
    description: "List employees.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "crm_get_financial_overview",
    description: "Financial overview dashboard data.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "crm_list_financial_bookings",
    description: "List financial bookings.",
    inputSchema: {
      type: "object",
      properties: { ...pagination },
    },
  },

  // ── Stats ─────────────────────────────────────────────────────────
  {
    name: "crm_stats_overview",
    description: "High-level CRM statistics overview.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "crm_stats_pipeline",
    description: "Pipeline statistics.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "crm_stats_operations",
    description: "Operations statistics.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "crm_stats_team",
    description: "Team statistics.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "crm_operations_board",
    description: "Operations board data (GET /api/v1/operations).",
    inputSchema: { type: "object", properties: {} },
  },

  // ── Workspace ─────────────────────────────────────────────────────
  {
    name: "crm_list_members",
    description: "List workspace members.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "crm_list_notifications",
    description: "List notifications.",
    inputSchema: {
      type: "object",
      properties: {
        unreadOnly: { type: "boolean" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "crm_list_operating_companies",
    description: "List operating companies (multi-brand).",
    inputSchema: { type: "object", properties: {} },
  },

  // ── Agent ─────────────────────────────────────────────────────────
  {
    name: "crm_list_agent_drafts",
    description: "List AI agent drafts awaiting review.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "crm_get_agent_settings",
    description: "Get AI agent settings.",
    inputSchema: { type: "object", properties: {} },
  },

  // ── Escape hatch ──────────────────────────────────────────────────
  {
    name: "crm_api",
    description:
      "Raw authenticated request to any CRM path (escape hatch). path e.g. /api/v1/inbox/sync. Prefer specific tools when available.",
    inputSchema: {
      type: "object",
      properties: {
        method: {
          type: "string",
          enum: ["GET", "POST", "PATCH", "PUT", "DELETE"],
          description: "HTTP method (default GET)",
        },
        path: {
          type: "string",
          description: "Path starting with /api/…",
        },
        query: {
          type: "object",
          additionalProperties: true,
          description: "Query string parameters",
        },
        body: {
          description: "JSON body for POST/PATCH/PUT",
        },
      },
      required: ["path"],
    },
  },
];
