/**
 * The canonical list of CRM MCP tool names.
 *
 * Two registries expose the same tools — the zod one in `register-tools.ts` +
 * `dispatch.ts` (served over HTTP from /api/mcp) and the JSON-Schema one in
 * `apps/mcp/src/tools/*` (stdio). Keeping them in step by hand is risk R4 of
 * the Projekte spec; `tool-names.test.ts` asserts both against this list,
 * and additionally asserts that a shared tool carries the same description
 * and points at the same REST path in both.
 *
 * Adding a tool means: zod shape + dispatch case + JSON-Schema ToolDef +
 * handler case + one entry here, with the description copied verbatim
 * between the two registries. Four of the five without the fifth fails the
 * guard, and the fifth without the other four fails it too.
 */
export const CRM_TOOL_NAMES = [
  // ── Connection ────────────────────────────────────────────────────
  "crm_status",
  "crm_whoami",
  // ── Search ────────────────────────────────────────────────────────
  "crm_search",
  "crm_browse_records",
  // ── Objects & schema ──────────────────────────────────────────────
  "crm_list_objects",
  "crm_get_object",
  "crm_list_attributes",
  // ── Records ───────────────────────────────────────────────────────
  "crm_list_records",
  "crm_get_record",
  "crm_create_record",
  "crm_update_record",
  "crm_delete_record",
  "crm_query_records",
  "crm_get_record_related",
  "crm_get_record_activity",
  // ── Tasks ─────────────────────────────────────────────────────────
  "crm_list_tasks",
  "crm_create_task",
  "crm_update_task",
  "crm_delete_task",
  // ── Notes ─────────────────────────────────────────────────────────
  "crm_list_notes",
  "crm_create_note",
  "crm_update_note",
  "crm_delete_note",
  // ── Lists ─────────────────────────────────────────────────────────
  "crm_list_lists",
  "crm_get_list",
  "crm_list_entries",
  "crm_add_list_entry",
  // ── Inbox ─────────────────────────────────────────────────────────
  "crm_list_conversations",
  "crm_get_conversation",
  "crm_list_messages",
  "crm_update_conversation_status",
  "crm_link_conversation_deal",
  "crm_suggest_reply",
  "crm_inbox_unread_count",
  "crm_list_channel_accounts",
  // ── Deals ─────────────────────────────────────────────────────────
  "crm_get_deal_insights",
  "crm_get_deal_lifecycle",
  "crm_get_deal_profit",
  "crm_list_deal_documents",
  "crm_get_deal_quotation",
  "crm_list_deal_payments",
  "crm_get_customer_link",
  // ── Deal context ──────────────────────────────────────────────────
  "crm_get_deal_auftrag",
  "crm_list_deal_attachments",
  "crm_get_attachment",
  "crm_get_deal_inventory",
  "crm_get_deal_package_options",
  "crm_get_deal_offer_packages",
  "crm_get_deal_date_offers",
  // ── Quotation writes ──────────────────────────────────────────────
  "crm_update_deal_package_options",
  "crm_update_deal_quotation",
  "crm_set_deal_anzahlung",
  // ── Documents ─────────────────────────────────────────────────────
  "crm_get_deal_document",
  "crm_generate_document",
  "crm_get_document_job",
  "crm_store_document_job",
  // ── Employees & finance ───────────────────────────────────────────
  "crm_list_employees",
  "crm_get_financial_overview",
  "crm_list_financial_bookings",
  // ── Statistics ────────────────────────────────────────────────────
  "crm_stats_overview",
  "crm_stats_pipeline",
  "crm_stats_operations",
  "crm_stats_team",
  "crm_operations_board",
  // ── Workspace ─────────────────────────────────────────────────────
  "crm_list_members",
  "crm_list_notifications",
  "crm_list_operating_companies",
  // ── AI agent ──────────────────────────────────────────────────────
  "crm_list_agent_drafts",
  "crm_get_agent_settings",
  "crm_create_agent_draft",
  // ── Projekte ──────────────────────────────────────────────────────
  "crm_list_projects",
  "crm_get_project",
  "crm_create_project",
  "crm_update_project",
  "crm_delete_project",
  "crm_project_overview",
  "crm_set_project_favorite",
  // ── Escape hatch ──────────────────────────────────────────────────
  "crm_api",
] as const;

