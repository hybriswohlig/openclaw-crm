import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, notFound } from "@/lib/api-utils";
import { db } from "@/db";
import { and, eq } from "drizzle-orm";
import {
  inboxConversations,
  inboxContacts,
  channelAccounts,
} from "@/db/schema/inbox";
import { getMessages } from "@/services/inbox";
import { runAITask } from "@/services/ai/run-task";
import { AI_TASK_SLUGS } from "@/services/ai/task-registry";

/**
 * POST /api/v1/inbox/conversations/[id]/suggest-reply
 *
 * Generates a short reply suggestion for the conversation. Gated to manual
 * invocation only — never auto-runs. Uses the existing `deal.draft-reply`
 * AI task slug; the provider/key come from that task's ai_task_configs row
 * (crm-tools by default, OpenRouter only if the task is set to it).
 *
 * Returns `{ text: string }` on success, or `{ error: string }` on failure
 * (UI hides the suggestion bubble when there's no text).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getAuthContext(req);
    if (!ctx) return unauthorized();

    const { id } = await params;

    const [conv] = await db
      .select({
        id: inboxConversations.id,
        contactName: inboxContacts.displayName,
        contactEmail: inboxContacts.email,
        contactPhone: inboxContacts.phone,
        channelType: channelAccounts.channelType,
      })
      .from(inboxConversations)
      .innerJoin(
        inboxContacts,
        eq(inboxConversations.contactId, inboxContacts.id)
      )
      .innerJoin(
        channelAccounts,
        eq(inboxConversations.channelAccountId, channelAccounts.id)
      )
      .where(
        and(
          eq(inboxConversations.id, id),
          eq(inboxConversations.workspaceId, ctx.workspaceId)
        )
      )
      .limit(1);
    if (!conv) return notFound("Conversation not found");

    const messages = await getMessages(id, ctx.workspaceId);
    if (messages.length === 0) {
      return NextResponse.json({ text: null, reason: "Keine Nachrichten." });
    }

    const lastInbound = [...messages]
      .reverse()
      .find((m) => m.direction === "inbound");
    if (!lastInbound) {
      return NextResponse.json({ text: null, reason: "Keine Eingangsnachricht." });
    }

    // Last 6 messages as compact transcript
    const transcript = messages
      .slice(-6)
      .map((m) => {
        const who = m.direction === "outbound" ? "Wir" : "Kunde";
        const time = (m.sentAt ?? m.createdAt)?.toString().slice(0, 16) ?? "";
        return `[${time}] ${who}: ${(m.body ?? "").trim()}`;
      })
      .join("\n");

    const contact =
      conv.contactName ?? conv.contactEmail ?? conv.contactPhone ?? "Kunde";

    const system = `Du bist Assistent für ein deutsches Umzugsunternehmen ("Kottke Umzüge").
Du schreibst KURZE, freundliche Antwortvorschläge (max. 2 Sätze) auf die letzte Kundennachricht.
Sprich den Kunden persönlich an. Verwende "Du" oder "Sie" je nach Tonfall im bisherigen Gespräch.
Antworte NUR mit dem Vorschlagstext — keine Anführungszeichen, keine Anrede-Zeile, keine Meta-Kommentare.`;

    const prompt = `Kunde: ${contact}
Kanal: ${conv.channelType}
Letzte Nachrichten:
${transcript}

Vorschlag für die nächste Antwort:`;

    const result = await runAITask({
      workspaceId: ctx.workspaceId,
      taskSlug: AI_TASK_SLUGS.DEAL_DRAFT_REPLY,
      system,
      prompt,
    });

    if (!result.ok) {
      return NextResponse.json(
        { text: null, error: result.error },
        { status: 200 }
      );
    }

    const text = String(result.output ?? "").trim();
    if (!text) {
      return NextResponse.json({ text: null, reason: "Leere Antwort." });
    }

    return NextResponse.json({ text });
  } catch (err) {
    console.error("POST /inbox/conversations/[id]/suggest-reply error:", err);
    return NextResponse.json(
      { text: null, error: "Vorschlag konnte nicht erstellt werden." },
      { status: 500 }
    );
  }
}
