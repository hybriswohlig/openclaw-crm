import type { CrmClient } from "../lib/client.js";
import { formatToolError, formatToolResult } from "../lib/client.js";

type Args = Record<string, unknown>;

function str(v: unknown): string {
  return String(v ?? "");
}

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function bool(v: unknown): boolean | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}

/**
 * I4: coerce an array/object argument that arrived as a JSON string.
 *
 * `apps/mcp` has no zod parse before dispatch — `handleTool` in index.ts
 * passes `args` straight through, so `required`/enum in definitions.ts are
 * advisory only, unlike the web registry where the SDK's zod parse rejects
 * a malformed call before it reaches dispatch. The web dispatch.ts grew
 * this same coercion (see its `asBody`) because MCP clients commonly send
 * an array/object-typed argument as a JSON string when the schema gives
 * them nothing stronger to validate against — but that hardening only
 * reached the web side, so on stdio: scopeIn/scopeOut arrived as a string
 * and iterated character-by-character (or were silently dropped),
 * memberUserIds' `Array.isArray` check failed silently (201 with no
 * members — the very defect once recorded as "fixed in both dispatch
 * layers", fixed for real arrays only), recordIds/assigneeIds threw a
 * TypeError deep in `.map()` (opaque 500), and notesContent went into the
 * TipTap column as a raw string instead of the JSON document it holds.
 */
function asBody(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const trimmed = v.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return v;
  try {
    return JSON.parse(trimmed);
  } catch {
    return v;
  }
}

function asQuery(obj: unknown): Record<string, string | number | boolean | undefined> | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const out: Record<string, string | number | boolean | undefined> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    } else {
      out[k] = String(v);
    }
  }
  return out;
}

export async function handleTool(
  client: CrmClient,
  name: string,
  args: Args
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const data = await dispatch(client, name, args);
    return {
      content: [{ type: "text", text: formatToolResult(data) }],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: formatToolError(err) }],
      isError: true,
    };
  }
}

