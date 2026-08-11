import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { CrmClient, type McpAuthContext, resolveBaseUrl } from "./client";
import { handleTool } from "./dispatch";

type Extra = { authInfo?: AuthInfo };

function clientFromExtra(extra: Extra, req?: Request): CrmClient {
  const info = extra.authInfo;
  const bag = (info?.extra ?? {}) as Partial<McpAuthContext> & {
    authorizationHeader?: string | null;
  };

  if (!info?.extra || !bag.userId || !bag.workspaceId) {
    throw new Error("Not authenticated. Send Authorization: Bearer oc_sk_…");
  }

  const bearer =
    bag.bearerToken ||
    (typeof bag.authorizationHeader === "string" &&
    bag.authorizationHeader.startsWith("Bearer ")
      ? bag.authorizationHeader.slice(7)
      : undefined) ||
    (info.token && info.token !== "session" ? info.token : undefined);

  return new CrmClient({
    bearerToken: bearer,
    cookie: bag.cookie,
    userId: bag.userId,
    workspaceId: bag.workspaceId,
    workspaceRole: bag.workspaceRole ?? "member",
    baseUrl: bag.baseUrl || resolveBaseUrl(req),
  });
}

function tool(
  server: McpServer,
  name: string,
  description: string,
  shape: z.ZodRawShape,
  req?: Request
) {
  server.tool(name, description, shape, async (args, extra) => {
    const client = clientFromExtra(extra as Extra, req);
    return handleTool(client, name, args as Record<string, unknown>);
  });
}

const empty = {};

/**
 * Register all CRM MCP tools on an McpServer instance.
 * `req` is used only to resolve base URL fallbacks.
 */
