import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, success, badRequest } from "@/lib/api-utils";
import { sendNewEmail, EmailUserError } from "@/services/inbox-email";

/**
 * Compose and send a brand-new email (not a reply) from one of the workspace's
 * email channel accounts. Returns the new conversation id so the UI can open it.
 */
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { channelAccountId, to, subject, body } = await req.json().catch(() => ({}));
  if (!channelAccountId || !to?.trim() || !body?.trim()) {
    return badRequest("channelAccountId, to und body sind erforderlich");
  }

  try {
    const result = await sendNewEmail({
      workspaceId: ctx.workspaceId,
      channelAccountId,
      to,
      subject: subject ?? "",
      body,
    });
    return success(result);
  } catch (err) {
    // Safe, user-facing validation errors pass through; anything else (transport
    // / library failure) is logged server-side and returned generic so we don't
    // leak SMTP hosts or auth-failure detail to the browser.
    if (err instanceof EmailUserError) return badRequest(err.message);
    console.error("[inbox/email/compose]", err);
    return NextResponse.json(
      { error: { code: "SEND_FAILED", message: "Senden fehlgeschlagen" } },
      { status: 502 }
    );
  }
}
