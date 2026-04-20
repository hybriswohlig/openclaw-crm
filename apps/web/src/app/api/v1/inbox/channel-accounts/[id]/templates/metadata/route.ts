import { NextRequest } from "next/server";
import {
  getAuthContext,
  unauthorized,
  success,
  badRequest,
} from "@/lib/api-utils";
import {
  getTemplateMetadataForAccount,
  upsertTemplateMetadata,
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
  const { templateName, languageCode, variableLabels, headerImageUrl } =
    body as {
      templateName?: string;
      languageCode?: string;
      variableLabels?: Record<string, string>;
      headerImageUrl?: string | null;
    };
  if (!templateName || !languageCode) {
    return badRequest("templateName and languageCode are required");
  }
  if (variableLabels === undefined && headerImageUrl === undefined) {
    return badRequest(
      "At least one of variableLabels or headerImageUrl must be provided"
    );
  }
  try {
    await upsertTemplateMetadata({
      channelAccountId: id,
      workspaceId: ctx.workspaceId,
      templateName,
      languageCode,
      variableLabels:
        variableLabels && typeof variableLabels === "object"
          ? variableLabels
          : undefined,
      headerImageUrl:
        headerImageUrl === undefined
          ? undefined
          : typeof headerImageUrl === "string" && headerImageUrl.trim()
            ? headerImageUrl.trim()
            : null,
    });
    return success({ ok: true });
  } catch (err) {
    return badRequest(
      err instanceof Error ? err.message : "Failed to save metadata"
    );
  }
}
