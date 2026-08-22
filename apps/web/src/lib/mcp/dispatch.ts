import type { CrmClient } from "./client";
import { formatToolError, formatToolResult } from "./client";
import {
  base64ByteLength,
  isRenderableImage,
  MAX_MCP_INLINE_BYTES_LIMIT,
  normaliseImageMime,
  resolveMaxBytes,
  type AttachmentPayload,
} from "@/lib/attachment-content";

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

export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export async function handleTool(
  client: CrmClient,
  name: string,
  args: Args
): Promise<{ content: ToolContent[]; isError?: boolean }> {
  try {
    const data = await dispatch(client, name, args);
    if (name === "crm_get_attachment") {
      return { content: attachmentContent(data as AttachmentPayload, args) };
    }
    return { content: [{ type: "text", text: formatToolResult(data) }] };
  } catch (err) {
    return {
      content: [{ type: "text", text: formatToolError(err) }],
      isError: true,
    };
  }
}

/**
 * Turn one attachment into content an agent can actually use.
 *
 * A base64 blob inside a text block is unreadable to a vision model — it sees
 * 300 KB of characters, not a kitchen. MCP's image content block is the only
 * form that reaches the model as pixels, so that is the default; the metadata
 * rides alongside as text. `format` lets a client that cannot render image
 * blocks ask for the raw base64 instead, and the text block always says so,
 * because a silent "no image" is what sent agents back to crm_api last time.
 */
function attachmentContent(payload: AttachmentPayload, args: Args): ToolContent[] {
  const format = str(args.format || "image").toLowerCase();
  const maxBytes = resolveMaxBytes(num(args.maxBytes));
  const byteLength = base64ByteLength(payload.contentBase64);
  const renderable = isRenderableImage(payload.mimeType);
  const withinBudget = byteLength <= maxBytes;

  // One budget, one meaning: the most bytes this tool result may carry, in
  // either form. Gating only the image block would have let a 9 MB inbox video
  // through as base64 and blown up the JSON-RPC response — the largest
  // attachment in production is exactly that.
  const wantImage =
    format !== "base64" && renderable && withinBudget && byteLength > 0;
  const wantBase64 =
    withinBudget && (format === "base64" || format === "both" || !wantImage);

  const meta: Record<string, unknown> = {
    id: payload.id,
    fileName: payload.fileName,
    mimeType: payload.mimeType,
    fileSize: payload.fileSize,
    byteLength,
    isImage: renderable,
    conversationId: payload.conversationId,
    messageId: payload.messageId,
    dealRecordId: payload.dealRecordId,
    createdAt: payload.createdAt,
  };
  if (payload.transcript) meta.transcript = payload.transcript;

  if (wantImage && !wantBase64) {
    meta.contentDelivery = "image_block";
    meta.hint =
      "The pixels are in the image content block of this result. If your " +
      "client did not render it, call crm_get_attachment again with " +
      "format: 'base64' and decode contentBase64 yourself.";
  } else if (wantImage && wantBase64) {
    meta.contentDelivery = "image_block+base64";
    meta.contentBase64 = payload.contentBase64;
    meta.hint =
      "The pixels are in the image content block of this result; the same " +
      "bytes are also in contentBase64 here. Nothing further to fetch.";
  } else if (wantBase64) {
    meta.contentDelivery = "base64";
    meta.contentBase64 = payload.contentBase64;
    if (!renderable) {
      meta.hint =
        `${payload.mimeType} is not a renderable image type, so no image block ` +
        "was attached. Decode contentBase64 to get the original file.";
    } else if (byteLength === 0) {
      meta.hint =
        "This attachment is stored with empty content — there are no bytes to " +
        "show. Treat it as missing rather than as an empty photo.";
    }
  }
  if (!withinBudget) {
    // Say so instead of silently truncating, and name both ways out. The bytes
    // stay reachable: GET /api/v1/inbox/attachments/{id} has no size ceiling.
    meta.contentDelivery = "omitted_too_large";
    // Only offer "raise maxBytes" when raising it could actually work — past
    // the hard ceiling that advice would send the caller in a circle.
    const raisable = byteLength <= MAX_MCP_INLINE_BYTES_LIMIT;
    meta.hint =
      `${byteLength} bytes exceeds the ${maxBytes}-byte budget for one tool ` +
      "result, so no bytes were inlined. " +
      (raisable
        ? `Re-call with maxBytes above ${byteLength} (hard ceiling ` +
          `${MAX_MCP_INLINE_BYTES_LIMIT}), or fetch `
        : `This is past the ${MAX_MCP_INLINE_BYTES_LIMIT}-byte hard ceiling, so ` +
          "no maxBytes will inline it — fetch ") +
      `GET /api/v1/inbox/attachments/${payload.id} directly, which is uncapped.`;
  }

  const content: ToolContent[] = [{ type: "text", text: formatToolResult(meta) }];
  if (wantImage) {
    content.push({
      type: "image",
      data: payload.contentBase64,
      mimeType: normaliseImageMime(payload.mimeType),
    });
  }
  return content;
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
    case "crm_get_attachment":
      // Bytes, not metadata: the JSON twin of the /content stream. recordId is
      // optional extra scoping — the workspace filter is applied server-side
      // either way, so a foreign id is a 404 whether or not it is passed.
      return client.request(
        `/api/v1/inbox/attachments/${encodeURIComponent(str(args.id))}`,
        {
          query: {
            dealRecordId: args.recordId === undefined ? undefined : str(args.recordId),
          },
        }
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
    case "crm_update_deal_package_options": {
      const body: Record<string, unknown> = {
        options: asBody(args.options) ?? [],
      };
      return client.request(
        `/api/v1/deals/${encodeURIComponent(str(args.recordId))}/package-options`,
        { method: "PUT", body }
      );
    }
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

    // ── Projekte ────────────────────────────────────────────────────────
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
      // Only forward what the caller actually sent. An explicit `undefined`
      // survives JSON.stringify as a missing key, but building the body by
      // hand keeps the create and update paths reading identically.
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
        // never a flat id list — `parseProjectInput` silently drops any
        // other key, including `memberUserIds`, so the mapping happens here
        // rather than trusting the route to do it. Omitting `role` lets the
        // service default it to 'mitglied'.
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
      // One route, two verbs: PUT pins, DELETE unpins. Defaulting to pin
      // matches the tool name reading as an imperative.
      const favorite = bool(args.favorite) ?? true;
      return client.request(
        `/api/v1/projects/${encodeURIComponent(str(args.projectId))}/favorite`,
        { method: favorite ? "PUT" : "DELETE" }
      );
    }

    // ── Phasen ──────────────────────────────────────────────────────────
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

    // ── Meilensteine ────────────────────────────────────────────────────
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

    // ── Mitglieder ──────────────────────────────────────────────────────
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

    // ── Risiken ─────────────────────────────────────────────────────────
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

    // ── Budget ──────────────────────────────────────────────────────────
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
