"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, MessageCircle, Mail } from "lucide-react";

interface LinkedConversation {
  id: string;
  channelType: "email" | "whatsapp";
  channelName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  subject: string | null;
  status: "open" | "resolved" | "spam";
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  messageCount: number;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Gestern";
  if (diffDays < 7) return d.toLocaleDateString("de-DE", { weekday: "short" });
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function RecordConversations({
  objectSlug,
  recordId,
}: {
  objectSlug: string;
  recordId: string;
}) {
  const [conversations, setConversations] = useState<LinkedConversation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/v1/objects/${objectSlug}/records/${recordId}/conversations`
      );
      if (res.ok) {
        const data = await res.json();
        setConversations(data.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [objectSlug, recordId]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Lade Konversationen…
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        Keine verknüpften Konversationen gefunden.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {conversations.map((conv) => (
        <a
          key={conv.id}
          href="/inbox"
          className="flex items-start gap-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors"
        >
          {/* Channel icon */}
          <div className="shrink-0 mt-0.5">
            <div className={`h-9 w-9 rounded-full flex items-center justify-center ${
              conv.channelType === "whatsapp"
                ? "bg-[#25D366]/10"
                : "bg-primary/10"
            }`}>
              {conv.channelType === "whatsapp" ? (
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="#25D366">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
              ) : (
                <Mail className="h-4 w-4 text-primary" />
              )}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-sm font-medium truncate">
                  {conv.contactName ?? conv.contactEmail ?? conv.contactPhone ?? "Unbekannt"}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                  conv.channelType === "whatsapp"
                    ? "bg-[#25D366]/10 text-[#128C4F] border-[#25D366]/20"
                    : "bg-primary/10 text-primary border-primary/20"
                }`}>
                  {conv.channelType === "whatsapp" ? "WhatsApp" : "E-Mail"}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                  conv.status === "open"
                    ? "bg-blue-500/10 text-blue-600 border-blue-500/20"
                    : conv.status === "resolved"
                      ? "bg-green-500/10 text-green-600 border-green-500/20"
                      : "bg-red-500/10 text-red-600 border-red-500/20"
                }`}>
                  {conv.status === "open" ? "Offen" : conv.status === "resolved" ? "Erledigt" : "Spam"}
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                {fmtTime(conv.lastMessageAt)}
              </span>
            </div>

            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-muted-foreground truncate">
                {conv.channelName}
              </span>
              <span className="text-[10px] text-muted-foreground">
                · {conv.messageCount} Nachrichten
              </span>
            </div>

            {conv.lastMessagePreview && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {conv.lastMessagePreview}
              </p>
            )}
          </div>

          {/* Unread badge */}
          {conv.unreadCount > 0 && (
            <span className="h-5 min-w-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center shrink-0 self-center">
              {conv.unreadCount}
            </span>
          )}
        </a>
      ))}
    </div>
  );
}
