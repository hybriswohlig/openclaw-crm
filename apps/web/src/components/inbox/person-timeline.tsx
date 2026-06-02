// Merged person timeline (KOT-IDENTITY Phase 5b, read view).
// Shows all of a person's messages across channels in one chronological stream,
// each bubble tagged with its channel. Read-only; replying happens by switching
// to a single channel (the operator picks one in the bar above).
"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface TimelineMsg {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  sentAt: string | null;
  channelType: "email" | "whatsapp" | "sms";
  isKleinanzeigen: boolean;
  attachments: { id: string; fileName: string; mimeType: string; fileSize: number }[];
}

function channelMeta(m: TimelineMsg): { label: string; cls: string } {
  if (m.isKleinanzeigen) return { label: "Kleinanzeigen", cls: "bg-[#e8f3d6] text-[#5a7a1e]" };
  if (m.channelType === "whatsapp") return { label: "WhatsApp", cls: "bg-[#dcf8e8] text-[#1c7a47]" };
  if (m.channelType === "sms") return { label: "SMS", cls: "bg-blue-100 text-blue-700" };
  return { label: "E-Mail", cls: "bg-muted text-muted-foreground" };
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Heute";
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Gestern";
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });
}

export function PersonTimeline({ conversationIds }: { conversationIds: string[] }) {
  const idKey = conversationIds.join(",");
  const [msgs, setMsgs] = useState<TimelineMsg[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    fetch(`/api/v1/inbox/person-thread?ids=${encodeURIComponent(idKey)}`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((d) => { if (!cancel) setMsgs((d.data ?? []) as TimelineMsg[]); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [idKey]);

  if (loading) {
    return <div className="flex-1 flex justify-center items-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  let lastDay = "";
  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1.5 bg-muted/20">
      {msgs.length === 0 && <p className="text-center text-sm text-muted-foreground py-8">Keine Nachrichten.</p>}
      {msgs.map((m) => {
        const meta = channelMeta(m);
        const isOut = m.direction === "outbound";
        const day = m.sentAt ? dayLabel(m.sentAt) : "";
        const showDay = day !== lastDay;
        lastDay = day;
        return (
          <div key={m.id}>
            {showDay && day && <div className="text-center text-[10px] uppercase tracking-wide text-muted-foreground my-3">{day}</div>}
            <div className={cn("flex", isOut ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[78%] rounded-2xl px-3 py-2", isOut ? "bg-foreground text-background" : "bg-background border border-border")}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={cn("inline-flex rounded px-1 py-px text-[8px] font-semibold leading-none", meta.cls)}>{meta.label}</span>
                  <span className={cn("text-[9px] tabular-nums", isOut ? "opacity-70" : "text-muted-foreground")}>
                    {m.sentAt ? new Date(m.sentAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : ""}
                  </span>
                </div>
                {m.body && <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>}
                {m.attachments.map((a) =>
                  a.mimeType.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={a.id} src={`/api/v1/inbox/attachments/${a.id}/content`} alt={a.fileName} className="mt-1.5 rounded-lg max-h-56 object-cover" />
                  ) : (
                    <div key={a.id} className="mt-1.5 text-xs underline truncate">{a.fileName}</div>
                  )
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
