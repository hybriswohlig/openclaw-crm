// Chat history export — formats a conversation + messages into LLM-friendly
// payloads (Markdown for prose pasting, JSON for structured prompts) and
// writes the result to the clipboard.

type ChannelType = "email" | "whatsapp";
type ConversationStatus = "open" | "resolved" | "spam";

interface ExportAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

interface ExportMessage {
  id: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  status: string;
  fromAddress: string | null;
  toAddress: string | null;
  subject: string | null;
  body: string;
  isRead: boolean;
  sentAt: string | null;
  createdAt: string;
  attachments?: ExportAttachment[];
}

interface ExportConversation {
  id: string;
  channelType: ChannelType;
  channelName: string;
  channelAddress: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  subject: string | null;
  status: ConversationStatus;
}

function fmtTs(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function senderLabel(msg: ExportMessage, conv: ExportConversation): string {
  if (msg.direction === "outbound") {
    return `Wir (${conv.channelName})`;
  }
  const name = conv.contactName?.trim();
  const addr =
    msg.fromAddress ?? conv.contactEmail ?? conv.contactPhone ?? "Lead";
  return name ? `${name} <${addr}>` : addr;
}

function channelDisplay(t: ChannelType): string {
  return t === "whatsapp" ? "WhatsApp" : "E-Mail";
}

export function formatChatAsMarkdown(
  conv: ExportConversation,
  messages: ExportMessage[],
): string {
  const headerLines = [
    `# Chatverlauf — ${conv.contactName ?? conv.contactEmail ?? conv.contactPhone ?? "Unbekannt"}`,
    ``,
    `- **Kanal:** ${channelDisplay(conv.channelType)} (${conv.channelName})`,
  ];
  if (conv.contactEmail) headerLines.push(`- **E-Mail:** ${conv.contactEmail}`);
  if (conv.contactPhone) headerLines.push(`- **Telefon:** ${conv.contactPhone}`);
  if (conv.subject) headerLines.push(`- **Betreff:** ${conv.subject}`);
  headerLines.push(`- **Status:** ${conv.status}`);
  headerLines.push(`- **Nachrichten:** ${messages.length}`);
  headerLines.push(``, `---`, ``);

  const body = messages
    .map((msg) => {
      const ts = fmtTs(msg.sentAt ?? msg.createdAt);
      const who = senderLabel(msg, conv);
      const arrow = msg.direction === "inbound" ? "←" : "→";
      const lines: string[] = [`## ${arrow} ${who} · ${ts}`];
      if (msg.subject && msg.subject !== conv.subject) {
        lines.push(``, `**Betreff:** ${msg.subject}`);
      }
      const trimmed = (msg.body ?? "").trim();
      if (trimmed) {
        lines.push(``, trimmed);
      } else {
        lines.push(``, `_(leerer Nachrichtentext)_`);
      }
      if (msg.attachments && msg.attachments.length > 0) {
        lines.push(``, `**Anhänge:**`);
        for (const a of msg.attachments) {
          const kb = Math.max(1, Math.round(a.fileSize / 1024));
          lines.push(`- ${a.fileName} (${a.mimeType}, ${kb} KB)`);
        }
      }
      return lines.join("\n");
    })
    .join("\n\n");

  return `${headerLines.join("\n")}${body}\n`;
}

export function formatChatAsJSON(
  conv: ExportConversation,
  messages: ExportMessage[],
): string {
  const payload = {
    conversation: {
      id: conv.id,
      channel: conv.channelType,
      channelName: conv.channelName,
      channelAddress: conv.channelAddress,
      status: conv.status,
      subject: conv.subject,
      contact: {
        name: conv.contactName,
        email: conv.contactEmail,
        phone: conv.contactPhone,
      },
    },
    messageCount: messages.length,
    exportedAt: new Date().toISOString(),
    messages: messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      from: m.fromAddress,
      to: m.toAddress,
      subject: m.subject,
      timestamp: m.sentAt ?? m.createdAt,
      body: m.body ?? "",
      attachments:
        m.attachments?.map((a) => ({
          fileName: a.fileName,
          mimeType: a.mimeType,
          fileSize: a.fileSize,
        })) ?? [],
    })),
  };
  return JSON.stringify(payload, null, 2);
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy path
  }
  try {
    if (typeof document === "undefined") return false;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
