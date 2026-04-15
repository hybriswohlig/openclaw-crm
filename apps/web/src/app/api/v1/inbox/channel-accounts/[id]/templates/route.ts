import { NextRequest } from "next/server";
import {
  getAuthContext,
  unauthorized,
  success,
  badRequest,
} from "@/lib/api-utils";
import { fetchWhatsAppTemplates } from "@/services/inbox-whatsapp";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;
  try {
    const templates = await fetchWhatsAppTemplates(id, ctx.workspaceId);
    return success(templates);
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Failed to fetch templates");
  }
}
