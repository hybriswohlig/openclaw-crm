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
    description:
      "List tasks. With no filters this returns the open, top-level tasks of the workspace. kind splits the two halves of the work model: 'projekt' tasks belong to a project, 'operativ' tasks are day-to-day work tagged with an area. Narrow further with projectId, phaseId, area ('angebot','auftrag','nachsorge','schaden','personal','fahrzeuge','beschaffung','buchhaltung','kunde','sonstiges'), status ('geplant','in_arbeit','erledigt'), overdue, dueWithinDays, or sprintId — 'active' for the running sprint, 'none' for the backlog, or a concrete sprint id. Subtasks are hidden by default; pass includeSubtasks true when you need every row, for example to count a project's real progress.",
    inputSchema: {
      type: "object",
      properties: {
        showCompleted: { type: "boolean", description: "Default false" },
        kind: { type: "string", enum: ["projekt", "operativ"] },
        projectId: { type: "string" },
        phaseId: { type: "string" },
        area: { type: "string", description: "OPERATIVE_AREAS value" },
        status: {
          type: "string",
          enum: ["geplant", "in_arbeit", "erledigt"],
        },
        sprintId: {
          type: "string",
          description: "Sprint id, 'active' or 'none'",
        },
        overdue: { type: "boolean" },
        dueWithinDays: { type: "number" },
        includeSubtasks: { type: "boolean", description: "Default false" },
        ...pagination,
      },
    },
  },
  {
    name: "crm_create_task",
    description:
      "Create a task. content is the title. Passing projectId makes it a project task — kind is forced to 'projekt' server-side, so you never need to send both. Leaving projectId out makes it operative work, and then area should be one of 'angebot','auftrag','nachsorge','schaden','personal','fahrzeuge','beschaffung','buchhaltung','kunde','sonstiges' or the task lands untagged in the operative list. phaseId must belong to projectId or the call is rejected. status is 'geplant','in_arbeit' or 'erledigt' and is kept in sync with the completion flag. priority is 'sehr_hoch','hoch','mittel' or 'niedrig'. recordIds links the task to CRM records, assigneeIds to workspace users. For a child of an existing task prefer crm_create_subtask, which inherits the parent's project and phase.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string" },
        description: { type: "string" },
        deadline: { type: "string", description: "ISO date/datetime" },
        startDate: { type: "string", description: "ISO YYYY-MM-DD" },
        priority: {
          type: "string",
          enum: ["sehr_hoch", "hoch", "mittel", "niedrig"],
        },
        status: {
          type: "string",
          enum: ["geplant", "in_arbeit", "erledigt"],
        },
        kind: { type: "string", enum: ["projekt", "operativ"] },
        projectId: { type: "string" },
        phaseId: { type: "string" },
        area: { type: "string", description: "OPERATIVE_AREAS value" },
        sprintId: { type: "string" },
        parentTaskId: { type: "string" },
        recordIds: { type: "array", items: { type: "string" } },
        assigneeIds: { type: "array", items: { type: "string" } },
      },
      required: ["content"],
    },
  },
  {
    name: "crm_update_task",
    description:
      "Update a task. PATCH semantics — only the fields you pass change. status and isCompleted are two views of one thing and are always written together: status 'erledigt' completes the task and stamps completedAt, isCompleted false reopens it as 'in_arbeit'. Setting projectId switches the task to kind 'projekt'; clearing it with null makes it operative and drops phaseId, so pass an area in the same call. A phaseId must belong to the task's project. Subtasks follow their parent automatically. assigneeIds and recordIds REPLACE the whole set — read the task first and send the merged list, or you will silently unassign people.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        content: { type: "string" },
        description: { type: "string" },
        isCompleted: { type: "boolean" },
        deadline: { type: "string", description: "ISO date/datetime" },
        startDate: { type: "string", description: "ISO YYYY-MM-DD" },
        priority: {
          type: "string",
          enum: ["sehr_hoch", "hoch", "mittel", "niedrig"],
        },
        status: {
          type: "string",
          enum: ["geplant", "in_arbeit", "erledigt"],
        },
        kind: { type: "string", enum: ["projekt", "operativ"] },
        projectId: { type: "string" },
        phaseId: { type: "string" },
        area: { type: "string", description: "OPERATIVE_AREAS value" },
        sprintId: { type: "string" },
        parentTaskId: { type: "string" },
        recordIds: { type: "array", items: { type: "string" } },
        assigneeIds: { type: "array", items: { type: "string" } },
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
    name: "crm_list_deal_attachments",
    description:
      "METADATA ONLY for the inbox attachments on a deal (customer-sent apartment photos etc.): id, fileName, mimeType, fileSize, createdAt, conversationId, messageId. It never returns file bytes — call crm_get_attachment for those, and do NOT try crm_api on /api/v1/inbox/attachments/{id}/content, which streams raw binary.",
    inputSchema: {
      type: "object",
      properties: { recordId: { type: "string" } },
      required: ["recordId"],
    },
  },
  {
    name: "crm_get_attachment",
    description:
      "Fetch ONE inbox attachment WITH its bytes, as JSON: { id, fileName, mimeType, fileSize, contentBase64, isImage, … }. This is how you look at a customer photo — decode contentBase64. Pass recordId to assert the attachment belongs to that deal. Auth required; another workspace's id is a 404. Files over 3 MB return 413 ATTACHMENT_TOO_LARGE — stream those from /api/v1/inbox/attachments/{id}/content instead.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Attachment UUID" },
        recordId: {
          type: "string",
          description: "Optional deal record id the attachment must belong to",
        },
      },
      required: ["id"],
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
  {
    name: "crm_create_agent_draft",
    description:
      "Create a PENDING agent draft for human approval (never sends). Pass conversationId for replies; dealRecordId suffices for first_contact. One live pending draft per (deal, messageClass) — a 409 'draft_exists' returns the existingDraftId. Drafts expire after 72h. source: 'grok-bot' (hosted) or 'grok-vps'.",
    inputSchema: {
      type: "object",
      properties: {
        conversationId: { type: "string" },
        dealRecordId: { type: "string" },
        messageClass: {
          type: "string",
          enum: ["reply", "slot_question", "ack", "followup", "first_contact", "handoff_ack"],
        },
        draftText: { type: "string" },
        reasoning: { type: "string" },
        mode: { type: "string" },
        source: { type: "string" },
        modelTag: { type: "string" },
        idempotencyKey: { type: "string" },
        expiresInHours: { type: "number" },
      },
      required: ["messageClass", "draftText"],
    },
  },

  // ── Projekte ──────────────────────────────────────────────────────
  {
    name: "crm_list_projects",
    description:
      "List projects with their aggregated stats block (task counts, progress percentage, budget planned vs spent, open risks by severity). Filter with status ('geplant'|'aktiv'|'pausiert'|'abgeschlossen'|'abgebrochen'), category (a PROJECT_CATEGORIES value such as 'vertrieb', 'fuhrpark' or 'software'), sprintId, or favoritesOnly to get just the caller's pinned projects. Archived projects are hidden unless includeArchived is true. This is the entry point for every project question — read it before guessing a project id.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["geplant", "aktiv", "pausiert", "abgeschlossen", "abgebrochen"],
        },
        category: { type: "string", description: "PROJECT_CATEGORIES value" },
        sprintId: { type: "string" },
        favoritesOnly: { type: "boolean" },
        includeArchived: { type: "boolean" },
        ...pagination,
      },
    },
  },
  {
    name: "crm_get_project",
    description:
      "Get one project in full: scope in/out, problem statement, goal statement, success criteria, owner, members with their roles, planned budget and the same stats block crm_list_projects returns. Use crm_project_overview when you only need the KPI numbers, and crm_list_project_phases / crm_list_project_milestones for the plan itself — they are not inlined here.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
  {
    name: "crm_create_project",
    description:
      "Create a project. Only name is required; everything else can be filled in later with crm_update_project. category must be one of 'leistung','vertrieb','marketing','personal','fuhrpark','standorte','gruendung','prozesse','partner','preise','qualitaet','software','finanzen' — an unknown value is rejected. priority is 'sehr_hoch','hoch','mittel' or 'niedrig'. status defaults to 'geplant'. budgetPlannedCents is integer euro cents (12.500,00 EUR is 1250000), never a float and never a formatted string. startDate and endDate are ISO 'YYYY-MM-DD'. icon and color default from the category when omitted. memberUserIds are workspace user ids from crm_list_members; each is added as a project member with role 'mitglied' — call crm_update_project_member afterwards to give one of them a different role. To draft a whole plan first, call crm_generate_project_plan and create its phases and milestones afterwards.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        shortDescription: { type: "string" },
        category: { type: "string", description: "PROJECT_CATEGORIES value" },
        priority: {
          type: "string",
          enum: ["sehr_hoch", "hoch", "mittel", "niedrig"],
        },
        status: {
          type: "string",
          enum: ["geplant", "aktiv", "pausiert", "abgeschlossen", "abgebrochen"],
        },
        icon: { type: "string", description: "lucide-react icon name" },
        color: { type: "string", description: "Hex colour, e.g. #3b82f6" },
        startDate: { type: "string", description: "ISO YYYY-MM-DD" },
        endDate: { type: "string", description: "ISO YYYY-MM-DD" },
        ownerUserId: { type: "string" },
        problemStatement: { type: "string" },
        goalStatement: { type: "string" },
        successCriteria: { type: "string" },
        scopeIn: { type: "array", items: { type: "string" } },
        scopeOut: { type: "array", items: { type: "string" } },
        budgetPlannedCents: { type: "number", description: "Integer euro cents" },
        memberUserIds: { type: "array", items: { type: "string" } },
      },
      required: ["name"],
    },
  },
  {
    name: "crm_update_project",
    description:
      "Update a project. PATCH semantics — only the fields you pass change, everything else keeps its value; pass null to clear a nullable field. Setting status to 'abgeschlossen' or 'abgebrochen' emits a status-changed activity event and notifies every workspace member, so it is not a scratch value. scopeIn and scopeOut replace the whole list, they do not append. notesContent is the TipTap JSON document behind the project's Notizen tab and replaces the stored document wholesale — read crm_get_project first if you mean to extend it.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        name: { type: "string" },
        shortDescription: { type: "string" },
        category: { type: "string", description: "PROJECT_CATEGORIES value" },
        priority: {
          type: "string",
          enum: ["sehr_hoch", "hoch", "mittel", "niedrig"],
        },
        status: {
          type: "string",
          enum: ["geplant", "aktiv", "pausiert", "abgeschlossen", "abgebrochen"],
        },
        icon: { type: "string" },
        color: { type: "string" },
        startDate: { type: "string", description: "ISO YYYY-MM-DD" },
        endDate: { type: "string", description: "ISO YYYY-MM-DD" },
        ownerUserId: { type: "string" },
        problemStatement: { type: "string" },
        goalStatement: { type: "string" },
        successCriteria: { type: "string" },
        scopeIn: { type: "array", items: { type: "string" } },
        scopeOut: { type: "array", items: { type: "string" } },
        budgetPlannedCents: { type: "number", description: "Integer euro cents" },
        notesContent: { description: "TipTap JSON document for the Notizen tab" },
        archivedAt: { type: "string", description: "ISO timestamp or null" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "crm_delete_project",
    description:
      "Delete a project permanently. Its phases, milestones, members, risks, budget entries and documents cascade away with it. Tasks that belonged to the project survive: they fall back to kind 'operativ' with no project and no phase. There is no undo and no trash — when a project merely stopped, prefer crm_update_project with status 'abgebrochen'.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
  {
    name: "crm_project_overview",
    description:
      "KPI bundle for one project: progress percentage, task and phase counts, overdue tasks, the next milestone, budget planned vs spent with its percentage, and open risks grouped by severity. Cheaper than crm_get_project when all you need are the numbers for a status report.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
  {
    name: "crm_set_project_favorite",
    description:
      "Pin or unpin a project for the calling user. favorite true pins it, false unpins it. Favourites are per user, not per workspace, and are what the favoritesOnly filter of crm_list_projects reads — pinning does not change the project itself and notifies nobody.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        favorite: { type: "boolean" },
      },
      required: ["projectId", "favorite"],
    },
  },

  // ── Phasen ────────────────────────────────────────────────────────
  {
    name: "crm_list_project_phases",
    description:
      "List a project's phases ('Arbeitsbereiche') in board order, each with its own task count, done count, progress percentage and the users assigned to its tasks. Phases are the second level of the plan: a task may hang directly off the project or off one of its phases, never off a phase of a different project.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
  {
    name: "crm_create_project_phase",
    description:
      "Add a phase to a project. It is appended at the end of the current order — use crm_reorder_project_phases to move it. status is 'geplant', 'in_arbeit' or 'abgeschlossen' and defaults to 'geplant'. startDate and dueDate are ISO 'YYYY-MM-DD'; they drive the timeline display and are not validated against the project's own dates, so a phase may legitimately run past its project's end.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        startDate: { type: "string", description: "ISO YYYY-MM-DD" },
        dueDate: { type: "string", description: "ISO YYYY-MM-DD" },
        status: {
          type: "string",
          enum: ["geplant", "in_arbeit", "abgeschlossen"],
        },
      },
      required: ["projectId", "name"],
    },
  },
  {
    name: "crm_update_project_phase",
    description:
      "Update one phase. PATCH semantics — omitted fields keep their value, null clears a nullable one. Setting status to 'abgeschlossen' emits a phase-completed activity event but does NOT complete the phase's tasks; close those with crm_update_task, or the project's progress percentage and the phase badge will disagree.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        phaseId: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        startDate: { type: "string", description: "ISO YYYY-MM-DD" },
        dueDate: { type: "string", description: "ISO YYYY-MM-DD" },
        status: {
          type: "string",
          enum: ["geplant", "in_arbeit", "abgeschlossen"],
        },
      },
      required: ["projectId", "phaseId"],
    },
  },
  {
    name: "crm_delete_project_phase",
    description:
      "Delete a phase. Its tasks are deliberately NOT deleted: they keep their project and their phaseId becomes null, so nothing disappears from the project's progress count. Move the tasks first with crm_move_task if they belong somewhere else.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        phaseId: { type: "string" },
      },
      required: ["projectId", "phaseId"],
    },
  },
  {
    name: "crm_reorder_project_phases",
    description:
      "Rewrite the display order of a project's phases in one call. orderedPhaseIds must contain every phase id of the project exactly once, in the new order — a partial or padded list is rejected rather than partially applied. Read crm_list_project_phases first and reorder the ids it returns.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        orderedPhaseIds: { type: "array", items: { type: "string" } },
      },
      required: ["projectId", "orderedPhaseIds"],
    },
  },

  // ── Meilensteine ──────────────────────────────────────────────────
  {
    name: "crm_list_project_milestones",
    description:
      "List a project's milestones with due date, status ('geplant'|'erreicht'|'verfehlt'), the phase they are anchored to and the timestamp they were reached. Milestones are dates to hit, not work items — the work itself lives in tasks, so never model a deliverable as a milestone alone.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
  {
    name: "crm_create_project_milestone",
    description:
      "Add a milestone to a project. name and dueDate (ISO 'YYYY-MM-DD') are what makes it useful. phaseId optionally anchors it to one phase and must belong to this project. Leave status at its default 'geplant': flipping a milestone to 'erreicht' notifies every workspace member, which is not what you want while seeding a plan.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        name: { type: "string" },
        dueDate: { type: "string", description: "ISO YYYY-MM-DD" },
        phaseId: { type: "string" },
        status: {
          type: "string",
          enum: ["geplant", "erreicht", "verfehlt"],
        },
      },
      required: ["projectId", "name"],
    },
  },
  {
    name: "crm_update_project_milestone",
    description:
      "Update one milestone. PATCH semantics — omitted fields keep their value, null clears a nullable one. Setting status to 'erreicht' stamps reachedAt and notifies every workspace member. Use 'verfehlt' for a date that passed without the milestone being hit; silently moving dueDate instead destroys the record of what was originally promised.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        milestoneId: { type: "string" },
        name: { type: "string" },
        dueDate: { type: "string", description: "ISO YYYY-MM-DD" },
        phaseId: { type: "string" },
        status: {
          type: "string",
          enum: ["geplant", "erreicht", "verfehlt"],
        },
      },
      required: ["projectId", "milestoneId"],
    },
  },
  {
    name: "crm_delete_project_milestone",
    description:
      "Delete a milestone permanently. Nothing else references it, so this is safe — but when the milestone happened and was missed, prefer crm_update_project_milestone with status 'verfehlt' so the project history stays readable.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        milestoneId: { type: "string" },
      },
      required: ["projectId", "milestoneId"],
    },
  },

  // ── Mitglieder ────────────────────────────────────────────────────
  {
    name: "crm_list_project_members",
    description:
      "List the people on a project with their role ('leiter'|'mitglied'|'beobachter'), name, email and avatar. The role documents who does what — it is NOT access control: every non-employee workspace member can read and change every project regardless of membership.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
  {
    name: "crm_add_project_member",
    description:
      "Put a workspace user on a project. userId is a workspace user id from crm_list_members, not an email and not a CRM record id. role is 'leiter', 'mitglied' or 'beobachter' and defaults to 'mitglied'. The user is notified. Adding someone who is already a member updates their role instead of creating a duplicate row.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        userId: { type: "string" },
        role: {
          type: "string",
          enum: ["leiter", "mitglied", "beobachter"],
        },
      },
      required: ["projectId", "userId"],
    },
  },
  {
    name: "crm_update_project_member",
    description:
      "Change one member's role on a project to 'leiter', 'mitglied' or 'beobachter'. This is display and responsibility information only and grants no extra permissions — do not use it to try to restrict someone's access.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        userId: { type: "string" },
        role: {
          type: "string",
          enum: ["leiter", "mitglied", "beobachter"],
        },
      },
      required: ["projectId", "userId", "role"],
    },
  },
  {
    name: "crm_remove_project_member",
    description:
      "Take a user off a project. Their tasks stay assigned to them — assignment and membership are separate things, so removing a member never orphans work. Removing the last 'leiter' is allowed; the project's ownerUserId is a separate field you set with crm_update_project.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        userId: { type: "string" },
      },
      required: ["projectId", "userId"],
    },
  },

  // ── Risiken ───────────────────────────────────────────────────────
  {
    name: "crm_list_project_risks",
    description:
      "List a project's risks with severity ('niedrig'|'mittel'|'hoch'), likelihood on the same scale, status ('offen'|'beobachtet'|'geschlossen'), the planned mitigation and the owner. The count of open risks by severity also appears in the project's stats block, so this is the detail view behind that number.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
  {
    name: "crm_create_project_risk",
    description:
      "Log a risk on a project. title is required. severity and likelihood are 'niedrig', 'mittel' or 'hoch'. severity defaults to 'mittel' when omitted; likelihood does NOT — an omitted or unrecognised likelihood is left unset (null), never coerced to 'mittel', because an unassessed likelihood is not a medium one. A new risk with severity 'hoch' notifies every workspace member, so reserve it for things that genuinely threaten the project. Put the countermeasure in mitigation rather than burying it in description — the risk board reads that field.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        severity: { type: "string", enum: ["niedrig", "mittel", "hoch"] },
        likelihood: { type: "string", enum: ["niedrig", "mittel", "hoch"] },
        mitigation: { type: "string" },
        ownerUserId: { type: "string" },
      },
      required: ["projectId", "title"],
    },
  },
  {
    name: "crm_update_project_risk",
    description:
      "Update one risk. PATCH semantics — omitted fields keep their value, null clears a nullable one. Set status to 'geschlossen' once the risk no longer applies: that drops it out of the project's open-risk count and emits a risk-closed event. 'beobachtet' keeps it visible but no longer urgent.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        riskId: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        severity: { type: "string", enum: ["niedrig", "mittel", "hoch"] },
        likelihood: { type: "string", enum: ["niedrig", "mittel", "hoch"] },
        status: {
          type: "string",
          enum: ["offen", "beobachtet", "geschlossen"],
        },
        mitigation: { type: "string" },
        ownerUserId: { type: "string" },
      },
      required: ["projectId", "riskId"],
    },
  },
  {
    name: "crm_delete_project_risk",
    description:
      "Delete a risk permanently. Prefer crm_update_project_risk with status 'geschlossen' so the project keeps the record of what was considered and why it stopped mattering — a deleted risk looks like a risk nobody ever thought about.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        riskId: { type: "string" },
      },
      required: ["projectId", "riskId"],
    },
  },

  // ── Budget ────────────────────────────────────────────────────────
  {
    name: "crm_get_project_budget",
    description:
      "Budget of one project: the planned total, the sum of the 'plan' entries, the actual spend, the resulting percentage and every entry. All amounts are integer euro cents. plannedCents is the single number set on the project itself; plannedBreakdownCents is the sum of the individual plan lines and may legitimately differ from it — do not treat a mismatch as an error.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
  {
    name: "crm_create_project_budget_entry",
    description:
      "Add one budget line to a project. kind 'plan' is a budgeted item, kind 'ist' is money actually spent — only 'ist' entries move the spend figure and the budget percentage. amountCents is integer euro cents (2.500,00 EUR is 250000): never a float, never a string with a comma, never euros. bookedAt is the ISO 'YYYY-MM-DD' the amount applies to, not the day you enter it.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        label: { type: "string" },
        amountCents: { type: "number", description: "Integer euro cents" },
        kind: { type: "string", enum: ["plan", "ist"] },
        bookedAt: { type: "string", description: "ISO YYYY-MM-DD" },
        note: { type: "string" },
      },
      required: ["projectId", "label", "amountCents", "kind"],
    },
  },
  {
    name: "crm_update_project_budget_entry",
    description:
      "Update one budget entry. PATCH semantics — omitted fields keep their value, null clears a nullable one. Switching kind between 'plan' and 'ist' immediately changes the project's spend figure and its budget percentage, so do it deliberately rather than to tidy up a label.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        entryId: { type: "string" },
        label: { type: "string" },
        amountCents: { type: "number", description: "Integer euro cents" },
        kind: { type: "string", enum: ["plan", "ist"] },
        bookedAt: { type: "string", description: "ISO YYYY-MM-DD" },
        note: { type: "string" },
      },
      required: ["projectId", "entryId"],
    },
  },
  {
    name: "crm_delete_project_budget_entry",
    description:
      "Delete one budget entry permanently. The project's own planned total (budgetPlannedCents, set with crm_update_project) is a separate field and is not touched — deleting every plan line does not zero the budget.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        entryId: { type: "string" },
      },
      required: ["projectId", "entryId"],
    },
  },

  // ── Projektdokumente ──────────────────────────────────────────────
  {
    name: "crm_list_project_documents",
    description:
      "METADATA ONLY for the files attached to a project: id, fileName, fileSize, mimeType, uploader and upload time. It never returns bytes. Call crm_get_project_document with one of the ids to get the content. For customer photos from the inbox use crm_get_attachment instead — these are project files, not deal attachments.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
  {
    name: "crm_get_project_document",
    description:
      "Fetch one project document including its base64 content. Files are capped at 10 MB on upload, so anything stored here can be inlined. Uploading is deliberately not an MCP tool: the upload route takes multipart/form-data, which this client cannot build — use crm_api if an agent truly has to create one.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        documentId: { type: "string" },
      },
      required: ["projectId", "documentId"],
    },
  },
  {
    name: "crm_delete_project_document",
    description:
      "Delete one project document permanently, bytes and all. There is no trash and no undo, and the file is not recoverable from anywhere else — confirm with the user before calling this.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        documentId: { type: "string" },
      },
      required: ["projectId", "documentId"],
    },
  },

  // ── Abhängigkeiten ────────────────────────────────────────────────
  {
    name: "crm_list_task_dependencies",
    description:
      "List the dependency edges attached to one task — both the tasks it waits for and the tasks waiting on it. Each edge carries its own id, which is what crm_remove_task_dependency needs. For the whole dependency graph of a sprint in one call use crm_sprint_timeline instead of walking task by task.",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
    },
  },
  {
    name: "crm_add_task_dependency",
    description:
      "Make one task wait for another: predecessorTaskId must be finished before successorTaskId can start. Read the direction carefully — swapping the two inverts every arrow on the sprint timeline. Both tasks must be in this workspace. A self-link, a duplicate edge, or an edge that would close a cycle is rejected with a German error message rather than created; read the message instead of retrying.",
    inputSchema: {
      type: "object",
      properties: {
        predecessorTaskId: {
          type: "string",
          description: "The task that must finish first",
        },
        successorTaskId: {
          type: "string",
          description: "The task that waits",
        },
      },
      required: ["predecessorTaskId", "successorTaskId"],
    },
  },
  {
    name: "crm_remove_task_dependency",
    description:
      "Remove one dependency edge. dependencyId comes from crm_list_task_dependencies or crm_sprint_timeline; taskId is the task the edge is listed under (either end works). Neither task is otherwise changed — no dates move, no status changes.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        dependencyId: { type: "string" },
      },
      required: ["taskId", "dependencyId"],
    },
  },

  // ── Sprints ───────────────────────────────────────────────────────
  {
    name: "crm_list_sprints",
    description:
      "List every sprint of the workspace, newest first, with state ('planung'|'aktiv'|'abgeschlossen'), start and end date, the day counters and live metrics. The metrics are TASK COUNTS, not story points: totalTasks, doneTasks, openTasks, progressPct. At most one sprint is 'aktiv' at a time — that is the one the work dashboard and the timeline default to.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "crm_get_sprint",
    description:
      "Get one sprint with its live metrics and day counters (daysTotal, daysElapsed, daysRemaining). A closed sprint returns the counts frozen at close time rather than recomputing them, so historical sprints stay stable.",
    inputSchema: {
      type: "object",
      properties: { sprintId: { type: "string" } },
      required: ["sprintId"],
    },
  },
  {
    name: "crm_create_sprint",
    description:
      "Create a sprint. It starts in state 'planung' — creating it does not start it, call crm_activate_sprint for that. name is required; startDate and endDate are ISO 'YYYY-MM-DD'. capacityPoints is the planned number of TASKS for the sprint (the column kept its old points name after the switch to count-based sprints); leave it out when you do not have a number.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        goal: { type: "string" },
        startDate: { type: "string", description: "ISO YYYY-MM-DD" },
        endDate: { type: "string", description: "ISO YYYY-MM-DD" },
        capacityPoints: {
          type: "number",
          description: "Planned number of tasks for the sprint",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "crm_update_sprint",
    description:
      "Edit a sprint's name, goal, dates or planned task count. PATCH semantics — omitted fields keep their value. This tool never starts or closes a sprint: use crm_activate_sprint and crm_close_sprint, which are separate on purpose so a typo cannot fall through to a plain edit.",
    inputSchema: {
      type: "object",
      properties: {
        sprintId: { type: "string" },
        name: { type: "string" },
        goal: { type: "string" },
        startDate: { type: "string", description: "ISO YYYY-MM-DD" },
        endDate: { type: "string", description: "ISO YYYY-MM-DD" },
        capacityPoints: {
          type: "number",
          description: "Planned number of tasks for the sprint",
        },
      },
      required: ["sprintId"],
    },
  },
  {
    name: "crm_activate_sprint",
    description:
      "Start a sprint. Only one sprint can be 'aktiv' at a time: if another one is still running the call is rejected with a German message telling you to close it first — do not retry, close the running sprint or pick a different one. An active sprint is what crm_work_dashboard and crm_sprint_timeline default to.",
    inputSchema: {
      type: "object",
      properties: { sprintId: { type: "string" } },
      required: ["sprintId"],
    },
  },
  {
    name: "crm_close_sprint",
    description:
      "Close a sprint and carry its unfinished tasks over. The sprint's committed and completed task counts are frozen at this moment and its metrics stop moving, so this is not reversible by reactivating it. Returns the sprint plus a summary of what was carried. Ask the user before closing — this ends a planning period for the whole team.",
    inputSchema: {
      type: "object",
      properties: { sprintId: { type: "string" } },
      required: ["sprintId"],
    },
  },
  {
    name: "crm_delete_sprint",
    description:
      "Delete a sprint. Only sprints still in state 'planung' can be deleted; a running or closed sprint is refused with a German message telling you to close it instead. Tasks assigned to a deleted sprint fall back to the backlog, they are not deleted.",
    inputSchema: {
      type: "object",
      properties: { sprintId: { type: "string" } },
      required: ["sprintId"],
    },
  },

  // ── Aufgabe verschieben ───────────────────────────────────────────
  {
    name: "crm_move_task",
    description:
      "Move a task between projects, phases and the operative list in one call. projectId null takes it out of every project: it becomes kind 'operativ' and its phaseId is cleared, so pass an area in the same call or it lands untagged. A phaseId must belong to the target project or the move is rejected. Subtasks are moved along with their parent. Use crm_update_task when you want to change content or dates as well — this tool only moves.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        projectId: {
          type: "string",
          description: "Target project id, or null to make the task operative",
        },
        phaseId: { type: "string", description: "Phase of the target project" },
        area: { type: "string", description: "OPERATIVE_AREAS value" },
      },
      required: ["taskId"],
    },
  },

  // ── Unteraufgaben und Kommentare ──────────────────────────────────
  {
    name: "crm_list_subtasks",
    description:
      "List the children of a task, enriched like full tasks (assignees, deadline, status, priority). Subtasks are hidden from crm_list_tasks unless includeSubtasks is set, so this is the direct way to see them. They inherit kind, projectId and phaseId from their parent and always live in the same project.",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
    },
  },
  {
    name: "crm_create_subtask",
    description:
      "Add a subtask under a parent task. It inherits the parent's kind, project and phase automatically — do not try to set those here; if the child belongs elsewhere it is not a subtask, create it with crm_create_task instead. Without a deadline it inherits the parent's, so an overdue parent does not hide fresh-looking children.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Parent task id" },
        content: { type: "string" },
        deadline: { type: "string", description: "ISO date/datetime" },
        assigneeIds: { type: "array", items: { type: "string" } },
      },
      required: ["taskId", "content"],
    },
  },
  {
    name: "crm_list_task_comments",
    description:
      "List the comments on a task, oldest first, with author and timestamp. Comments are the discussion thread; the task's own description field is the brief. Read this before answering 'what is the status of X' — the last comment is usually the answer.",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
    },
  },
  {
    name: "crm_create_task_comment",
    description:
      "Add a comment to a task. body is plain text. Posting is not silent: the task's audience (assignees plus creator, minus you) gets a push notification, and an @-mention of a workspace member pushes them separately. Do not use comments as a scratchpad or a progress log for yourself — put durable information in the task description instead.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        body: { type: "string", description: "Comment text" },
      },
      required: ["taskId", "body"],
    },
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
