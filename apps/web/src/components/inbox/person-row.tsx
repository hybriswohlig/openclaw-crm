// Person-centric inbox row (KOT-IDENTITY Phase 5b).
// One row per golden person (their conversations across channels are bundled),
// with a quick-actions menu: Lead öffnen, Anrufen, Erledigt, Spam. Dokumente
// (Auftragsbestätigung / Rechnung) live im Kontext-Panel der offenen
// Konversation.
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { ExternalLink, Phone, Check, Ban, MoreVertical } from "lucide-react";
import { ChannelAvatar, type LastChannel } from "@/components/inbox/channel-logos";

export interface PersonRowData {
  name: string;
  channels: { kleinanzeigen: boolean; whatsapp: boolean; email: boolean; sms: boolean };
  /** Platform of the most recent conversation — drives the avatar. */
  lastChannel: LastChannel;
  unread: number;
  conversationCount: number;
  dealRecordId: string | null;
  phone: string | null;
  email: string | null;
  firma: "kottke" | "ceylan";
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  latestConversationId: string;
  /** Agent classification (KI-Assistent flags) for the inbox badges. */
  agentStage?: string | null;
  agentPriority?: "hoch" | "mittel" | "niedrig" | null;
  agentMissing?: string[] | null;
}

const STAGE_META: Record<string, { label: string; className: string }> = {
  neu: { label: "Neu", className: "bg-muted text-muted-foreground" },
  sammelt_infos: { label: "Sammelt Infos", className: "bg-sky-100 text-sky-700" },
  bereit_kalkulieren: { label: "Bereit zum Kalkulieren", className: "bg-emerald-100 text-emerald-700" },
  angebot_raus: { label: "Angebot raus", className: "bg-violet-100 text-violet-700" },
  wartet_kunde: { label: "Wartet auf Kunde", className: "bg-amber-100 text-amber-700" },
  verloren: { label: "Verloren", className: "bg-rose-100 text-rose-600" },
};

const PRIORITY_DOT: Record<string, string> = {
  hoch: "bg-rose-500",
  mittel: "bg-amber-400",
  niedrig: "bg-muted-foreground/40",
};

function timeLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Gestern";
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

function ChannelBadge({ label, className }: { label: string; className: string }) {
  return (
    <span className={cn("inline-flex items-center rounded px-1 py-px text-[9px] font-semibold leading-none", className)}>
      {label}
    </span>
  );
}

interface Props {
  data: PersonRowData;
  active: boolean;
  onClick: () => void;
  onStatusChange: (status: "resolved" | "spam") => void;
}

export function PersonRow({ data, active, onClick, onStatusChange }: Props) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasDeal = !!data.dealRecordId;

  const act = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    fn();
  };

  return (
    <div
      onClick={onClick}
      className={cn(
        "group relative flex gap-3 px-4 py-3 cursor-pointer border-b border-border/50 transition-colors",
        active
          ? "bg-card shadow-[inset_3px_0_0_var(--kottke-accent)]"
          : "hover:bg-card/60"
      )}
    >
      {/* Avatar — shows the last platform we wrote with the person on */}
      <div className="relative shrink-0">
        <ChannelAvatar channel={data.lastChannel} size="md" />
        {data.unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
            {data.unread}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {data.agentPriority && (
            <span
              title={`Priorität: ${data.agentPriority}`}
              className={cn("shrink-0 h-2 w-2 rounded-full", PRIORITY_DOT[data.agentPriority] ?? "bg-muted-foreground/40")}
            />
          )}
          <span className="font-medium truncate">{data.name}</span>
          {data.conversationCount > 1 && (
            <span className="shrink-0 text-[9px] text-muted-foreground rounded-full border border-border px-1.5 leading-tight">
              {data.conversationCount} Kanäle
            </span>
          )}
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground tabular-nums">{timeLabel(data.lastMessageAt)}</span>
        </div>
        {data.lastMessagePreview && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">{data.lastMessagePreview}</p>
        )}
        <div className="flex items-center gap-1 mt-1 flex-wrap">
          {data.agentStage && STAGE_META[data.agentStage] && (
            <span
              className={cn(
                "inline-flex items-center rounded px-1.5 py-px text-[9px] font-semibold leading-none",
                STAGE_META[data.agentStage].className
              )}
            >
              {STAGE_META[data.agentStage].label}
            </span>
          )}
          {data.channels.kleinanzeigen && <ChannelBadge label="Kleinanzeigen" className="bg-[#e8f3d6] text-[#5a7a1e]" />}
          {data.channels.whatsapp && <ChannelBadge label="WhatsApp" className="bg-[#dcf8e8] text-[#1c7a47]" />}
          {data.channels.email && <ChannelBadge label="E-Mail" className="bg-muted text-muted-foreground" />}
          {data.channels.sms && <ChannelBadge label="SMS" className="bg-blue-100 text-blue-700" />}
          {data.agentMissing && data.agentMissing.length > 0 && (
            <span className="text-[9px] text-muted-foreground">fehlt: {data.agentMissing.join(", ")}</span>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="shrink-0 self-center relative">
        <button
          aria-label="Schnellaktionen"
          onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
          className={cn(
            "h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground",
            menuOpen ? "bg-muted text-foreground" : "opacity-0 group-hover:opacity-100 focus:opacity-100"
          )}
        >
          <MoreVertical className="h-4 w-4" />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }} />
            <div
              className="absolute right-0 top-8 z-50 w-56 rounded-lg border border-border bg-popover shadow-lg py-1 text-sm"
              onMouseLeave={() => { closeTimer.current = setTimeout(() => setMenuOpen(false), 400); }}
              onMouseEnter={() => { if (closeTimer.current) clearTimeout(closeTimer.current); }}
            >
              <MenuItem icon={<ExternalLink className="h-4 w-4" />} disabled={!hasDeal} onClick={act(() => router.push(`/objects/deals/${data.dealRecordId}`))}>
                Lead öffnen
              </MenuItem>
              {data.phone && (
                <MenuItem icon={<Phone className="h-4 w-4" />} onClick={act(() => { window.location.href = `tel:${data.phone}`; })}>
                  Anrufen
                </MenuItem>
              )}
              <div className="my-1 h-px bg-border" />
              <MenuItem icon={<Check className="h-4 w-4" />} onClick={act(() => onStatusChange("resolved"))}>
                Als erledigt markieren
              </MenuItem>
              <MenuItem icon={<Ban className="h-4 w-4" />} onClick={act(() => onStatusChange("spam"))}>
                Als Spam markieren
              </MenuItem>
            </div>
          </>
        )}
      </div>

    </div>
  );
}

function MenuItem({ icon, children, onClick, disabled }: { icon: React.ReactNode; children: React.ReactNode; onClick: (e: React.MouseEvent) => void; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors",
        disabled ? "text-muted-foreground/40 cursor-not-allowed" : "hover:bg-muted text-foreground"
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{children}</span>
    </button>
  );
}