export type CrmToolName = (typeof CRM_TOOL_NAMES)[number];

/**
 * Tools only the stdio server can implement.
 *
 * The HTTP server is authenticated per request by `/api/mcp/route.ts`, so it
 * has no session of its own to log in or out of. These are transport
 * mechanics, not CRM capabilities.
 */
export const STDIO_ONLY_TOOL_NAMES = ["crm_login", "crm_logout"] as const;

/**
 * FROZEN. Pre-existing drift: deal/document tools that reached the web
 * registry and were never mirrored into the stdio one.
 *
 * This list may only ever shrink. Adding a name here to silence the guard
 * defeats its entire purpose — mirror the tool instead.
 */
export const WEB_ONLY_TOOL_NAMES = [
  "crm_get_deal_auftrag",
  "crm_get_deal_inventory",
  "crm_get_deal_package_options",
  "crm_get_deal_offer_packages",
  "crm_get_deal_date_offers",
  "crm_update_deal_package_options",
  "crm_update_deal_quotation",
  "crm_set_deal_anzahlung",
  "crm_get_deal_document",
  "crm_generate_document",
  "crm_get_document_job",
  "crm_store_document_job",
] as const;

/**
 * FROZEN. Shared tools whose description text differs between the two
 * registries today — the stdio wording predates the verbose house style.
 *
 * This is a snapshot of the drift that already existed at the moment this
 * guard was added, taken directly off the two registries' source (not
 * copied from a plan doc): 42 tools, not the 40 an earlier draft of this
 * guard assumed. `crm_list_tasks` and `crm_update_task` belong on it too —
 * verified at `register-tools.ts` vs `apps/mcp/src/tools/definitions.ts`,
 * where the stdio text names the fields ("optionally hide completed",
 * "content, completed, deadline") and the web text does not.
 *
 * The list may only ever shrink, by rewriting a stdio description to match
 * the web one — never grow, to silence a new mismatch. Do not fix the
 * mismatch here as a side effect of an unrelated task: `crm_list_tasks` and
 * `crm_update_task` are expected to lose their new project fields in both
 * registries in a later task of this same phase, and whichever task makes
 * that edit owns bringing their descriptions into agreement too. When it
 * does, those two entries come out and this list drops to 40 — the shrink
 * property working as designed, not a bug to "fix" early.
 */
export const LEGACY_DESCRIPTION_DRIFT = [
  "crm_status",
  "crm_whoami",
  "crm_search",
  "crm_browse_records",
  "crm_list_objects",
  "crm_get_object",
  "crm_list_attributes",
  "crm_list_records",
  "crm_get_record",
  "crm_create_record",
  "crm_update_record",
  "crm_query_records",
  "crm_get_record_related",
  "crm_list_tasks",
  "crm_update_task",
  "crm_list_notes",
  "crm_update_note",
  "crm_list_lists",
  "crm_list_conversations",
  "crm_get_conversation",
  "crm_update_conversation_status",
  "crm_link_conversation_deal",
  "crm_inbox_unread_count",
  "crm_list_channel_accounts",
  "crm_get_deal_insights",
  "crm_get_deal_lifecycle",
  "crm_list_deal_documents",
  "crm_get_deal_quotation",
  "crm_list_deal_payments",
  "crm_get_customer_link",
  "crm_list_deal_attachments",
  "crm_get_attachment",
  "crm_get_financial_overview",
  "crm_list_financial_bookings",
  "crm_stats_overview",
  "crm_operations_board",
  "crm_list_members",
  "crm_list_notifications",
  "crm_list_operating_companies",
  "crm_list_agent_drafts",
  "crm_get_agent_settings",
  "crm_api",
] as const;

/**
 * Tools whose dispatch case has no fixed REST path to compare.
 *
 * `crm_status` answers from the client context without a request at all, and
 * `crm_api` takes its path from the caller — the only `/api/` literal in its
 * body is the `startsWith` guard, which would compare equal for the wrong
 * reason. Both are excluded explicitly rather than by accident.
 */
export const TOOLS_WITHOUT_FIXED_PATH = ["crm_status", "crm_api"] as const;