async function dispatch(client: CrmClient, name: string, args: Args): Promise<unknown> {
  switch (name) {
    // Auth
    case "crm_login": {
      const result = await client.login(str(args.email), str(args.password));
      return {
        ok: true,
        authMode: client.authMode(),
        user: result.user ?? null,
        message: "Logged in. Session stored for this MCP process.",
      };
    }
    case "crm_logout": {
      await client.logout();
      return { ok: true, message: "Logged out / session cleared." };
    }
    case "crm_status": {
      return {
        baseUrl: client.config.baseUrl,
        authMode: client.authMode(),
        hasApiKey: Boolean(client.config.apiKey),
        hasEnvPassword: Boolean(client.config.email && client.config.password),
        hasSession: Boolean(client.auth.getSessionCookie()),
        sessionPersistence: Boolean(client.config.sessionFile),
      };
    }
    case "crm_whoami":
      return client.request("/api/v1/workspace");

    // Search
    case "crm_search":
      return client.request("/api/v1/search", {
        query: { q: str(args.q), limit: num(args.limit) },
      });
    case "crm_browse_records":
      return client.request("/api/v1/records/browse", {
        query: { limit: num(args.limit) },
      });

    // Objects
    case "crm_list_objects":
      return client.request("/api/v1/objects");
    case "crm_get_object":
      return client.request(`/api/v1/objects/${encodeURIComponent(str(args.slug))}`);
    case "crm_list_attributes":
      return client.request(
        `/api/v1/objects/${encodeURIComponent(str(args.slug))}/attributes`
      );

    // Records
    case "crm_list_records":
      return client.request(
        `/api/v1/objects/${encodeURIComponent(str(args.slug))}/records`,
        { query: { limit: num(args.limit), offset: num(args.offset) } }
      );
    case "crm_get_record":
      return client.request(
        `/api/v1/objects/${encodeURIComponent(str(args.slug))}/records/${encodeURIComponent(str(args.recordId))}`
      );
    case "crm_create_record":
      return client.request(
        `/api/v1/objects/${encodeURIComponent(str(args.slug))}/records`,
        { method: "POST", body: { values: args.values } }
      );
    case "crm_update_record":
      return client.request(
        `/api/v1/objects/${encodeURIComponent(str(args.slug))}/records/${encodeURIComponent(str(args.recordId))}`,
        { method: "PATCH", body: { values: args.values } }
      );
    case "crm_delete_record":
      return client.request(
        `/api/v1/objects/${encodeURIComponent(str(args.slug))}/records/${encodeURIComponent(str(args.recordId))}`,
        { method: "DELETE" }
      );
    case "crm_query_records": {
      const body: Record<string, unknown> = {};
      if (args.filter !== undefined) body.filter = args.filter;
      if (args.sorts !== undefined) body.sorts = args.sorts;
      if (args.limit !== undefined) body.limit = num(args.limit);
      if (args.offset !== undefined) body.offset = num(args.offset);
      if (args.mode !== undefined) body.mode = args.mode;
      if (args.matchAttribute !== undefined) body.matchAttribute = args.matchAttribute;
      if (args.matchValue !== undefined) body.matchValue = args.matchValue;
      if (args.values !== undefined) body.values = args.values;
      return client.request(
        `/api/v1/objects/${encodeURIComponent(str(args.slug))}/records/query`,
        { method: "POST", body }
      );
    }
    case "crm_get_record_related":
      return client.request(
        `/api/v1/objects/${encodeURIComponent(str(args.slug))}/records/${encodeURIComponent(str(args.recordId))}/related`
      );
    case "crm_get_record_activity":
      return client.request(
        `/api/v1/objects/${encodeURIComponent(str(args.slug))}/records/${encodeURIComponent(str(args.recordId))}/activity`
      );

    // Tasks
    case "crm_list_tasks":
      return client.request("/api/v1/tasks", {
        query: {
          showCompleted: bool(args.showCompleted),
          kind: args.kind as string | undefined,
          projectId: args.projectId as string | undefined,
          phaseId: args.phaseId as string | undefined,
          area: args.area as string | undefined,
          status: args.status as string | undefined,
          sprintId: args.sprintId as string | undefined,
          overdue: bool(args.overdue),
          dueWithinDays: num(args.dueWithinDays),
          includeSubtasks: bool(args.includeSubtasks),
          limit: num(args.limit),
          offset: num(args.offset),
        },
      });
    case "crm_get_task":
      return client.request(`/api/v1/tasks/${encodeURIComponent(str(args.taskId))}`);
    case "crm_create_task": {
      const body: Record<string, unknown> = { content: args.content };
      for (const key of [
        "description",
        "deadline",
        "startDate",
        "priority",
        "status",
        "kind",
        "projectId",
        "phaseId",
        "area",
        "sprintId",
        "parentTaskId",
      ]) {
        if (args[key] !== undefined) body[key] = args[key];
      }
      if (args.recordIds !== undefined) body.recordIds = asBody(args.recordIds);
      if (args.assigneeIds !== undefined) {
        body.assigneeIds = asBody(args.assigneeIds);
      }
      return client.request("/api/v1/tasks", { method: "POST", body });
    }
    case "crm_update_task": {
      const body: Record<string, unknown> = {};
      for (const key of [
        "content",
        "description",
        "deadline",
        "startDate",
        "priority",
        "status",
        "kind",
        "projectId",
        "phaseId",
        "area",
        "sprintId",
        "parentTaskId",
      ]) {
        if (args[key] !== undefined) body[key] = args[key];
      }
      if (args.isCompleted !== undefined) {
        body.isCompleted = bool(args.isCompleted);
      }
      if (args.recordIds !== undefined) body.recordIds = asBody(args.recordIds);
      if (args.assigneeIds !== undefined) {
        body.assigneeIds = asBody(args.assigneeIds);
      }
      return client.request(`/api/v1/tasks/${encodeURIComponent(str(args.taskId))}`, {
        method: "PATCH",
        body,
      });
    }
    case "crm_delete_task":
      return client.request(`/api/v1/tasks/${encodeURIComponent(str(args.taskId))}`, {
        method: "DELETE",
      });

    // Notes
    case "crm_list_notes":
      return client.request("/api/v1/notes", {
        query: { limit: num(args.limit), offset: num(args.offset) },
      });
    case "crm_create_note":
      return client.request(
        `/api/v1/objects/${encodeURIComponent(str(args.slug))}/records/${encodeURIComponent(str(args.recordId))}/notes`,
        {
          method: "POST",
          body: { title: args.title, content: args.content },
        }
      );
    case "crm_update_note":
      return client.request(`/api/v1/notes/${encodeURIComponent(str(args.noteId))}`, {
        method: "PATCH",
        body: { title: args.title, content: args.content },
      });
    case "crm_delete_note":
      return client.request(`/api/v1/notes/${encodeURIComponent(str(args.noteId))}`, {
        method: "DELETE",
      });

    // Lists
    case "crm_list_lists":
      return client.request("/api/v1/lists");
    case "crm_get_list":
      return client.request(`/api/v1/lists/${encodeURIComponent(str(args.listId))}`);
    case "crm_list_entries":
      return client.request(
        `/api/v1/lists/${encodeURIComponent(str(args.listId))}/entries`,
        { query: { limit: num(args.limit), offset: num(args.offset) } }
      );
    case "crm_add_list_entry":
      return client.request(
        `/api/v1/lists/${encodeURIComponent(str(args.listId))}/entries`,
        {
          method: "POST",
          body: { recordId: args.recordId, values: args.values },
        }
      );

    // Inbox
    case "crm_list_conversations":
      return client.request("/api/v1/inbox/conversations", {
        query: {
          status: args.status as string | undefined,
          lane: args.lane as string | undefined,
          channelType: args.channelType as string | undefined,
          channelAccountId: args.channelAccountId as string | undefined,
          operatingCompanyRecordId: args.operatingCompanyRecordId as string | undefined,
          q: args.q as string | undefined,
          limit: num(args.limit),
          excludeLane: args.excludeLane as string | undefined,
        },
      });
    case "crm_get_conversation":
      return client.request(
        `/api/v1/inbox/conversations/${encodeURIComponent(str(args.conversationId))}`
      );
    case "crm_list_messages":
      return client.request(
        `/api/v1/inbox/conversations/${encodeURIComponent(str(args.conversationId))}/messages`,
        { query: { limit: num(args.limit) } }
      );
    case "crm_update_conversation_status":
      return client.request(
        `/api/v1/inbox/conversations/${encodeURIComponent(str(args.conversationId))}/status`,
        { method: "PATCH", body: { status: args.status } }
      );
    case "crm_link_conversation_deal":
      return client.request(
        `/api/v1/inbox/conversations/${encodeURIComponent(str(args.conversationId))}/link-deal`,
        { method: "PATCH", body: { dealRecordId: args.dealRecordId } }
      );
    case "crm_suggest_reply":
      return client.request(
        `/api/v1/inbox/conversations/${encodeURIComponent(str(args.conversationId))}/suggest-reply`,
        { method: "POST", body: {} }
      );
    case "crm_inbox_unread_count":
      return client.request("/api/v1/inbox/unread-count");
    case "crm_list_channel_accounts":
      return client.request("/api/v1/inbox/channel-accounts");

    // Deals
    case "crm_get_deal_insights":
      return client.request(
        `/api/v1/deals/${encodeURIComponent(str(args.recordId))}/insights`
      );
    case "crm_get_deal_lifecycle":
      return client.request(
        `/api/v1/deals/${encodeURIComponent(str(args.recordId))}/lifecycle`
      );
    case "crm_get_deal_profit":
      return client.request(
        `/api/v1/deals/${encodeURIComponent(str(args.recordId))}/profit`
      );
    case "crm_list_deal_attachments":
      return client.request(
        `/api/v1/deals/${encodeURIComponent(str(args.recordId))}/attachments`
      );
    case "crm_get_attachment":
      // The stdio server has no image-content-block plumbing, so this returns
      // base64 in JSON. The remote MCP (apps/web) additionally renders an image
      // block; both read the same route.
      return client.request(
        `/api/v1/inbox/attachments/${encodeURIComponent(str(args.id))}`,
        {
          query: {
            dealRecordId: args.recordId === undefined ? undefined : str(args.recordId),
          },
        }
      );
    case "crm_list_deal_documents":
      return client.request(
        `/api/v1/deals/${encodeURIComponent(str(args.recordId))}/documents`
      );
    case "crm_get_deal_quotation":
      return client.request(
        `/api/v1/deals/${encodeURIComponent(str(args.recordId))}/quotation`
      );
    case "crm_list_deal_payments":
      return client.request(
        `/api/v1/deals/${encodeURIComponent(str(args.recordId))}/payments`
      );
    case "crm_get_customer_link":
      return client.request(
        `/api/v1/customer-link/${encodeURIComponent(str(args.dealRecordId))}`
      );

    // Employees & finance
    case "crm_list_employees":
      return client.request("/api/v1/employees");
    case "crm_get_financial_overview":
      return client.request("/api/v1/financial/overview");
    case "crm_list_financial_bookings":
      return client.request("/api/v1/financial/bookings", {
        query: { limit: num(args.limit), offset: num(args.offset) },
      });

    // Stats
    case "crm_stats_overview":
      return client.request("/api/v1/statistics/overview");
    case "crm_stats_pipeline":
      return client.request("/api/v1/statistics/pipeline");
    case "crm_stats_operations":
      return client.request("/api/v1/statistics/operations");
    case "crm_stats_team":
      return client.request("/api/v1/statistics/team");
    case "crm_operations_board":
      return client.request("/api/v1/operations");

    // Workspace
    case "crm_list_members":
      return client.request("/api/v1/workspace-members");
    case "crm_list_notifications":
      return client.request("/api/v1/notifications", {
        query: {
          unreadOnly: bool(args.unreadOnly),
          limit: num(args.limit),
        },
      });
    case "crm_list_operating_companies":
      return client.request("/api/v1/operating-companies");

    // Agent
    case "crm_list_agent_drafts":
      return client.request("/api/v1/agent-drafts");
    case "crm_get_agent_settings":
      return client.request("/api/v1/agent-settings");
    case "crm_create_agent_draft":
      return client.request("/api/v1/agent-drafts", {
        method: "POST",
        body: {
          conversationId: args.conversationId,
          dealRecordId: args.dealRecordId,
          messageClass: args.messageClass,
          draftText: args.draftText,
          reasoning: args.reasoning,
          mode: args.mode,
          source: args.source,
          modelTag: args.modelTag,
          idempotencyKey: args.idempotencyKey,
          expiresInHours: num(args.expiresInHours),
        },
      });

    // Projekte
    case "crm_list_projects":
      return client.request("/api/v1/projects", {
        query: {
          status: args.status as string | undefined,
          category: args.category as string | undefined,
          sprintId: args.sprintId as string | undefined,
          favoritesOnly: bool(args.favoritesOnly),
          includeArchived: bool(args.includeArchived),
          limit: num(args.limit),
          offset: num(args.offset),
        },
      });
    case "crm_get_project":
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}`
      );
    case "crm_create_project": {
      const body: Record<string, unknown> = { name: args.name };
      for (const key of [
        "shortDescription",
        "category",
        "priority",
        "status",
        "icon",
        "color",
        "startDate",
        "endDate",
        "ownerUserId",
        "problemStatement",
        "goalStatement",
        "successCriteria",
      ]) {
        if (args[key] !== undefined) body[key] = args[key];
      }
      if (args.scopeIn !== undefined) body.scopeIn = asBody(args.scopeIn);
      if (args.scopeOut !== undefined) body.scopeOut = asBody(args.scopeOut);
      if (args.memberUserIds !== undefined) {
        // POST /api/v1/projects reads `members: Array<{ userId, role? }>`,
        // never a flat id list — mapped here rather than trusting the route
        // to accept `memberUserIds` (it silently ignores unknown keys).
        // I4: coerce first — a string-encoded array used to fail
        // Array.isArray silently, so `members` was never set and the
        // project was created with no members at all, 201 and no error.
        const ids = asBody(args.memberUserIds);
        if (Array.isArray(ids)) {
          body.members = ids.map((userId) => ({ userId }));
        }
      }
      if (args.budgetPlannedCents !== undefined) {
        body.budgetPlannedCents =
          args.budgetPlannedCents === null ? null : num(args.budgetPlannedCents);
      }
      return client.request("/api/v1/projects", { method: "POST", body });
    }
    case "crm_update_project": {
      const body: Record<string, unknown> = {};
      for (const key of [
        "name",
        "shortDescription",
        "category",
        "priority",
        "status",
        "icon",
        "color",
        "startDate",
        "endDate",
        "ownerUserId",
        "problemStatement",
        "goalStatement",
        "successCriteria",
        "archivedAt",
      ]) {
        if (args[key] !== undefined) body[key] = args[key];
      }
      if (args.scopeIn !== undefined) body.scopeIn = asBody(args.scopeIn);
      if (args.scopeOut !== undefined) body.scopeOut = asBody(args.scopeOut);
      if (args.notesContent !== undefined) {
        body.notesContent = asBody(args.notesContent);
      }
      if (args.budgetPlannedCents !== undefined) {
        body.budgetPlannedCents =
          args.budgetPlannedCents === null ? null : num(args.budgetPlannedCents);
      }
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}`,
        { method: "PATCH", body }
      );
    }
    case "crm_delete_project":
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}`,
        { method: "DELETE" }
      );
    case "crm_project_overview":
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}/overview`
      );
    case "crm_set_project_favorite": {
      const favorite = bool(args.favorite) ?? true;
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}/favorite`,
        { method: favorite ? "PUT" : "DELETE" }
      );
    }

    // Phasen
    case "crm_list_project_phases":
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}/phases`
      );
    case "crm_create_project_phase": {
      const body: Record<string, unknown> = { name: args.name };
      for (const key of ["description", "startDate", "dueDate", "status"]) {
        if (args[key] !== undefined) body[key] = args[key];
      }
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}/phases`,
        { method: "POST", body }
      );
    }
    case "crm_update_project_phase": {
      const body: Record<string, unknown> = {};
      for (const key of [
        "name",
        "description",
        "startDate",
        "dueDate",
        "status",
      ]) {
        if (args[key] !== undefined) body[key] = args[key];
      }
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}/phases/${encodeURIComponent(str(args.phaseId))}`,
        { method: "PATCH", body }
      );
    }
    case "crm_delete_project_phase":
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}/phases/${encodeURIComponent(str(args.phaseId))}`,
        { method: "DELETE" }
      );
    case "crm_reorder_project_phases":
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}/phases/reorder`,
        {
          method: "POST",
          body: { orderedPhaseIds: asBody(args.orderedPhaseIds) ?? [] },
        }
      );

    // Meilensteine
    case "crm_list_project_milestones":
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}/milestones`
      );
    case "crm_create_project_milestone": {
      const body: Record<string, unknown> = { name: args.name };
      for (const key of ["dueDate", "phaseId", "status"]) {
        if (args[key] !== undefined) body[key] = args[key];
      }
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}/milestones`,
        { method: "POST", body }
      );
    }
    case "crm_update_project_milestone": {
      const body: Record<string, unknown> = {};
      for (const key of ["name", "dueDate", "phaseId", "status"]) {
        if (args[key] !== undefined) body[key] = args[key];
      }
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}/milestones/${encodeURIComponent(str(args.milestoneId))}`,
        { method: "PATCH", body }
      );
    }
    case "crm_delete_project_milestone":
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}/milestones/${encodeURIComponent(str(args.milestoneId))}`,
        { method: "DELETE" }
      );

    // Mitglieder
    case "crm_list_project_members":
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}/members`
      );
    case "crm_add_project_member": {
      const body: Record<string, unknown> = { userId: args.userId };
      if (args.role !== undefined) body.role = args.role;
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}/members`,
        { method: "POST", body }
      );
    }
    case "crm_update_project_member":
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}/members/${encodeURIComponent(str(args.userId))}`,
        { method: "PATCH", body: { role: args.role } }
      );
    case "crm_remove_project_member":
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}/members/${encodeURIComponent(str(args.userId))}`,
        { method: "DELETE" }
      );

    // Risiken
    case "crm_list_project_risks":
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}/risks`
      );
    case "crm_create_project_risk": {
      const body: Record<string, unknown> = { title: args.title };
      for (const key of [
        "description",
        "severity",
        "likelihood",
        "mitigation",
        "ownerUserId",
      ]) {
        if (args[key] !== undefined) body[key] = args[key];
      }
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}/risks`,
        { method: "POST", body }
      );
    }
    case "crm_update_project_risk": {
      const body: Record<string, unknown> = {};
      for (const key of [
        "title",
        "description",
        "severity",
        "likelihood",
        "status",
        "mitigation",
        "ownerUserId",
      ]) {
        if (args[key] !== undefined) body[key] = args[key];
      }
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}/risks/${encodeURIComponent(str(args.riskId))}`,
        { method: "PATCH", body }
      );
    }
    case "crm_delete_project_risk":
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}/risks/${encodeURIComponent(str(args.riskId))}`,
        { method: "DELETE" }
      );

    // Budget
    case "crm_get_project_budget":
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}/budget`
      );
    case "crm_create_project_budget_entry": {
      const body: Record<string, unknown> = {
        label: args.label,
        amountCents: num(args.amountCents),
        kind: args.kind,
      };
      for (const key of ["bookedAt", "note"]) {
        if (args[key] !== undefined) body[key] = args[key];
      }
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}/budget`,
        { method: "POST", body }
      );
    }
    case "crm_update_project_budget_entry": {
      const body: Record<string, unknown> = {};
      for (const key of ["label", "kind", "bookedAt", "note"]) {
        if (args[key] !== undefined) body[key] = args[key];
      }
      if (args.amountCents !== undefined) {
        body.amountCents = num(args.amountCents);
      }
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}/budget/${encodeURIComponent(str(args.entryId))}`,
        { method: "PATCH", body }
      );
    }
    case "crm_delete_project_budget_entry":
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}/budget/${encodeURIComponent(str(args.entryId))}`,
        { method: "DELETE" }
      );

    // Projektdokumente
    case "crm_list_project_documents":
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}/documents`
      );
    case "crm_get_project_document":
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}/documents/${encodeURIComponent(str(args.documentId))}`
      );
    case "crm_delete_project_document":
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}/documents/${encodeURIComponent(str(args.documentId))}`,
        { method: "DELETE" }
      );

    // Abhängigkeiten
    case "crm_list_task_dependencies":
      return client.request(
        `/api/v1/tasks/${encodeURIComponent(str(args.taskId))}/dependencies`
      );
    case "crm_add_task_dependency":
      return client.request(
        `/api/v1/tasks/${encodeURIComponent(str(args.successorTaskId))}/dependencies`,
        {
          method: "POST",
          body: { predecessorTaskId: str(args.predecessorTaskId) },
        }
      );
    case "crm_remove_task_dependency":
      return client.request(
        `/api/v1/tasks/${encodeURIComponent(str(args.taskId))}/dependencies/${encodeURIComponent(str(args.dependencyId))}`,
        { method: "DELETE" }
      );

    // Sprints
    case "crm_list_sprints":
      return client.request("/api/v1/sprints");
    case "crm_get_sprint":
      return client.request(
        `/api/v1/sprints/${encodeURIComponent(str(args.sprintId))}`
      );
    case "crm_create_sprint": {
      const body: Record<string, unknown> = { name: args.name };
      for (const key of ["goal", "startDate", "endDate"]) {
        if (args[key] !== undefined) body[key] = args[key];
      }
      if (args.capacityPoints !== undefined) {
        body.capacityPoints =
          args.capacityPoints === null ? null : num(args.capacityPoints);
      }
      return client.request("/api/v1/sprints", { method: "POST", body });
    }
    case "crm_update_sprint": {
      const body: Record<string, unknown> = {};
      for (const key of ["name", "goal", "startDate", "endDate"]) {
        if (args[key] !== undefined) body[key] = args[key];
      }
      if (args.capacityPoints !== undefined) {
        body.capacityPoints =
          args.capacityPoints === null ? null : num(args.capacityPoints);
      }
      return client.request(
        `/api/v1/sprints/${encodeURIComponent(str(args.sprintId))}`,
        { method: "PATCH", body }
      );
    }
    case "crm_activate_sprint":
      return client.request(
        `/api/v1/sprints/${encodeURIComponent(str(args.sprintId))}`,
        { method: "PATCH", body: { action: "aktivieren" } }
      );
    case "crm_close_sprint":
      return client.request(
        `/api/v1/sprints/${encodeURIComponent(str(args.sprintId))}`,
        { method: "PATCH", body: { action: "abschliessen" } }
      );
    case "crm_delete_sprint":
      return client.request(
        `/api/v1/sprints/${encodeURIComponent(str(args.sprintId))}`,
        { method: "DELETE" }
      );

    // Aufgabe verschieben
    case "crm_move_task": {
      const body: Record<string, unknown> = {
        projectId: args.projectId ?? null,
        phaseId: args.phaseId ?? null,
      };
      if (args.area !== undefined) body.area = args.area;
      return client.request(`/api/v1/tasks/${encodeURIComponent(str(args.taskId))}`, {
        method: "PATCH",
        body,
      });
    }

    // Unteraufgaben und Kommentare
    case "crm_list_subtasks":
      return client.request(
        `/api/v1/tasks/${encodeURIComponent(str(args.taskId))}/subtasks`
      );
    case "crm_create_subtask": {
      const body: Record<string, unknown> = { content: args.content };
      if (args.deadline !== undefined) body.deadline = args.deadline;
      if (args.assigneeIds !== undefined) {
        body.assigneeIds = asBody(args.assigneeIds);
      }
      return client.request(
        `/api/v1/tasks/${encodeURIComponent(str(args.taskId))}/subtasks`,
        { method: "POST", body }
      );
    }
    case "crm_list_task_comments":
      return client.request(
        `/api/v1/tasks/${encodeURIComponent(str(args.taskId))}/comments`
      );
    case "crm_create_task_comment":
      return client.request(
        `/api/v1/tasks/${encodeURIComponent(str(args.taskId))}/comments`,
        { method: "POST", body: { body: str(args.body) } }
      );

    // Übergreifend
    case "crm_work_dashboard":
      return client.request("/api/v1/work/dashboard", {
        query: { sprintId: args.sprintId as string | undefined },
      });
    case "crm_sprint_timeline":
      return client.request("/api/v1/work/timeline", {
        query: {
          sprintId: args.sprintId as string | undefined,
          projectId: args.projectId as string | undefined,
          maxBarsPerRow: num(args.maxBarsPerRow),
        },
      });
    case "crm_generate_project_plan": {
      const body: Record<string, unknown> = { name: args.name };
      for (const key of [
        "shortDescription",
        "category",
        "priority",
        "startDate",
        "endDate",
        "problemStatement",
        "goalStatement",
        "successCriteria",
      ]) {
        if (args[key] !== undefined) body[key] = args[key];
      }
      if (args.scopeIn !== undefined) body.scopeIn = asBody(args.scopeIn);
      if (args.scopeOut !== undefined) body.scopeOut = asBody(args.scopeOut);
      return client.request("/api/v1/projects/plan-generate", {
        method: "POST",
        body,
      });
    }

    // Escape hatch
    case "crm_api": {
      const path = str(args.path);
      if (!path.startsWith("/api/")) {
        throw new Error("path must start with /api/");
      }
      // Block obvious secrets exfiltration paths? Keep open — user owns the CRM.
      return client.request(path, {
        method: str(args.method || "GET").toUpperCase(),
        query: asQuery(args.query),
        body: asBody(args.body),
      });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
