import { isSafeHttpMethod } from "@/lib/api-key-scopes";

/**
 * MCP tools a read-only `oc_sk_` key may call.
 *
 * These dispatch to GET (or, for `crm_status`, no HTTP at all). Tools that
 * POST even for a query — `crm_query_records`, `crm_suggest_reply`,
 * `crm_preview_document` — are treated as mutating: a read-only key may only
 * use safe HTTP methods. `crm_api` is checked per call from its `method`.
 *
 * A tool missing from both sets is denied. `tool-names` coverage fails until
 * a new tool is added here on purpose.
 */
export const MCP_READ_TOOL_NAMES = new Set<string>([
  "crm_status",
  "crm_whoami",
  "crm_search",
  "crm_browse_records",
  "crm_list_objects",
  "crm_get_object",
  "crm_list_attributes",
  "crm_list_records",
  "crm_get_record",
  "crm_get_record_related",
  "crm_get_record_activity",
  "crm_list_tasks",
  "crm_get_task",
  "crm_list_notes",
  "crm_list_lists",
  "crm_get_list",
  "crm_list_entries",
  "crm_list_conversations",
  "crm_get_conversation",
  "crm_list_messages",
  "crm_inbox_unread_count",
  "crm_list_channel_accounts",
  "crm_get_deal_insights",
  "crm_get_deal_lifecycle",
  "crm_get_deal_profit",
  "crm_list_deal_documents",
  "crm_get_deal_quotation",
  "crm_list_deal_payments",
  "crm_get_customer_link",
  "crm_get_deal_auftrag",
  "crm_list_deal_attachments",
  "crm_get_attachment",
  "crm_get_deal_inventory",
  "crm_get_deal_package_options",
  "crm_get_deal_offer_packages",
  "crm_get_deal_date_offers",
  "crm_get_deal_document",
  "crm_get_document_job",
  "crm_list_employees",
  "crm_get_financial_overview",
  "crm_list_financial_bookings",
  "crm_stats_overview",
  "crm_stats_pipeline",
  "crm_stats_operations",
  "crm_stats_team",
  "crm_operations_board",
  "crm_list_calendar_events",
  "crm_list_members",
  "crm_list_notifications",
  "crm_list_operating_companies",
  "crm_list_agent_drafts",
  "crm_get_agent_settings",
  "crm_list_projects",
  "crm_get_project",
  "crm_project_overview",
  "crm_list_project_phases",
  "crm_list_project_milestones",
  "crm_list_project_members",
  "crm_list_project_risks",
  "crm_get_project_budget",
  "crm_list_project_documents",
  "crm_get_project_document",
  "crm_list_task_dependencies",
  "crm_list_sprints",
  "crm_get_sprint",
  "crm_list_subtasks",
  "crm_list_task_comments",
  "crm_work_dashboard",
  "crm_sprint_timeline",
]);

export const MCP_MUTATING_TOOL_NAMES = new Set<string>([
  "crm_create_record",
  "crm_update_record",
  "crm_delete_record",
  "crm_query_records",
  "crm_create_task",
  "crm_update_task",
  "crm_delete_task",
  "crm_create_note",
  "crm_update_note",
  "crm_delete_note",
  "crm_add_list_entry",
  "crm_update_conversation_status",
  "crm_link_conversation_deal",
  "crm_suggest_reply",
  "crm_upload_deal_document",
  "crm_upload_deal_photo",
  "crm_update_deal_inventory_item",
  "crm_update_deal_package_options",
  "crm_update_deal_quotation",
  "crm_set_deal_anzahlung",
  "crm_generate_document",
  "crm_render_document",
  "crm_preview_document",
  "crm_store_document_job",
  "crm_create_agent_draft",
  "crm_update_agent_draft",
  "crm_send_conversation_message",
  "crm_send_baileys_message",
  "crm_create_project",
  "crm_update_project",
  "crm_delete_project",
  "crm_set_project_favorite",
  "crm_create_project_phase",
  "crm_update_project_phase",
  "crm_delete_project_phase",
  "crm_reorder_project_phases",
  "crm_create_project_milestone",
  "crm_update_project_milestone",
  "crm_delete_project_milestone",
  "crm_add_project_member",
  "crm_update_project_member",
  "crm_remove_project_member",
  "crm_create_project_risk",
  "crm_update_project_risk",
  "crm_delete_project_risk",
  "crm_create_project_budget_entry",
  "crm_update_project_budget_entry",
  "crm_delete_project_budget_entry",
  "crm_delete_project_document",
  "crm_add_task_dependency",
  "crm_remove_task_dependency",
  "crm_create_sprint",
  "crm_update_sprint",
  "crm_activate_sprint",
  "crm_close_sprint",
  "crm_delete_sprint",
  "crm_move_task",
  "crm_create_subtask",
  "crm_create_task_comment",
  "crm_generate_project_plan",
]);

/**
 * `null` when a read-only key may call this tool.
 * A string is the tool error to return instead of dispatching.
 */
export function readOnlyMcpToolError(
  name: string,
  args: Record<string, unknown>
): string | null {
  if (name === "crm_api") {
    const method = String(args.method ?? "GET").trim().toUpperCase() || "GET";
    if (isSafeHttpMethod(method)) return null;
    return (
      `This API key is read-only and cannot call crm_api with ${method}. ` +
      "Read-only keys may only use GET, HEAD, and OPTIONS."
    );
  }
  if (MCP_READ_TOOL_NAMES.has(name)) return null;
  const label = MCP_MUTATING_TOOL_NAMES.has(name) ? name : `${name} (unknown tool)`;
  return (
    `This API key is read-only and cannot call ${label}. ` +
    "Read-only keys may only call read tools."
  );
}