export function registerCrmTools(server: McpServer, req?: Request): void {
  tool(server, "crm_status", "Connection/auth status for this MCP request (no secrets).", empty, req);
  tool(server, "crm_whoami", "Current workspace context.", empty, req);

  tool(
    server,
    "crm_search",
    "Global full-text search across CRM records.",
    { q: z.string(), limit: z.number().optional() },
    req
  );
  tool(
    server,
    "crm_browse_records",
    "Browse recent records.",
    { limit: z.number().optional() },
    req
  );

  tool(server, "crm_list_objects", "List all object types (people, companies, deals, …).", empty, req);
  tool(
    server,
    "crm_get_object",
    "Get one object type with attributes.",
    { slug: z.string() },
    req
  );
  tool(
    server,
    "crm_list_attributes",
    "List attributes for an object type.",
    { slug: z.string() },
    req
  );

  tool(
    server,
    "crm_list_records",
    "List records for an object type (paginated).",
    {
      slug: z.string(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
    req
  );
  tool(
    server,
    "crm_get_record",
    "Get a single record by ID.",
    { slug: z.string(), recordId: z.string() },
    req
  );
  tool(
    server,
    "crm_create_record",
    "Create a record. values = map of attribute slug → value.",
    { slug: z.string(), values: z.record(z.unknown()) },
    req
  );
  tool(
    server,
    "crm_update_record",
    "Update record attribute values.",
    {
      slug: z.string(),
      recordId: z.string(),
      values: z.record(z.unknown()),
    },
    req
  );
  tool(
    server,
    "crm_delete_record",
    "Delete a record permanently.",
    { slug: z.string(), recordId: z.string() },
    req
  );
  tool(
    server,
    "crm_query_records",
    "Filter/sort records or assert (find-or-create).",
    {
      slug: z.string(),
      filter: z.record(z.unknown()).optional(),
      sorts: z.array(z.record(z.unknown())).optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
      mode: z.enum(["query", "assert"]).optional(),
      matchAttribute: z.string().optional(),
      matchValue: z.unknown().optional(),
      values: z.record(z.unknown()).optional(),
    },
    req
  );
  tool(
    server,
    "crm_get_record_related",
    "Related records for a record.",
    { slug: z.string(), recordId: z.string() },
    req
  );
  tool(
    server,
    "crm_get_record_activity",
    "Activity feed for a record.",
    { slug: z.string(), recordId: z.string() },
    req
  );

  tool(
    server,
    "crm_list_tasks",
    "List tasks.",
    {
      showCompleted: z.boolean().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
    req
  );
  tool(
    server,
    "crm_create_task",
    "Create a task.",
    {
      content: z.string(),
      deadline: z.string().optional(),
      recordIds: z.array(z.string()).optional(),
      assigneeIds: z.array(z.string()).optional(),
    },
    req
  );
  tool(
    server,
    "crm_update_task",
    "Update a task.",
    {
      taskId: z.string(),
      content: z.string().optional(),
      isCompleted: z.boolean().optional(),
      deadline: z.string().optional(),
    },
    req
  );
  tool(server, "crm_delete_task", "Delete a task.", { taskId: z.string() }, req);
  tool(server, "crm_tasks_pulse", "Task pulse summary.", empty, req);

  tool(
    server,
    "crm_list_notes",
    "List notes.",
    { limit: z.number().optional(), offset: z.number().optional() },
    req
  );
  tool(
    server,
    "crm_create_note",
    "Create a note on a record.",
    {
      slug: z.string(),
      recordId: z.string(),
      title: z.string().optional(),
      content: z.string(),
    },
    req
  );
  tool(
    server,
    "crm_update_note",
    "Update a note.",
    {
      noteId: z.string(),
      title: z.string().optional(),
      content: z.string().optional(),
    },
    req
  );
  tool(server, "crm_delete_note", "Delete a note.", { noteId: z.string() }, req);

  tool(server, "crm_list_lists", "List curated lists.", empty, req);
  tool(server, "crm_get_list", "Get list metadata.", { listId: z.string() }, req);
  tool(
    server,
    "crm_list_entries",
    "List entries in a list.",
    {
      listId: z.string(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
    req
  );
  tool(
    server,
    "crm_add_list_entry",
    "Add a record to a list.",
    {
      listId: z.string(),
      recordId: z.string(),
      values: z.record(z.unknown()).optional(),
    },
    req
  );

  tool(
    server,
    "crm_list_conversations",
    "List inbox conversations (default status=open, lane=lead).",
    {
      status: z.enum(["open", "resolved", "spam"]).optional(),
      lane: z.enum(["lead", "info", "spam", "review", "all"]).optional(),
      channelType: z.enum(["email", "whatsapp"]).optional(),
      channelAccountId: z.string().optional(),
      operatingCompanyRecordId: z.string().optional(),
      q: z.string().optional(),
      limit: z.number().optional(),
      excludeLane: z.string().optional(),
    },
    req
  );
  tool(
    server,
    "crm_get_conversation",
    "Get one conversation.",
    { conversationId: z.string() },
    req
  );
  tool(
    server,
    "crm_list_messages",
    "List messages in a conversation.",
    { conversationId: z.string(), limit: z.number().optional() },
    req
  );
  tool(
    server,
    "crm_update_conversation_status",
    "Set conversation status.",
    {
      conversationId: z.string(),
      status: z.enum(["open", "resolved", "spam"]),
    },
    req
  );
  tool(
    server,
    "crm_link_conversation_deal",
    "Link conversation to a deal.",
    { conversationId: z.string(), dealRecordId: z.string() },
    req
  );
  tool(
    server,
    "crm_suggest_reply",
    "AI suggested reply for a conversation.",
    { conversationId: z.string() },
    req
  );
  tool(server, "crm_inbox_unread_count", "Unread inbox count.", empty, req);
  tool(server, "crm_list_channel_accounts", "Connected channel accounts.", empty, req);

  tool(
    server,
    "crm_get_deal_insights",
    "Deal insights.",
    { recordId: z.string() },
    req
  );
  tool(
    server,
    "crm_get_deal_lifecycle",
    "Deal lifecycle state.",
    { recordId: z.string() },
    req
  );
  tool(server, "crm_get_deal_profit", "Deal profit breakdown.", { recordId: z.string() }, req);
  tool(
    server,
    "crm_list_deal_documents",
    "Deal documents.",
    { recordId: z.string() },
    req
  );
  tool(
    server,
    "crm_get_deal_quotation",
    "Deal quotation data.",
    { recordId: z.string() },
    req
  );
  tool(
    server,
    "crm_list_deal_payments",
    "Deal payments.",
    { recordId: z.string() },
    req
  );
  tool(
    server,
    "crm_get_customer_link",
    "Customer portal link for a deal.",
    { dealRecordId: z.string() },
    req
  );

  tool(server, "crm_list_employees", "List employees.", empty, req);
  tool(server, "crm_get_financial_overview", "Financial overview.", empty, req);
  tool(
    server,
    "crm_list_financial_bookings",
    "Financial bookings.",
    { limit: z.number().optional(), offset: z.number().optional() },
    req
  );

  tool(server, "crm_stats_overview", "CRM statistics overview.", empty, req);
  tool(server, "crm_stats_pipeline", "Pipeline statistics.", empty, req);
  tool(server, "crm_stats_operations", "Operations statistics.", empty, req);
  tool(server, "crm_stats_team", "Team statistics.", empty, req);
  tool(server, "crm_operations_board", "Operations board data.", empty, req);

  tool(server, "crm_list_members", "Workspace members.", empty, req);
  tool(
    server,
    "crm_list_notifications",
    "Notifications.",
    { unreadOnly: z.boolean().optional(), limit: z.number().optional() },
    req
  );
  tool(server, "crm_list_operating_companies", "Operating companies.", empty, req);

  tool(server, "crm_list_agent_drafts", "AI agent drafts.", empty, req);
  tool(server, "crm_get_agent_settings", "AI agent settings.", empty, req);

  tool(
    server,
    "crm_api",
    "Raw authenticated request to any /api/… path (escape hatch).",
    {
      method: z.enum(["GET", "POST", "PATCH", "PUT", "DELETE"]).optional(),
      path: z.string(),
      query: z.record(z.unknown()).optional(),
      body: z.unknown().optional(),
    },
    req
  );
}
