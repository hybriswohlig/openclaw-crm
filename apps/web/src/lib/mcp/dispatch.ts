import type { CrmClient } from "./client";
import { formatToolError, formatToolResult } from "./client";

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
 * Coerce a request body that may have arrived as a JSON string.
 *
 * Body-ish params are typed `z.unknown()`, which serializes to an empty JSON
 * Schema, so MCP clients have nothing to validate against and commonly send
 * the value as a JSON string. Forwarding that verbatim makes the route's
 * `req.json()` yield a string, and every field read off it comes back
 * undefined ("skill is required" on an otherwise well-formed call).
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

function asQuery(
  obj: unknown
): Record<string, string | number | boolean | undefined> | undefined {
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
    return { content: [{ type: "text", text: formatToolResult(data) }] };
  } catch (err) {
    return {
      content: [{ type: "text", text: formatToolError(err) }],
      isError: true,
    };
  }
}

async function dispatch(client: CrmClient, name: string, args: Args): Promise<unknown> {
  switch (name) {
    case "crm_status": {
      const a = client.context;
      return {
        baseUrl: a.baseUrl,
        authMode: a.bearerToken?.includes("oc_sk_")
          ? "api_key"
          : a.cookie
            ? "session"
            : "bearer",
        userId: a.userId,
        workspaceId: a.workspaceId,
        workspaceRole: a.workspaceRole,
        transport: "http",
        deployment: process.env.VERCEL ? "vercel" : "local",
      };
    }
    case "crm_whoami":
      return client.request("/api/v1/workspace");

    case "crm_search":
      return client.request("/api/v1/search", {
        query: { q: str(args.q), limit: num(args.limit) },
      });
    case "crm_browse_records":
      return client.request("/api/v1/records/browse", {
        query: { limit: num(args.limit) },
      });

    case "crm_list_objects":
      return client.request("/api/v1/objects");
    case "crm_get_object":
      return client.request(`/api/v1/objects/${encodeURIComponent(str(args.slug))}`);
    case "crm_list_attributes":
      return client.request(
        `/api/v1/objects/${encodeURIComponent(str(args.slug))}/attributes`
      );

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

    case "crm_list_tasks":
      return client.request("/api/v1/tasks", {
        query: {
          showCompleted: bool(args.showCompleted),
          limit: num(args.limit),
          offset: num(args.offset),
        },
      });
    case "crm_create_task":
      return client.request("/api/v1/tasks", {
        method: "POST",
        body: {
          content: args.content,
          deadline: args.deadline,
          recordIds: args.recordIds,
          assigneeIds: args.assigneeIds,
        },
      });
    case "crm_update_task":
      return client.request(`/api/v1/tasks/${encodeURIComponent(str(args.taskId))}`, {
        method: "PATCH",
        body: {
          content: args.content,
          isCompleted: args.isCompleted,
          deadline: args.deadline,
        },
      });
    case "crm_delete_task":
      return client.request(`/api/v1/tasks/${encodeURIComponent(str(args.taskId))}`, {
        method: "DELETE",
      });
    case "crm_tasks_pulse":
      return client.request("/api/v1/tasks/pulse");

    case "crm_list_notes":
      return client.request("/api/v1/notes", {
        query: { limit: num(args.limit), offset: num(args.offset) },
      });
    case "crm_create_note":
      return client.request(
        `/api/v1/objects/${encodeURIComponent(str(args.slug))}/records/${encodeURIComponent(str(args.recordId))}/notes`,
        { method: "POST", body: { title: args.title, content: args.content } }
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
        { method: "POST", body: { recordId: args.recordId, values: args.values } }
      );

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

    // ── Deal context: what the documents are built from ─────────────────
    case "crm_get_deal_auftrag":
      return client.request(
        `/api/v1/deals/${encodeURIComponent(str(args.recordId))}/auftrag`
      );
    case "crm_list_deal_attachments":
      return client.request(
        `/api/v1/deals/${encodeURIComponent(str(args.recordId))}/attachments`
      );
    case "crm_get_deal_inventory":
      return client.request(
        `/api/v1/deals/${encodeURIComponent(str(args.recordId))}/inventory`
      );
    case "crm_get_deal_package_options":
      return client.request(
        `/api/v1/deals/${encodeURIComponent(str(args.recordId))}/package-options`
      );
    case "crm_get_deal_offer_packages":
      return client.request(
        `/api/v1/deals/${encodeURIComponent(str(args.recordId))}/offer-packages`
      );
    case "crm_get_deal_date_offers":
      return client.request(
        `/api/v1/deals/${encodeURIComponent(str(args.recordId))}/date-offers`
      );

    // ── Quotation writes ────────────────────────────────────────────────
    case "crm_update_deal_quotation": {
      // PUT replaces the quotation: omitted fields are reset, not preserved.
      // Read crm_get_deal_quotation first and merge, or fields silently drop.
      const body: Record<string, unknown> = {
        isVariable: bool(args.isVariable) ?? false,
      };
      for (const key of [
        "fixedPrice",
        "notes",
        "depositRequiredCents",
        "paymentMethodPreference",
        "validUntil",
        "summary",
        "showStandardInclusions",
        "selectedPackageSlug",
        "calculationAssumptions",
        "lineItems",
      ]) {
        if (args[key] !== undefined) body[key] = args[key];
      }
      return client.request(
        `/api/v1/deals/${encodeURIComponent(str(args.recordId))}/quotation`,
        { method: "PUT", body }
      );
    }
    case "crm_set_deal_anzahlung": {
      const body: Record<string, unknown> = {};
      if (args.depositRequiredCents !== undefined) {
        body.depositRequiredCents = args.depositRequiredCents;
      }
      if (args.paymentMethodPreference !== undefined) {
        body.paymentMethodPreference = args.paymentMethodPreference;
      }
      return client.request(
        `/api/v1/deals/${encodeURIComponent(str(args.recordId))}/quotation/anzahlung`,
        { method: "PATCH", body }
      );
    }

    // ── Documents (PDFs rendered by crm-tools on the VPS) ────────────────
    case "crm_get_deal_document":
      return client.request(
        `/api/v1/deals/${encodeURIComponent(str(args.recordId))}/documents/${encodeURIComponent(str(args.documentId))}`
      );
    case "crm_generate_document":
      return client.request("/api/tools/run", {
        method: "POST",
        body: {
          skill: str(args.skill || "rechnungen-und-auftragsbestaetigungen"),
          params: {
            ...(asBody(args.params) as Record<string, unknown> | undefined),
            _deal_record_id: str(args.recordId),
            ...(args.imageAttachmentIds !== undefined
              ? { _image_attachment_ids: args.imageAttachmentIds }
              : {}),
          },
        },
      });
    case "crm_get_document_job":
      return client.request(
        `/api/tools/jobs/${encodeURIComponent(str(args.jobId))}`
      );
    case "crm_store_document_job":
      return client.request(
        `/api/tools/jobs/${encodeURIComponent(str(args.jobId))}/store-as-document`,
        {
          method: "POST",
          body: {
            dealRecordId: str(args.recordId),
            ...(args.documentType !== undefined
              ? { documentType: args.documentType }
              : {}),
          },
        }
      );

    case "crm_list_employees":
      return client.request("/api/v1/employees");
    case "crm_get_financial_overview":
      return client.request("/api/v1/financial/overview");
    case "crm_list_financial_bookings":
      return client.request("/api/v1/financial/bookings", {
        query: { limit: num(args.limit), offset: num(args.offset) },
      });

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

    case "crm_list_agent_drafts":
      return client.request("/api/v1/agent-drafts");
    case "crm_get_agent_settings":
      return client.request("/api/v1/agent-settings");

    case "crm_api": {
      const path = str(args.path);
      if (!path.startsWith("/api/")) {
        throw new Error("path must start with /api/");
      }
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
