import { NextRequest } from "next/server";
import {
  getAuthContext,
  unauthorized,
  success,
  badRequest,
} from "@/lib/api-utils";
import {
  getTemplateMetadataForAccount,
  setTemplateLabels,
} from "@/services/inbox-whatsapp";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  try {
    const rows = await getTemplateMetadataForAccount(id, ctx.workspaceId);
    return success(rows);
  } catch (err) {
    return badRequest(
      err instanceof Error ? err.message : "Failed to fetch metadata"
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { templateName, languageCode, variableLabels } = body as {
    templateName?: string;
    languageCode?: string;
    variableLabels?: Record<string, string>;
  };
  if (!templateName || !languageCode || typeof variableLabels !== "object") {
    return badRequest(
      "templateName, languageCode and variableLabels are required"
    );
  }
  try {
    await setTemplateLabels({
      channelAccountId: id,
      workspaceId: ctx.workspaceId,
      templateName,
      languageCode,
      variableLabels,
    });
    return success({ ok: true });
  } catch (err) {
    return badRequest(
      err instanceof Error ? err.message : "Failed to save metadata"
    );
  }
}
