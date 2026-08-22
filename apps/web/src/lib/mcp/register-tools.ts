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
    "List tasks. With no filters this returns the open, top-level tasks of the workspace. kind splits the two halves of the work model: 'projekt' tasks belong to a project, 'operativ' tasks are day-to-day work tagged with an area. Narrow further with projectId, phaseId, area ('angebot','auftrag','nachsorge','schaden','personal','fahrzeuge','beschaffung','buchhaltung','kunde','sonstiges'), status ('geplant','in_arbeit','erledigt'), overdue, dueWithinDays, or sprintId — 'active' for the running sprint, 'none' for the backlog, or a concrete sprint id. Subtasks are hidden by default; pass includeSubtasks true when you need every row, for example to count a project's real progress.",
    {
      showCompleted: z.boolean().optional(),
      kind: z.enum(["projekt", "operativ"]).optional(),
      projectId: z.string().optional(),
      phaseId: z.string().optional(),
      area: z.string().optional(),
      status: z.enum(["geplant", "in_arbeit", "erledigt"]).optional(),
      sprintId: z.string().optional(),
      overdue: z.boolean().optional(),
      dueWithinDays: z.number().optional(),
      includeSubtasks: z.boolean().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
    req
  );
  tool(
    server,
    "crm_get_task",
    "Get one task by id, enriched the same way crm_update_task's response is: assignees, linked records, projectId/phaseId, area, status, priority, dates and parentTaskId. crm_list_tasks caps at 200 rows and hides completed tasks and subtasks by default, so this is the way to read a task that list would filter out. Read it before an assigneeIds or recordIds update — both REPLACE the whole set on crm_update_task, and this is where you get the current list to merge.",
    { taskId: z.string() },
    req
  );
  tool(
    server,
    "crm_create_task",
    "Create a task. content is the title. Passing projectId makes it a project task — kind is forced to 'projekt' server-side, so you never need to send both. Leaving projectId out makes it operative work, and then area should be one of 'angebot','auftrag','nachsorge','schaden','personal','fahrzeuge','beschaffung','buchhaltung','kunde','sonstiges' or the task lands untagged in the operative list. phaseId must belong to projectId or the call is rejected. status is 'geplant','in_arbeit' or 'erledigt' and is kept in sync with the completion flag. priority is 'sehr_hoch','hoch','mittel' or 'niedrig'. recordIds links the task to CRM records, assigneeIds to workspace users. For a child of an existing task prefer crm_create_subtask, which inherits the parent's project and phase.",
    {
      content: z.string(),
      description: z.string().nullable().optional(),
      deadline: z.string().nullable().optional(),
      startDate: z.string().nullable().optional(),
      priority: z.enum(["sehr_hoch", "hoch", "mittel", "niedrig"]).optional(),
      status: z.enum(["geplant", "in_arbeit", "erledigt"]).optional(),
      kind: z.enum(["projekt", "operativ"]).optional(),
      projectId: z.string().nullable().optional(),
      phaseId: z.string().nullable().optional(),
      area: z.string().nullable().optional(),
      sprintId: z.string().nullable().optional(),
      parentTaskId: z.string().nullable().optional(),
      recordIds: z.array(z.string()).optional(),
      assigneeIds: z.array(z.string()).optional(),
    },
    req
  );
  tool(
    server,
    "crm_update_task",
    "Update a task. PATCH semantics — only the fields you pass change. status and isCompleted are two views of one thing and are always written together: status 'erledigt' completes the task and stamps completedAt, isCompleted false reopens it as 'in_arbeit'. Setting projectId switches the task to kind 'projekt'; clearing it with null makes it operative and drops phaseId, so pass an area in the same call. A phaseId must belong to the task's project. Subtasks follow their parent automatically. assigneeIds and recordIds REPLACE the whole set — call crm_get_task first and send the merged list, or you will silently unassign people.",
    {
      taskId: z.string(),
      content: z.string().optional(),
      description: z.string().nullable().optional(),
      isCompleted: z.boolean().optional(),
      deadline: z.string().nullable().optional(),
      startDate: z.string().nullable().optional(),
      priority: z.enum(["sehr_hoch", "hoch", "mittel", "niedrig"]).optional(),
      status: z.enum(["geplant", "in_arbeit", "erledigt"]).optional(),
      kind: z.enum(["projekt", "operativ"]).optional(),
      projectId: z.string().nullable().optional(),
      phaseId: z.string().nullable().optional(),
      area: z.string().nullable().optional(),
      sprintId: z.string().nullable().optional(),
      parentTaskId: z.string().nullable().optional(),
      recordIds: z.array(z.string()).optional(),
      assigneeIds: z.array(z.string()).optional(),
    },
    req
  );
  tool(server, "crm_delete_task", "Delete a task.", { taskId: z.string() }, req);

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

  // ── Deal context ────────────────────────────────────────────────────────
  tool(
    server,
    "crm_get_deal_auftrag",
    "Auftrag / lead context for a deal: customer name, both addresses, move date, floors, elevator, inventory notes, operating company, plus open customer questions. This is the source of truth for document fields — read it before generating an AB or invoice.",
    { recordId: z.string() },
    req
  );
  tool(
    server,
    "crm_list_deal_attachments",
    "METADATA ONLY for the attachments on a deal (customer-sent apartment photos etc.): id, fileName, mimeType, fileSize, createdAt, conversationId, messageId. It never returns file bytes. To actually SEE a photo call crm_get_attachment({ id }) — do NOT try crm_api on /api/v1/inbox/attachments/{id}/content, that route streams raw binary. Pass image ids to crm_generate_document as imageAttachmentIds to put them in a PDF.",
    { recordId: z.string() },
    req
  );
  tool(
    server,
    "crm_get_attachment",
    "Fetch ONE inbox attachment WITH its bytes — this is how you look at a customer photo. Kottke quotes a fixed price from photos, so read the kitchen, the volume and anything needing dismantling here rather than guessing from the file name. By default (format 'image') the pixels come back as an MCP image content block a vision model renders directly, with metadata as text alongside. format 'base64' returns contentBase64 in the JSON instead (use it if your client cannot render image blocks), 'both' returns both. Non-image types (PDF, audio) always come back as base64 with an explanatory hint, never as HTML. maxBytes caps how many bytes one result may carry in any form (default and hard ceiling 3 MB — a buffered JSON body cannot hold more); over it no bytes are inlined and the result says so. Every customer photo in production fits: the largest is 2.4 MB, the median ~250 KB. Bigger files (mail PDFs, videos) must be streamed from /api/v1/inbox/attachments/{id}/content in a browser session. Pass recordId to assert the attachment belongs to that deal. Auth required; another workspace's id is a 404.",
    {
      id: z.string(),
      recordId: z.string().optional(),
      format: z.enum(["image", "base64", "both"]).optional(),
      maxBytes: z.number().optional(),
    },
    req
  );
  tool(
    server,
    "crm_get_deal_inventory",
    "Inventory / furniture list captured for a deal.",
    { recordId: z.string() },
    req
  );
  tool(
    server,
    "crm_get_deal_package_options",
    "Offer package options configured for this deal.",
    { recordId: z.string() },
    req
  );
  tool(
    server,
    "crm_get_deal_offer_packages",
    "Offer packages available to this deal's operating company.",
    { recordId: z.string() },
    req
  );
  tool(
    server,
    "crm_get_deal_date_offers",
    "Alternative move-date offers for a deal.",
    { recordId: z.string() },
    req
  );

  // ── Quotation writes ────────────────────────────────────────────────────
  tool(
    server,
    "crm_update_deal_package_options",
    "Replace the per-deal package options (Basis/Komfort/Premium etc. with deal-specific price) shown to the customer on Stage 1 of the portal. PUT semantics — replaces the full set for this deal; pass an empty options array to clear. At most 6 options. Each option needs a non-empty displayName and a non-negative integer priceCents; catalogueSlug (e.g. 'basic'/'komfort'/'premium' from crm_get_deal_offer_packages) is optional and only used to link back to the company catalogue. When at least one option exists for the deal, the customer portal renders these instead of the operating company's generic offer-packages catalogue.",
    {
      recordId: z.string(),
      options: z.array(
        z.object({
          catalogueSlug: z.string().nullable().optional(),
          displayName: z.string(),
          shortDescription: z.string().nullable().optional(),
          priceCents: z.number(),
          includedItems: z.array(z.string()).optional(),
          excludedItems: z.array(z.string()).optional(),
          addableItems: z.array(z.string()).optional(),
          note: z.string().nullable().optional(),
          isRecommended: z.boolean().optional(),
        })
      ),
    },
    req
  );
  tool(
    server,
    "crm_update_deal_quotation",
    "Replace a deal's quotation (PUT semantics — omitted fields are cleared, so read crm_get_deal_quotation first and merge). Saving also mints the customer portal link and anchors the scope baseline.",
    {
      recordId: z.string(),
      isVariable: z.boolean().optional(),
      fixedPrice: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      depositRequiredCents: z.number().nullable().optional(),
      paymentMethodPreference: z
        .enum(["bank_transfer", "paypal", "cash", "card"])
        .nullable()
        .optional(),
      validUntil: z.string().nullable().optional(),
      summary: z.string().nullable().optional(),
      showStandardInclusions: z.boolean().optional(),
      selectedPackageSlug: z.string().nullable().optional(),
      calculationAssumptions: z.record(z.unknown()).nullable().optional(),
      lineItems: z.array(z.record(z.unknown())).optional(),
    },
    req
  );
  tool(
    server,
    "crm_set_deal_anzahlung",
    "Set only the Anzahlung (deposit in cents) and payment method on a deal's quotation, leaving the rest of the quotation untouched.",
    {
      recordId: z.string(),
      depositRequiredCents: z.number().nullable().optional(),
      paymentMethodPreference: z
        .enum(["bank_transfer", "paypal", "cash", "card"])
        .nullable()
        .optional(),
    },
    req
  );

  // ── Documents ───────────────────────────────────────────────────────────
  tool(
    server,
    "crm_get_deal_document",
    "Fetch one stored deal document (a rendered AB/RE PDF). Returns { _binary: true, mimeType, byteLength, fileName, contentBase64 } — decode contentBase64 to get the file. For customer photos from the inbox use crm_get_attachment instead.",
    { recordId: z.string(), documentId: z.string() },
    req
  );
  tool(
    server,
    "crm_generate_document",
    "Start a PDF render on the crm-tools VPS and return { job_id }. Async: poll crm_get_document_job until status=done, then crm_store_document_job to attach it to the deal. params mirrors the Auftrags-Tab dialog: { firma: 'kottke'|'ceylan', document_type: 'AB'|'RE', kunde: {vorname,nachname,adresse,email}, auftrag: {strecke_von,strecke_nach,datum,volumen,besonderheiten}, preise: {...}, anweisung? }. preise is either { modell:'stundensatz', helfer_anzahl, stunden_geschaetzt, helfer_rate, transporter_rate, mindest_stunden, ... } or { modell:'pauschale', pauschale_positionen:[{titel,betrag}] }. The kunde name is re-derived server-side from the linked person, so a wrong name here is corrected automatically.",
    {
      recordId: z.string(),
      params: z.record(z.unknown()),
      skill: z
        .enum(["rechnungen-und-auftragsbestaetigungen", "auftragsanweisung"])
        .optional(),
      imageAttachmentIds: z.array(z.string()).optional(),
    },
    req
  );
  tool(
    server,
    "crm_get_document_job",
    "Poll a document render job started by crm_generate_document.",
    { jobId: z.string() },
    req
  );
  tool(
    server,
    "crm_store_document_job",
    "Attach a finished render job's PDF to a deal as a document. documentType is deduced from the filename (AB- → order_confirmation, RE- → invoice, AW- → worker_instructions) when omitted. Storing an order_confirmation or invoice notifies the customer portal.",
    {
      jobId: z.string(),
      recordId: z.string(),
      documentType: z
        .enum([
          "order_confirmation",
          "invoice",
          "payment_confirmation",
          "worker_instructions",
        ])
        .optional(),
    },
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
    "crm_create_agent_draft",
    "Create a PENDING agent draft for human approval (never sends). Pass conversationId for replies; dealRecordId suffices for first_contact. One live pending draft per (deal, messageClass) — a 409 'draft_exists' returns the existingDraftId. Drafts expire after 72h. source: 'grok-bot' (hosted) or 'grok-vps'.",
    {
      conversationId: z.string().optional(),
      dealRecordId: z.string().optional(),
      messageClass: z.enum([
        "reply",
        "slot_question",
        "ack",
        "followup",
        "first_contact",
        "handoff_ack",
      ]),
      draftText: z.string(),
      reasoning: z.string().optional(),
      mode: z.string().optional(),
      source: z.string().optional(),
      modelTag: z.string().optional(),
      idempotencyKey: z.string().optional(),
      expiresInHours: z.number().optional(),
    },
    req
  );

  // ── Projekte ────────────────────────────────────────────────────────────
  tool(
    server,
    "crm_list_projects",
    "List projects with their aggregated stats block (task counts, progress percentage, budget planned vs spent, open risks by severity). Filter with status ('geplant'|'aktiv'|'pausiert'|'abgeschlossen'|'abgebrochen'), category (a PROJECT_CATEGORIES value such as 'vertrieb', 'fuhrpark' or 'software'), sprintId, or favoritesOnly to get just the caller's pinned projects. Archived projects are hidden unless includeArchived is true. This is the entry point for every project question — read it before guessing a project id.",
    {
      status: z
        .enum(["geplant", "aktiv", "pausiert", "abgeschlossen", "abgebrochen"])
        .optional(),
      category: z.string().optional(),
      sprintId: z.string().optional(),
      favoritesOnly: z.boolean().optional(),
      includeArchived: z.boolean().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
    req
  );
  tool(
    server,
    "crm_get_project",
    "Get one project in full: scope in/out, problem statement, goal statement, success criteria, owner, members with their roles, planned budget and the same stats block crm_list_projects returns. Use crm_project_overview when you only need the KPI numbers, and crm_list_project_phases / crm_list_project_milestones for the plan itself — they are not inlined here.",
    { projectId: z.string() },
    req
  );
  tool(
    server,
    "crm_create_project",
    "Create a project. Only name is required; everything else can be filled in later with crm_update_project. category must be one of 'leistung','vertrieb','marketing','personal','fuhrpark','standorte','gruendung','prozesse','partner','preise','qualitaet','software','finanzen' — an unknown value is rejected. priority is 'sehr_hoch','hoch','mittel' or 'niedrig'. status defaults to 'geplant'. budgetPlannedCents is integer euro cents (12.500,00 EUR is 1250000), never a float and never a formatted string. startDate and endDate are ISO 'YYYY-MM-DD'. icon and color default from the category when omitted. memberUserIds are workspace user ids from crm_list_members; each is added as a project member with role 'mitglied' — call crm_update_project_member afterwards to give one of them a different role. To draft a whole plan first, call crm_generate_project_plan and create its phases and milestones afterwards.",
    {
      name: z.string(),
      shortDescription: z.string().nullable().optional(),
      category: z.string().optional(),
      priority: z.enum(["sehr_hoch", "hoch", "mittel", "niedrig"]).optional(),
      status: z
        .enum(["geplant", "aktiv", "pausiert", "abgeschlossen", "abgebrochen"])
        .optional(),
      icon: z.string().nullable().optional(),
      color: z.string().nullable().optional(),
      startDate: z.string().nullable().optional(),
      endDate: z.string().nullable().optional(),
      ownerUserId: z.string().nullable().optional(),
      problemStatement: z.string().nullable().optional(),
      goalStatement: z.string().nullable().optional(),
      successCriteria: z.string().nullable().optional(),
      scopeIn: z.array(z.string()).optional(),
      scopeOut: z.array(z.string()).optional(),
      budgetPlannedCents: z.number().nullable().optional(),
      memberUserIds: z.array(z.string()).optional(),
    },
    req
  );
  tool(
    server,
    "crm_update_project",
    "Update a project. PATCH semantics — only the fields you pass change, everything else keeps its value; pass null to clear a nullable field. Setting status to 'abgeschlossen' or 'abgebrochen' emits a status-changed activity event and notifies every workspace member, so it is not a scratch value. scopeIn and scopeOut replace the whole list, they do not append. notesContent is the TipTap JSON document behind the project's Notizen tab and replaces the stored document wholesale — read crm_get_project first if you mean to extend it.",
    {
      projectId: z.string(),
      name: z.string().optional(),
      shortDescription: z.string().nullable().optional(),
      category: z.string().optional(),
      priority: z.enum(["sehr_hoch", "hoch", "mittel", "niedrig"]).optional(),
      status: z
        .enum(["geplant", "aktiv", "pausiert", "abgeschlossen", "abgebrochen"])
        .optional(),
      icon: z.string().nullable().optional(),
      color: z.string().nullable().optional(),
      startDate: z.string().nullable().optional(),
      endDate: z.string().nullable().optional(),
      ownerUserId: z.string().nullable().optional(),
      problemStatement: z.string().nullable().optional(),
      goalStatement: z.string().nullable().optional(),
      successCriteria: z.string().nullable().optional(),
      scopeIn: z.array(z.string()).optional(),
      scopeOut: z.array(z.string()).optional(),
      budgetPlannedCents: z.number().nullable().optional(),
      notesContent: z.unknown().optional(),
      archivedAt: z.string().nullable().optional(),
    },
    req
  );
  tool(
    server,
    "crm_delete_project",
    "Delete a project permanently. Its phases, milestones, members, risks, budget entries and documents cascade away with it. Tasks that belonged to the project survive: they fall back to kind 'operativ' with no project and no phase. There is no undo and no trash — when a project merely stopped, prefer crm_update_project with status 'abgebrochen'.",
    { projectId: z.string() },
    req
  );
  tool(
    server,
    "crm_project_overview",
    "KPI bundle for one project: progress percentage, task and phase counts, overdue tasks, the next milestone, budget planned vs spent with its percentage, and open risks grouped by severity. Cheaper than crm_get_project when all you need are the numbers for a status report.",
    { projectId: z.string() },
    req
  );
  tool(
    server,
    "crm_set_project_favorite",
    "Pin or unpin a project for the calling user. favorite true pins it, false unpins it. Favourites are per user, not per workspace, and are what the favoritesOnly filter of crm_list_projects reads — pinning does not change the project itself and notifies nobody.",
    { projectId: z.string(), favorite: z.boolean() },
    req
  );

  // ── Phasen ──────────────────────────────────────────────────────────────
  tool(
    server,
    "crm_list_project_phases",
    "List a project's phases ('Arbeitsbereiche') in board order, each with its own task count, done count, progress percentage and the users assigned to its tasks. Phases are the second level of the plan: a task may hang directly off the project or off one of its phases, never off a phase of a different project.",
    { projectId: z.string() },
    req
  );
  tool(
    server,
    "crm_create_project_phase",
    "Add a phase to a project. It is appended at the end of the current order — use crm_reorder_project_phases to move it. status is 'geplant', 'in_arbeit' or 'abgeschlossen' and defaults to 'geplant'. startDate and dueDate are ISO 'YYYY-MM-DD'; they drive the timeline display and are not validated against the project's own dates, so a phase may legitimately run past its project's end.",
    {
      projectId: z.string(),
      name: z.string(),
      description: z.string().nullable().optional(),
      startDate: z.string().nullable().optional(),
      dueDate: z.string().nullable().optional(),
      status: z.enum(["geplant", "in_arbeit", "abgeschlossen"]).optional(),
    },
    req
  );
  tool(
    server,
    "crm_update_project_phase",
    "Update one phase. PATCH semantics — omitted fields keep their value, null clears a nullable one. Setting status to 'abgeschlossen' emits a phase-completed activity event but does NOT complete the phase's tasks; close those with crm_update_task, or the project's progress percentage and the phase badge will disagree.",
    {
      projectId: z.string(),
      phaseId: z.string(),
      name: z.string().optional(),
      description: z.string().nullable().optional(),
      startDate: z.string().nullable().optional(),
      dueDate: z.string().nullable().optional(),
      status: z.enum(["geplant", "in_arbeit", "abgeschlossen"]).optional(),
    },
    req
  );
  tool(
    server,
    "crm_delete_project_phase",
    "Delete a phase. Its tasks are deliberately NOT deleted: they keep their project and their phaseId becomes null, so nothing disappears from the project's progress count. Move the tasks first with crm_move_task if they belong somewhere else.",
    { projectId: z.string(), phaseId: z.string() },
    req
  );
  tool(
    server,
    "crm_reorder_project_phases",
    "Rewrite the display order of a project's phases in one call. orderedPhaseIds must contain every phase id of the project exactly once, in the new order — a partial or padded list is rejected rather than partially applied. Read crm_list_project_phases first and reorder the ids it returns.",
    { projectId: z.string(), orderedPhaseIds: z.array(z.string()) },
    req
  );

  // ── Meilensteine ────────────────────────────────────────────────────────
  tool(
    server,
    "crm_list_project_milestones",
    "List a project's milestones with due date, status ('geplant'|'erreicht'|'verfehlt'), the phase they are anchored to and the timestamp they were reached. Milestones are dates to hit, not work items — the work itself lives in tasks, so never model a deliverable as a milestone alone.",
    { projectId: z.string() },
    req
  );
  tool(
    server,
    "crm_create_project_milestone",
    "Add a milestone to a project. name and dueDate (ISO 'YYYY-MM-DD') are what makes it useful. phaseId optionally anchors it to one phase and must belong to this project. Leave status at its default 'geplant': flipping a milestone to 'erreicht' notifies every workspace member, which is not what you want while seeding a plan.",
    {
      projectId: z.string(),
      name: z.string(),
      dueDate: z.string().nullable().optional(),
      phaseId: z.string().nullable().optional(),
      status: z.enum(["geplant", "erreicht", "verfehlt"]).optional(),
    },
    req
  );
  tool(
    server,
    "crm_update_project_milestone",
    "Update one milestone. PATCH semantics — omitted fields keep their value, null clears a nullable one. Setting status to 'erreicht' stamps reachedAt and notifies every workspace member. Use 'verfehlt' for a date that passed without the milestone being hit; silently moving dueDate instead destroys the record of what was originally promised.",
    {
      projectId: z.string(),
      milestoneId: z.string(),
      name: z.string().optional(),
      dueDate: z.string().nullable().optional(),
      phaseId: z.string().nullable().optional(),
      status: z.enum(["geplant", "erreicht", "verfehlt"]).optional(),
    },
    req
  );
  tool(
    server,
    "crm_delete_project_milestone",
    "Delete a milestone permanently. Nothing else references it, so this is safe — but when the milestone happened and was missed, prefer crm_update_project_milestone with status 'verfehlt' so the project history stays readable.",
    { projectId: z.string(), milestoneId: z.string() },
    req
  );

  // ── Mitglieder ──────────────────────────────────────────────────────────
  tool(
    server,
    "crm_list_project_members",
    "List the people on a project with their role ('leiter'|'mitglied'|'beobachter'), name, email and avatar. The role documents who does what — it is NOT access control: every non-employee workspace member can read and change every project regardless of membership.",
    { projectId: z.string() },
    req
  );
  tool(
    server,
    "crm_add_project_member",
    "Put a workspace user on a project. userId is a workspace user id from crm_list_members, not an email and not a CRM record id. role is 'leiter', 'mitglied' or 'beobachter' and defaults to 'mitglied'. The user is notified. Adding someone who is already a member updates their role instead of creating a duplicate row.",
    {
      projectId: z.string(),
      userId: z.string(),
      role: z.enum(["leiter", "mitglied", "beobachter"]).optional(),
    },
    req
  );
  tool(
    server,
    "crm_update_project_member",
    "Change one member's role on a project to 'leiter', 'mitglied' or 'beobachter'. This is display and responsibility information only and grants no extra permissions — do not use it to try to restrict someone's access.",
    {
      projectId: z.string(),
      userId: z.string(),
      role: z.enum(["leiter", "mitglied", "beobachter"]),
    },
    req
  );
  tool(
    server,
    "crm_remove_project_member",
    "Take a user off a project. Their tasks stay assigned to them — assignment and membership are separate things, so removing a member never orphans work. Removing the last 'leiter' is allowed; the project's ownerUserId is a separate field you set with crm_update_project.",
    { projectId: z.string(), userId: z.string() },
    req
  );

  // ── Risiken ─────────────────────────────────────────────────────────────
  tool(
    server,
    "crm_list_project_risks",
    "List a project's risks with severity ('niedrig'|'mittel'|'hoch'), likelihood on the same scale, status ('offen'|'beobachtet'|'geschlossen'), the planned mitigation and the owner. The count of open risks by severity also appears in the project's stats block, so this is the detail view behind that number.",
    { projectId: z.string() },
    req
  );
  tool(
    server,
    "crm_create_project_risk",
    "Log a risk on a project. title is required. severity and likelihood are 'niedrig', 'mittel' or 'hoch'. severity defaults to 'mittel' when omitted; likelihood does NOT — an omitted or unrecognised likelihood is left unset (null), never coerced to 'mittel', because an unassessed likelihood is not a medium one. A new risk with severity 'hoch' notifies every workspace member, so reserve it for things that genuinely threaten the project. Put the countermeasure in mitigation rather than burying it in description — the risk board reads that field.",
    {
      projectId: z.string(),
      title: z.string(),
      description: z.string().nullable().optional(),
      severity: z.enum(["niedrig", "mittel", "hoch"]).optional(),
      likelihood: z.enum(["niedrig", "mittel", "hoch"]).nullable().optional(),
      mitigation: z.string().nullable().optional(),
      ownerUserId: z.string().nullable().optional(),
    },
    req
  );
  tool(
    server,
    "crm_update_project_risk",
    "Update one risk. PATCH semantics — omitted fields keep their value, null clears a nullable one. Set status to 'geschlossen' once the risk no longer applies: that drops it out of the project's open-risk count and emits a risk-closed event. 'beobachtet' keeps it visible but no longer urgent.",
    {
      projectId: z.string(),
      riskId: z.string(),
      title: z.string().optional(),
      description: z.string().nullable().optional(),
      severity: z.enum(["niedrig", "mittel", "hoch"]).optional(),
      likelihood: z.enum(["niedrig", "mittel", "hoch"]).nullable().optional(),
      status: z.enum(["offen", "beobachtet", "geschlossen"]).optional(),
      mitigation: z.string().nullable().optional(),
      ownerUserId: z.string().nullable().optional(),
    },
    req
  );
  tool(
    server,
    "crm_delete_project_risk",
    "Delete a risk permanently. Prefer crm_update_project_risk with status 'geschlossen' so the project keeps the record of what was considered and why it stopped mattering — a deleted risk looks like a risk nobody ever thought about.",
    { projectId: z.string(), riskId: z.string() },
    req
  );

  // ── Budget ──────────────────────────────────────────────────────────────
  tool(
    server,
    "crm_get_project_budget",
    "Budget of one project: the planned total, the sum of the 'plan' entries, the actual spend, the resulting percentage and every entry. All amounts are integer euro cents. plannedCents is the single number set on the project itself; plannedBreakdownCents is the sum of the individual plan lines and may legitimately differ from it — do not treat a mismatch as an error.",
    { projectId: z.string() },
    req
  );
  tool(
    server,
    "crm_create_project_budget_entry",
    "Add one budget line to a project. kind 'plan' is a budgeted item, kind 'ist' is money actually spent — only 'ist' entries move the spend figure and the budget percentage. amountCents is integer euro cents (2.500,00 EUR is 250000): never a float, never a string with a comma, never euros. bookedAt is the ISO 'YYYY-MM-DD' the amount applies to, not the day you enter it.",
    {
      projectId: z.string(),
      label: z.string(),
      amountCents: z.number(),
      kind: z.enum(["plan", "ist"]),
      bookedAt: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
    },
    req
  );
  tool(
    server,
    "crm_update_project_budget_entry",
    "Update one budget entry. PATCH semantics — omitted fields keep their value, null clears a nullable one. Switching kind between 'plan' and 'ist' immediately changes the project's spend figure and its budget percentage, so do it deliberately rather than to tidy up a label.",
    {
      projectId: z.string(),
      entryId: z.string(),
      label: z.string().optional(),
      amountCents: z.number().optional(),
      kind: z.enum(["plan", "ist"]).optional(),
      bookedAt: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
    },
    req
  );
  tool(
    server,
    "crm_delete_project_budget_entry",
    "Delete one budget entry permanently. The project's own planned total (budgetPlannedCents, set with crm_update_project) is a separate field and is not touched — deleting every plan line does not zero the budget.",
    { projectId: z.string(), entryId: z.string() },
    req
  );

  // ── Projektdokumente ────────────────────────────────────────────────────
  tool(
    server,
    "crm_list_project_documents",
    "METADATA ONLY for the files attached to a project: id, fileName, fileSize, mimeType, uploader and upload time. It never returns bytes. Call crm_get_project_document with one of the ids to get the content. For customer photos from the inbox use crm_get_attachment instead — these are project files, not deal attachments.",
    { projectId: z.string() },
    req
  );
  tool(
    server,
    "crm_get_project_document",
    "Fetch one project document including its base64 content. Files are capped at 10 MB on upload, so anything stored here can be inlined. Uploading is deliberately not an MCP tool: the upload route takes multipart/form-data, which this client cannot build — use crm_api if an agent truly has to create one.",
    { projectId: z.string(), documentId: z.string() },
    req
  );
  tool(
    server,
    "crm_delete_project_document",
    "Delete one project document permanently, bytes and all. There is no trash and no undo, and the file is not recoverable from anywhere else — confirm with the user before calling this.",
    { projectId: z.string(), documentId: z.string() },
    req
  );

  // ── Abhängigkeiten ──────────────────────────────────────────────────────
  tool(
    server,
    "crm_list_task_dependencies",
    "List the dependency edges attached to one task — both the tasks it waits for and the tasks waiting on it. Each edge carries its own id, which is what crm_remove_task_dependency needs. For the whole dependency graph of a sprint in one call use crm_sprint_timeline instead of walking task by task.",
    { taskId: z.string() },
    req
  );
  tool(
    server,
    "crm_add_task_dependency",
    "Make one task wait for another: predecessorTaskId must be finished before successorTaskId can start. Read the direction carefully — swapping the two inverts every arrow on the sprint timeline. Both tasks must be in this workspace. A self-link, a duplicate edge, or an edge that would close a cycle is rejected with a German error message rather than created; read the message instead of retrying.",
    { predecessorTaskId: z.string(), successorTaskId: z.string() },
    req
  );
  tool(
    server,
    "crm_remove_task_dependency",
    "Remove one dependency edge. dependencyId comes from crm_list_task_dependencies or crm_sprint_timeline; taskId is the task the edge is listed under (either end works). Neither task is otherwise changed — no dates move, no status changes.",
    { taskId: z.string(), dependencyId: z.string() },
    req
  );

  // ── Sprints ─────────────────────────────────────────────────────────────
  tool(
    server,
    "crm_list_sprints",
    "List every sprint of the workspace, newest first, with state ('planung'|'aktiv'|'abgeschlossen'), start and end date, the day counters and live metrics. The metrics are TASK COUNTS, not story points: totalTasks, doneTasks, openTasks, progressPct. At most one sprint is 'aktiv' at a time — that is the one the work dashboard and the timeline default to.",
    empty,
    req
  );
  tool(
    server,
    "crm_get_sprint",
    "Get one sprint with its live metrics and day counters (daysTotal, daysElapsed, daysRemaining). A closed sprint returns the counts frozen at close time rather than recomputing them, so historical sprints stay stable.",
    { sprintId: z.string() },
    req
  );
  tool(
    server,
    "crm_create_sprint",
    "Create a sprint. It starts in state 'planung' — creating it does not start it, call crm_activate_sprint for that. name is required; startDate and endDate are ISO 'YYYY-MM-DD'. capacityPoints is the planned number of TASKS for the sprint (the column kept its old points name after the switch to count-based sprints); leave it out when you do not have a number.",
    {
      name: z.string(),
      goal: z.string().nullable().optional(),
      startDate: z.string().nullable().optional(),
      endDate: z.string().nullable().optional(),
      capacityPoints: z.number().nullable().optional(),
    },
    req
  );
  tool(
    server,
    "crm_update_sprint",
    "Edit a sprint's name, goal, dates or planned task count. PATCH semantics — omitted fields keep their value. This tool never starts or closes a sprint: use crm_activate_sprint and crm_close_sprint, which are separate on purpose so a typo cannot fall through to a plain edit.",
    {
      sprintId: z.string(),
      name: z.string().optional(),
      goal: z.string().nullable().optional(),
      startDate: z.string().nullable().optional(),
      endDate: z.string().nullable().optional(),
      capacityPoints: z.number().nullable().optional(),
    },
    req
  );
  tool(
    server,
    "crm_activate_sprint",
    "Start a sprint. Only one sprint can be 'aktiv' at a time: if another one is still running the call is rejected with a German message telling you to close it first — do not retry, close the running sprint or pick a different one. An active sprint is what crm_work_dashboard and crm_sprint_timeline default to.",
    { sprintId: z.string() },
    req
  );
  tool(
    server,
    "crm_close_sprint",
    "Close a sprint and carry its unfinished tasks over. The sprint's committed and completed task counts are frozen at this moment and its metrics stop moving, so this is not reversible by reactivating it. Returns the sprint plus a summary of what was carried. Ask the user before closing — this ends a planning period for the whole team.",
    { sprintId: z.string() },
    req
  );
  tool(
    server,
    "crm_delete_sprint",
    "Delete a sprint. Only sprints still in state 'planung' can be deleted; a running or closed sprint is refused with a German message telling you to close it instead. Tasks assigned to a deleted sprint fall back to the backlog, they are not deleted.",
    { sprintId: z.string() },
    req
  );

  // ── Aufgabe verschieben ─────────────────────────────────────────────────
  tool(
    server,
    "crm_move_task",
    "Move a task between projects, phases and the operative list in one call. projectId null takes it out of every project: it becomes kind 'operativ' and its phaseId is cleared, so pass an area in the same call or it lands untagged. A phaseId must belong to the target project or the move is rejected. Subtasks are moved along with their parent. Use crm_update_task when you want to change content or dates as well — this tool only moves.",
    {
      taskId: z.string(),
      projectId: z.string().nullable(),
      phaseId: z.string().nullable().optional(),
      area: z.string().nullable().optional(),
    },
    req
  );

  // ── Unteraufgaben und Kommentare ────────────────────────────────────────
  tool(
    server,
    "crm_list_subtasks",
    "List the children of a task, enriched like full tasks (assignees, deadline, status, priority). Subtasks are hidden from crm_list_tasks unless includeSubtasks is set, so this is the direct way to see them. They inherit kind, projectId and phaseId from their parent and always live in the same project.",
    { taskId: z.string() },
    req
  );
  tool(
    server,
    "crm_create_subtask",
    "Add a subtask under a parent task. It inherits the parent's kind, project and phase automatically — do not try to set those here; if the child belongs elsewhere it is not a subtask, create it with crm_create_task instead. Without a deadline it inherits the parent's, so an overdue parent does not hide fresh-looking children.",
    {
      taskId: z.string(),
      content: z.string(),
      deadline: z.string().nullable().optional(),
      assigneeIds: z.array(z.string()).optional(),
    },
    req
  );
  tool(
    server,
    "crm_list_task_comments",
    "List the comments on a task, oldest first, with author and timestamp. Comments are the discussion thread; the task's own description field is the brief. Read this before answering 'what is the status of X' — the last comment is usually the answer.",
    { taskId: z.string() },
    req
  );
  tool(
    server,
    "crm_create_task_comment",
    "Add a comment to a task. body is plain text. Posting is not silent: the task's audience (assignees plus creator, minus you) gets a push notification, and an @-mention of a workspace member pushes them separately. Do not use comments as a scratchpad or a progress log for yourself — put durable information in the task description instead.",
    { taskId: z.string(), body: z.string() },
    req
  );

  // ── Übergreifend ────────────────────────────────────────────────────────
  tool(
    server,
    "crm_work_dashboard",
    "The whole work dashboard in one call: KPIs (overall progress, project counts, open and due-today operative tasks, overdue count, team utilisation), the running sprint, project cards with their stats, the operative task list, the overdue list, recent activity, upcoming dates and the per-member team overview. Pass sprintId to look at a specific sprint instead of the active one. Prefer this over five separate list calls whenever you are asked how work is going — it is one query and it is what the UI itself renders.",
    { sprintId: z.string().optional() },
    req
  );
  tool(
    server,
    "crm_sprint_timeline",
    "Gantt-style timeline: the day window, one row per project plus a row for operative work, one bar per dated task with its state ('geplant'|'in_arbeit'|'erledigt'|'ueberfaellig'), and every dependency edge between the visible tasks. The two scopes answer different questions — sprintId returns that sprint's tasks across all projects and defaults to the active sprint, while projectId returns that project's tasks regardless of sprint membership; pass both to intersect them. maxBarsPerRow caps how many bars one row renders and reports the remainder as a count, which is what keeps a project with hundreds of dated tasks from producing an unusable response. This is the only tool that returns the dependency graph as a whole — do not walk crm_list_task_dependencies task by task to rebuild it.",
    {
      sprintId: z.string().optional(),
      projectId: z.string().optional(),
      maxBarsPerRow: z.number().optional(),
    },
    req
  );
  tool(
    server,
    "crm_generate_project_plan",
    "Ask the AI planner for a DRAFT project plan: scope in/out, phases with their tasks, milestones and risks. Every date comes back as an offset in days from the project start, never as an absolute date, so the plan does not depend on the model's idea of today. Nothing is written to the CRM — this returns a proposal you then create with crm_create_project, crm_create_project_phase, crm_create_project_milestone and crm_create_task. The call runs on the crm-tools runner and can take several minutes; a failure or a missing configuration is not fatal, fall back to planning manually rather than retrying in a loop.",
    {
      name: z.string(),
      shortDescription: z.string().nullable().optional(),
      category: z.string().optional(),
      priority: z.enum(["sehr_hoch", "hoch", "mittel", "niedrig"]).optional(),
      startDate: z.string().nullable().optional(),
      endDate: z.string().nullable().optional(),
      problemStatement: z.string().nullable().optional(),
      goalStatement: z.string().nullable().optional(),
      successCriteria: z.string().nullable().optional(),
      scopeIn: z.array(z.string()).optional(),
      scopeOut: z.array(z.string()).optional(),
    },
    req
  );

  tool(
    server,
    "crm_api",
    "Raw authenticated request to any /api/… path (escape hatch). A binary response (image, PDF) is wrapped as { _binary: true, mimeType, byteLength, contentBase64 } rather than being parsed as JSON, and a path with no route handler reports NOT_JSON_HTML instead of dumping the Next.js app shell. For inbox attachment bytes prefer crm_get_attachment — it returns a renderable image block; crm_api only ever gives you base64.",
    {
      method: z.enum(["GET", "POST", "PATCH", "PUT", "DELETE"]).optional(),
      path: z.string(),
      query: z.record(z.unknown()).optional(),
      body: z.unknown().optional(),
    },
    req
  );
}
