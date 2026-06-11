"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Loader2,
  RefreshCw,
  Mail,
  MessageCircle,
  Search,
  CheckCheck,
  AlertCircle,
  AlertTriangle,
  Send,
  ArrowLeft,
  MoreVertical,
  X,
  Check,
  PenSquare,
  Pencil,
  Inbox as InboxIcon,
  Archive,
  Paperclip,
  FileText,
  Copy,
  Braces,
  Sparkles,
  ListPlus,
  Phone,
  ExternalLink,
  Bot,
  PanelRight,
  Ban,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  formatChatAsMarkdown,
  formatChatAsJSON,
  copyTextToClipboard,
} from "./chat-export";
import {
  DraftSuggestionBanner,
  isDraftBannerEnabled,
  markDraftConsumed,
  type DraftSuggestion,
} from "@/components/chat/draft-suggestion-banner";
import { CustomerLinkComposer } from "@/components/inbox/customer-link-composer";
import { InboxContextPanel } from "@/components/inbox/context-panel";
import { ChannelAvatar, type LastChannel } from "@/components/inbox/channel-logos";
import type { AgentStage } from "@/db/schema/inbox";
import { normalizeAgentStage } from "@/lib/agent-stage";

// Funnel stages for the inbox filter chips. Order = funnel order; each carries
// its own dot + active tint so they're distinguishable at a glance.
const STAGE_FILTERS: Array<{
  value: AgentStage;
  label: string;
  dot: string;
  activeClass: string;
}> = [
  { value: "erstkontakt", label: "Erstkontakt", dot: "bg-slate-400", activeClass: "bg-slate-100 text-slate-700 border-slate-300" },
  { value: "infos_erhalten", label: "Infos erhalten", dot: "bg-sky-500", activeClass: "bg-sky-100 text-sky-700 border-sky-300" },
  { value: "angebot_raus", label: "Angebot raus", dot: "bg-violet-500", activeClass: "bg-violet-100 text-violet-700 border-violet-300" },
  { value: "angenommen", label: "Angenommen", dot: "bg-emerald-500", activeClass: "bg-emerald-100 text-emerald-700 border-emerald-300" },
  { value: "verloren", label: "Verloren", dot: "bg-rose-500", activeClass: "bg-rose-100 text-rose-700 border-rose-300" },
];
import { PersonRow } from "@/components/inbox/person-row";
import { MergeSuggestions } from "@/components/inbox/merge-suggestions";
import { PersonTimeline } from "@/components/inbox/person-timeline";

// ─── Types ────────────────────────────────────────────────────────────────────

type ConversationStatus = "open" | "resolved" | "spam";
type ChannelType = "email" | "whatsapp";

interface ChannelAccount {
  id: string;
  name: string;
  address: string;
  channelType: ChannelType;
  operatingCompanyRecordId: string | null;
  isActive: boolean;
  // WhatsApp transport discriminator. waPhoneNumberId set ⇒ WABA Cloud API
  // (template-only compose). null ⇒ Baileys personal WhatsApp (free-text
  // compose), with baileysBridgeProvider selecting which bridge handles it.
  waPhoneNumberId?: string | null;
  baileysBridgeProvider?: string | null;
}

interface Conversation {
  id: string;
  channelAccountId: string;
  channelType: ChannelType;
  channelName: string;
  channelAddress: string;
  operatingCompanyRecordId: string | null;
  contactId: string;
  crmRecordId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  multiCompanyFlag: boolean;
  subject: string | null;
  status: ConversationStatus;
  lane?: "lead" | "info" | "spam" | "review";
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  dealRecordId: string | null;
  aiPaused?: boolean;
  agentState?: {
    stage?: string;
    priority?: "hoch" | "mittel" | "niedrig";
    missing?: string[];
  } | null;
}

// ─── Person grouping (KOT-IDENTITY Phase 5b) ─────────────────────────────────
// One golden person can have several conversations across channels. We bundle
// them into a single row keyed by the CRM person (crm_record_id), falling back
// to the inbox contact when the person is not yet resolved.
interface PersonGroup {
  key: string;
  name: string;
  conversations: Conversation[]; // newest first
  latest: Conversation;
  channels: { kleinanzeigen: boolean; whatsapp: boolean; email: boolean; sms: boolean };
  unread: number;
  dealRecordId: string | null;
  phone: string | null;
  email: string | null;
  firma: "kottke" | "ceylan";
}

function looksNumeric(name: string | null | undefined): boolean {
  if (!name) return true;
  return !/[a-zA-ZÀ-ſ]/.test(name);
}

function groupConversationsByPerson(convs: Conversation[]): PersonGroup[] {
  const map = new Map<string, Conversation[]>();
  for (const c of convs) {
    const key = c.crmRecordId ?? `contact:${c.contactId}`;
    (map.get(key) ?? map.set(key, []).get(key)!).push(c);
  }
  const groups: PersonGroup[] = [];
  for (const [key, list] of map) {
    list.sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));
    const latest = list[0];
    // Best name: prefer a non-numeric contact name across the person's threads.
    const named = list.find((c) => !looksNumeric(c.contactName));
    const rawName = named?.contactName || latest.contactName || latest.contactPhone || latest.contactEmail || "Unbekannt";
    const name = rawName.replace(/\s*(?:über|ueber|via)\s+Kleinanzeigen\s*$/i, "").trim();
    const channels = { kleinanzeigen: false, whatsapp: false, email: false, sms: false };
    for (const c of list) {
      if (isKleinanzeigenConv(c)) { channels.kleinanzeigen = true; continue; }
      const t = c.channelType as string;
      if (t === "whatsapp") channels.whatsapp = true;
      else if (t === "sms") channels.sms = true;
      else channels.email = true;
    }
    const dealConv = list.find((c) => c.dealRecordId);
    const phone = list.find((c) => c.contactPhone)?.contactPhone ?? null;
    const email = list.find((c) => c.contactEmail && !/@mail\.kleinanzeigen\.de$/i.test(c.contactEmail))?.contactEmail ?? null;
    const firma: "kottke" | "ceylan" = /ceylan/i.test(latest.channelName) ? "ceylan" : "kottke";
    groups.push({
      key, name, conversations: list, latest,
      channels,
      unread: list.reduce((s, c) => s + (c.unreadCount || 0), 0),
      dealRecordId: dealConv?.dealRecordId ?? null,
      phone, email, firma,
    });
  }
  groups.sort((a, b) => (b.latest.lastMessageAt ?? "").localeCompare(a.latest.lastMessageAt ?? ""));
  return groups;
}

interface MessageAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

interface Message {
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
  attachments?: MessageAttachment[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Gestern";
  if (diffDays < 7) return d.toLocaleDateString("de-DE", { weekday: "short" });
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

function fmtFullTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtBubbleTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function fmtDateSeparator(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays === 0) return "Heute";
  if (diffDays === 1) return "Gestern";
  if (diffDays < 7) return d.toLocaleDateString("de-DE", { weekday: "long" });
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });
}

function sameDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

function contactInitial(conv: Conversation): string {
  const name = conv.contactName ?? conv.contactEmail ?? conv.contactPhone ?? "?";
  return name.charAt(0).toUpperCase();
}

function contactLabel(conv: Conversation): string {
  return conv.contactName || conv.contactEmail || conv.contactPhone || "Unbekannt";
}

// ─── Kleinanzeigen detection ──────────────────────────────────────────────────

const KLEINANZEIGEN_RELAY_RE = /@mail\.kleinanzeigen\.de$/i;
const KLEINANZEIGEN_SUBJECT_RE = /kleinanzeigen|nutzer-anfrage|anfrage zu deiner anzeige|zu ihrer anzeige/i;

function isKleinanzeigenConv(conv: Conversation): boolean {
  if (conv.contactEmail && KLEINANZEIGEN_RELAY_RE.test(conv.contactEmail)) return true;
  if (conv.subject && KLEINANZEIGEN_SUBJECT_RE.test(conv.subject)) return true;
  return false;
}

/** The channel a conversation belongs to, with Kleinanzeigen split out of email. */
function lastChannelOf(conv: Conversation): LastChannel {
  if (isKleinanzeigenConv(conv)) return "kleinanzeigen";
  if (conv.channelType === "whatsapp") return "whatsapp";
  if ((conv.channelType as string) === "sms") return "sms";
  return "email";
}

/**
 * Detects whether a phone number is a German mobile (Handy) number.
 * Mobile prefixes after country code: 15x, 16x, 17x.
 * WhatsApp numbers are inherently mobile, so any WhatsApp contact counts.
 */
function isMobilePhone(phone: string | null, isWa: boolean): boolean {
  if (!phone) return false;
  if (isWa) return true;
  const digits = phone.replace(/\D/g, "");
  if (/^49(15|16|17)/.test(digits)) return true;
  if (/^0(15|16|17)/.test(digits)) return true;
  return false;
}

/** Small inline Kleinanzeigen "K" mark. */
function KleinanzeigenLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-[4px] bg-[#96c11f] text-white font-bold",
        className ?? "h-3.5 w-3.5 text-[9px]"
      )}
      aria-label="Kleinanzeigen"
      title="Kleinanzeigen"
    >
      K
    </span>
  );
}

// ─── Channel Icon ─────────────────────────────────────────────────────────────

function ChannelIcon({ type, size = "sm" }: { type: ChannelType; size?: "sm" | "xs" }) {
  const dim = size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5";
  if (type === "whatsapp") {
    return (
      <svg className={dim} viewBox="0 0 24 24" fill="#25D366">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
      </svg>
    );
  }
  return <Mail className={cn(dim, "text-blue-500")} />;
}

// ─── Source Filter Chip ──────────────────────────────────────────────────────

function SourceChip({
  active,
  onClick,
  count,
  activeClass,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  activeClass: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "shrink-0 flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors",
        active ? activeClass : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/60"
      )}
    >
      {children}
      <span className={cn(
        "text-[10px] tabular-nums rounded-full px-1.5 py-px min-w-[18px] text-center",
        active ? "bg-white/25" : "bg-muted text-muted-foreground"
      )}>
        {count}
      </span>
    </button>
  );
}

// ─── Conversation List Item ───────────────────────────────────────────────────

function ConvListItem({
  conv,
  active,
  onClick,
}: {
  conv: Conversation;
  active: boolean;
  onClick: () => void;
}) {
  const isKa = isKleinanzeigenConv(conv);
  const isWa = conv.channelType === "whatsapp";
  const unread = conv.unreadCount > 0;

  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative w-full text-left px-3 py-2.5 transition-colors",
        active ? "" : "hover:bg-muted/50"
      )}
    >
      <div
        className={cn(
          "relative flex items-start gap-3 rounded-xl p-3 border transition-all",
          active
            ? "bg-background border-primary/40 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_12px_-2px_rgba(0,0,0,0.08)]"
            : unread
              ? "bg-background border-border/80"
              : "bg-transparent border-transparent group-hover:border-border/50 group-hover:bg-background"
        )}
      >
        {/* Unread accent bar */}
        {unread && !active && (
          <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-primary" aria-hidden />
        )}

        {/* Avatar with channel badge */}
        <div className="relative shrink-0">
          <div className={cn(
            "h-11 w-11 rounded-full flex items-center justify-center text-sm font-semibold",
            isWa ? "bg-[#25D366]/10 text-[#128C4F]" :
            isKa ? "bg-[#96c11f]/10 text-[#5f7c13]" :
            "bg-primary/10 text-primary"
          )}>
            {contactInitial(conv)}
          </div>
          <div className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-background border border-border flex items-center justify-center shadow-sm">
            {isKa ? (
              <KleinanzeigenLogo className="h-3.5 w-3.5 text-[9px]" />
            ) : (
              <ChannelIcon type={conv.channelType} size="xs" />
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn(
              "text-sm truncate flex-1",
              unread ? "font-semibold text-foreground" : "font-medium text-foreground/90"
            )}>
              {contactLabel(conv)}
            </span>
            <span className={cn(
              "text-[10px] shrink-0 tabular-nums",
              unread ? "text-primary font-semibold" : "text-muted-foreground"
            )}>
              {fmtTime(conv.lastMessageAt)}
            </span>
          </div>

          {conv.subject && !isWa && (
            <p className={cn(
              "text-xs truncate mt-0.5",
              unread ? "text-foreground/80 font-medium" : "text-muted-foreground"
            )}>
              {conv.subject}
            </p>
          )}

          <p className={cn(
            "text-xs truncate mt-0.5",
            unread ? "text-foreground/70" : "text-muted-foreground"
          )}>
            {conv.lastMessagePreview ?? "—"}
          </p>

          {/* Tag pills row */}
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            {isKa ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[#96c11f]/10 text-[#5f7c13] border border-[#96c11f]/20">
                <KleinanzeigenLogo className="h-2.5 w-2.5 text-[7px]" />
                Kleinanzeigen
              </span>
            ) : isWa ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[#25D366]/10 text-[#128C4F] border border-[#25D366]/20">
                <ChannelIcon type="whatsapp" size="xs" />
                WhatsApp
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 border border-blue-500/20">
                <Mail className="h-2.5 w-2.5" />
                E-Mail
              </span>
            )}
            <span className="text-[10px] text-muted-foreground truncate max-w-[160px]">
              {conv.channelName}
            </span>
            {conv.multiCompanyFlag && (
              <span
                className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-700 border border-amber-500/20"
                title="Hat mehrere Unternehmen kontaktiert"
              >
                <AlertTriangle className="h-2.5 w-2.5" />
                Multi
              </span>
            )}
            {unread && !active && (
              <span className="ml-auto h-[18px] min-w-[18px] px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center">
                {conv.unreadCount}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes > 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function MessageAttachmentItem({
  att,
  isOut,
}: {
  att: MessageAttachment;
  isOut: boolean;
}) {
  const url = `/api/v1/inbox/attachments/${att.id}/content`;
  const isImage = att.mimeType.startsWith("image/");

  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={att.fileName}
          className="max-h-80 max-w-full rounded-lg border border-black/10 object-contain bg-white/50"
          loading="lazy"
        />
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs no-underline transition-colors",
        isOut
          ? "bg-white/15 hover:bg-white/25 text-primary-foreground"
          : "bg-background/80 hover:bg-background border border-border text-foreground"
      )}
      download={att.fileName}
    >
      <FileText className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate font-medium">{att.fileName}</span>
      <span className={cn("shrink-0 tabular-nums", isOut ? "opacity-80" : "text-muted-foreground")}>
        {formatFileSize(att.fileSize)}
      </span>
    </a>
  );
}

function MessageBubble({
  msg,
  showAvatar,
  conv,
}: {
  msg: Message;
  showAvatar: boolean;
  conv: Conversation;
}) {
  const isOut = msg.direction === "outbound";
  const time = fmtBubbleTime(msg.sentAt ?? msg.createdAt);
  const fullTime = fmtFullTime(msg.sentAt ?? msg.createdAt);
  const [convertingToTask, setConvertingToTask] = useState(false);
  const [taskCreated, setTaskCreated] = useState(false);

  async function createTaskFromMessage() {
    if (convertingToTask || taskCreated) return;
    setConvertingToTask(true);
    try {
      const snippet = (msg.body ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 100);
      const res = await fetch("/api/v1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: snippet ? `Klären: "${snippet}"` : "Klären: (Nachricht)",
          recordIds: conv.dealRecordId ? [conv.dealRecordId] : [],
        }),
      });
      if (res.ok) setTaskCreated(true);
    } finally {
      setConvertingToTask(false);
      window.setTimeout(() => setTaskCreated(false), 2500);
    }
  }

  return (
    <div className={cn("flex items-end gap-2", isOut ? "justify-end" : "justify-start")}>
      {/* Inbound avatar slot (only on last bubble of a burst) */}
      {!isOut && (
        <div className={cn("shrink-0 w-7", showAvatar ? "" : "invisible")}>
          <ChannelAvatar channel={lastChannelOf(conv)} size="sm" />
        </div>
      )}

      <div
        className={cn(
          "group/bubble max-w-[72%] rounded-2xl px-3.5 py-2 text-sm",
          isOut
            ? "rounded-br-md shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
            : "rounded-bl-md border border-border"
        )}
        style={
          isOut
            ? { background: "var(--bubble-out)", color: "var(--bubble-out-fg)" }
            : { background: "var(--bubble-in)", color: "var(--foreground)" }
        }
      >
        {msg.attachments && msg.attachments.length > 0 && (
          <div className="space-y-1.5 mb-1.5">
            {msg.attachments.map((att) => (
              <MessageAttachmentItem key={att.id} att={att} isOut={isOut} />
            ))}
          </div>
        )}
        {msg.body && (
          <p className="whitespace-pre-wrap break-words leading-snug">{msg.body}</p>
        )}
        <div
          className={cn(
            "flex items-center gap-1 mt-0.5 text-[10px] tabular-nums",
            isOut ? "justify-end opacity-70" : "text-muted-foreground/80"
          )}
          title={fullTime}
        >
          <span>{time}</span>
          {isOut && (
            msg.status === "sent" ? <Check className="h-3 w-3" />
              : msg.status === "delivered" ? <CheckCheck className="h-3 w-3" />
              : msg.status === "read" ? <CheckCheck className="h-3 w-3 text-sky-300" />
              : msg.status === "failed" ? <AlertCircle className="h-3 w-3 text-red-300" />
              : null
          )}
        </div>
      </div>
      {/* "+ Aufgabe" action sits next to inbound bubbles only. On desktop
          it fades in on hover; on touch devices it's always visible. */}
      {!isOut && (
        <button
          type="button"
          onClick={createTaskFromMessage}
          disabled={convertingToTask || taskCreated}
          className={cn(
            "shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-opacity",
            "md:opacity-0 md:group-hover/bubble:opacity-100",
            "hover:text-foreground hover:bg-muted/60",
            taskCreated && "opacity-100 text-emerald-600"
          )}
          title={taskCreated ? "Aufgabe angelegt" : "Aus dieser Nachricht eine Aufgabe erstellen"}
        >
          {convertingToTask ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : taskCreated ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <ListPlus className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </div>
  );
}

// ─── Date Separator ───────────────────────────────────────────────────────────

function DateSeparator({ iso }: { iso: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="flex-1 h-px bg-border/60" />
      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
        {fmtDateSeparator(iso)}
      </span>
      <div className="flex-1 h-px bg-border/60" />
    </div>
  );
}

// ─── Conversation View ────────────────────────────────────────────────────────

function AttachmentPreview({
  file,
  onRemove,
}: {
  file: File;
  onRemove: () => void;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const sizeLabel =
    file.size > 1024 * 1024
      ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(file.size / 1024))} KB`;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={file.name}
          className="h-12 w-12 rounded object-cover border border-border shrink-0"
        />
      ) : (
        <div className="h-12 w-12 rounded bg-background border border-border flex items-center justify-center shrink-0">
          <FileText className="h-5 w-5 text-muted-foreground" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{file.name}</p>
        <p className="text-[11px] text-muted-foreground">{sizeLabel}</p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        title="Entfernen"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ConversationView({
  conv,
  onBack,
  onAgentStageChange,
  onOpenCompose,
  onSetStatus,
  onAiPausedChange,
  onDealLinked,
}: {
  conv: Conversation;
  onBack: () => void;
  onAgentStageChange?: (stage: AgentStage) => void;
  onOpenCompose?: () => void;
  /** Erledigt/Spam-Triage für die geöffnete Konversation (Paket 3). */
  onSetStatus?: (status: ConversationStatus) => void;
  /** Hält aiPaused in der Liste + im selected-Objekt der Seite synchron. */
  onAiPausedChange?: (paused: boolean) => void;
  /** Vom Kontext-Panel: Konversation wurde mit einem Lead verknüpft. */
  onDealLinked?: (dealRecordId: string) => void;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(true);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<{ code?: string; message?: string } | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<"md" | "json" | "error" | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<File | null>(null);
  // Tracks whether the current reply text was seeded from an agent draft note
  // and which note to mark as consumed once the message goes out.
  const [acceptedDraft, setAcceptedDraft] = useState<DraftSuggestion | null>(null);
  // Bumped after a successful send so the banner re-fetches and discovers the
  // freshly flipped `· Übernommen` title (and therefore disappears).
  const [draftRefreshKey, setDraftRefreshKey] = useState(0);
  const draftBannerEnabled = isDraftBannerEnabled();
  // Inline AI suggestion (manual fetch via Sparkles button — never auto-fires)
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [aiSuggestionLoading, setAiSuggestionLoading] = useState(false);

  // Per-conversation sales-agent toggle. Seeded from the list payload and kept
  // in sync when switching conversations.
  const [aiPaused, setAiPaused] = useState<boolean>(conv.aiPaused ?? false);
  const [aiToggling, setAiToggling] = useState(false);
  useEffect(() => {
    setAiPaused(conv.aiPaused ?? false);
  }, [conv.id, conv.aiPaused]);
  async function toggleAiPaused() {
    const next = !aiPaused;
    setAiToggling(true);
    setAiPaused(next);
    try {
      const res = await fetch(`/api/v1/inbox/conversations/${conv.id}/ai-paused`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiPaused: next }),
      });
      if (!res.ok) setAiPaused(!next);
      else onAiPausedChange?.(next);
    } catch {
      setAiPaused(!next);
    } finally {
      setAiToggling(false);
    }
  }
  const [aiSuggestionError, setAiSuggestionError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Scroll-Sprung-Fix: nur scrollen, wenn wirklich neue Nachrichten kamen und
  // der Nutzer unten ist (oder gerade selbst gesendet hat).
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMsgIdRef = useRef<string | null>(null);
  const justSentRef = useRef(false);

  // Zendesk-style context panel. Open by default on desktop, remembered
  // across sessions; below lg it renders as an overlay drawer.
  const [panelOpen, setPanelOpen] = useState(false);
  useEffect(() => {
    const stored = window.localStorage.getItem("inbox.contextPanel");
    if (stored != null) setPanelOpen(stored === "1");
    else setPanelOpen(window.matchMedia("(min-width: 1024px)").matches);
  }, []);
  function setPanel(open: boolean) {
    setPanelOpen(open);
    window.localStorage.setItem("inbox.contextPanel", open ? "1" : "0");
  }

  // Reset suggestion when switching conversations
  useEffect(() => {
    setAiSuggestion(null);
    setAiSuggestionError(null);
    setAiSuggestionLoading(false);
  }, [conv.id]);

  async function fetchAiSuggestion() {
    if (aiSuggestionLoading) return;
    setAiSuggestionLoading(true);
    setAiSuggestionError(null);
    try {
      const res = await fetch(
        `/api/v1/inbox/conversations/${conv.id}/suggest-reply`,
        { method: "POST" }
      );
      const data = (await res.json().catch(() => ({}))) as {
        text?: string | null;
        error?: string | null;
      };
      if (data?.text) {
        setAiSuggestion(data.text);
      } else {
        setAiSuggestion(null);
        setAiSuggestionError(data?.error ?? "Kein Vorschlag verfügbar.");
      }
    } catch {
      setAiSuggestionError("Vorschlag konnte nicht geladen werden.");
    } finally {
      setAiSuggestionLoading(false);
    }
  }

  function acceptAiSuggestion() {
    if (!aiSuggestion) return;
    setReply(aiSuggestion);
    setAiSuggestion(null);
    setAiSuggestionError(null);
    textareaRef.current?.focus();
  }

  function editAiSuggestion() {
    if (!aiSuggestion) return;
    setReply(aiSuggestion);
    setAiSuggestion(null);
    setAiSuggestionError(null);
    setTimeout(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }, 0);
  }

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchMessages = useCallback(async (silent = false) => {
    if (!silent) setLoadingMsgs(true);
    try {
      const res = await fetch(`/api/v1/inbox/conversations/${conv.id}/messages`);
      if (res.ok) {
        const data = await res.json();
        const next: Message[] = data.data ?? [];
        // Unveränderte Payloads behalten ihre Array-Identität, damit der
        // 60s-Poll keine Effekte (z. B. Auto-Scroll) erneut auslöst.
        setMessages((prev) => {
          if (
            prev.length === next.length &&
            prev[prev.length - 1]?.id === next[next.length - 1]?.id &&
            prev.every((m, i) => m.id === next[i].id && m.status === next[i].status)
          ) {
            return prev;
          }
          return next;
        });
      }
    } finally {
      if (!silent) setLoadingMsgs(false);
    }
  }, [conv.id]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Auto-refresh messages every 60 s so new inbound messages appear
  // without requiring a manual reload. Pauses when the tab is hidden.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    function start() {
      if (timer) return;
      timer = setInterval(() => fetchMessages(true), 60_000);
    }
    function stop() {
      if (timer) { clearInterval(timer); timer = null; }
    }
    function onVis() {
      if (document.hidden) { stop(); }
      else { fetchMessages(true); start(); }
    }

    start();
    document.addEventListener("visibilitychange", onVis);
    return () => { stop(); document.removeEventListener("visibilitychange", onVis); };
  }, [fetchMessages]);

  useEffect(() => {
    const lastId = messages.length > 0 ? messages[messages.length - 1].id : null;
    const prevId = lastMsgIdRef.current;
    lastMsgIdRef.current = lastId;
    if (!lastId || lastId === prevId) return;
    if (prevId === null) {
      // Erstes Laden nach dem Öffnen der Konversation: wie bisher nach unten.
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    const el = scrollRef.current;
    const nearBottom = el
      ? el.scrollHeight - el.scrollTop - el.clientHeight < 150
      : true;
    if (nearBottom || justSentRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    justSentRef.current = false;
  }, [messages]);

  // Auto-grow the composer with content. CSS `max-h-48` caps it so the
  // message list stays visible; once the cap is hit the textarea scrolls.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [reply]);

  // If the user empties the textarea after accepting a draft, drop the
  // consumed-marker tracker so a fresh hand-written reply doesn't end up
  // marking an unrelated draft note as taken.
  useEffect(() => {
    if (acceptedDraft && reply.trim().length === 0) {
      setAcceptedDraft(null);
    }
  }, [reply, acceptedDraft]);

  async function handleSend() {
    if (sending) return;
    if (pendingAttachment) {
      await handleSendAttachment();
      return;
    }
    if (!reply.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/v1/inbox/conversations/${conv.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        justSentRef.current = true;
        setMessages((prev) => [...prev, data.data]);
        setReply("");
        setSendError(null);
        textareaRef.current?.focus();
        // Der Server pausiert den KI-Assistenten nach einer manuellen Antwort.
        // Toggle + Liste sofort nachziehen; Hinweis nur einmal pro Pause.
        if (!aiPaused) {
          setAiPaused(true);
          onAiPausedChange?.(true);
          toast.info("KI-Assistent pausiert", {
            description:
              "Manuelle Antwort gesendet. Über den Schalter lässt er sich wieder aktivieren.",
          });
        }
        if (acceptedDraft) {
          await markDraftConsumed(acceptedDraft.noteId);
          setAcceptedDraft(null);
          setDraftRefreshKey((k) => k + 1);
        }
      } else {
        const err = await res.json();
        const errObj = typeof err.error === "object" ? err.error : { message: err.error };
        setSendError(errObj);
      }
    } finally {
      setSending(false);
    }
  }

  async function handleSendAttachment() {
    if (!pendingAttachment) return;
    setSending(true);
    setSendError(null);
    try {
      const fd = new FormData();
      fd.append("file", pendingAttachment);
      if (reply.trim()) fd.append("caption", reply.trim());
      const res = await fetch(
        `/api/v1/inbox/conversations/${conv.id}/messages/media`,
        { method: "POST", body: fd }
      );
      if (res.ok) {
        const data = await res.json();
        justSentRef.current = true;
        setMessages((prev) => [...prev, data.data]);
        setReply("");
        setPendingAttachment(null);
        setSendError(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        textareaRef.current?.focus();
        if (acceptedDraft) {
          await markDraftConsumed(acceptedDraft.noteId);
          setAcceptedDraft(null);
          setDraftRefreshKey((k) => k + 1);
        }
      } else {
        const err = await res.json().catch(() => ({}));
        const errObj = typeof err.error === "object" ? err.error : { message: err.error };
        setSendError(errObj);
      }
    } finally {
      setSending(false);
    }
  }

  async function handleCopyHistory(format: "md" | "json") {
    setShowMenu(false);
    const text =
      format === "md"
        ? formatChatAsMarkdown(conv, messages)
        : formatChatAsJSON(conv, messages);
    const ok = await copyTextToClipboard(text);
    setCopyFeedback(ok ? format : "error");
    window.setTimeout(() => setCopyFeedback(null), 2200);
  }

  const canSend = conv.channelType === "email" || conv.channelType === "whatsapp";

  const isKa = isKleinanzeigenConv(conv);
  const isWa = conv.channelType === "whatsapp";

  return (
    <div className="flex h-full min-w-0">
    <div
      className="relative flex flex-col h-full flex-1 min-w-0"
      style={{ background: "var(--inbox-canvas)" }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 border-b border-border bg-background shrink-0">
        <button onClick={onBack} className="md:hidden text-muted-foreground hover:text-foreground p-1 -ml-1">
          <ArrowLeft className="h-5 w-5" />
        </button>

        <div className="relative shrink-0">
          <ChannelAvatar channel={lastChannelOf(conv)} size="lg" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-sm truncate">{contactLabel(conv)}</p>
            {conv.multiCompanyFlag && (
              <span className="flex items-center gap-1 text-[10px] text-amber-700 bg-amber-500/10 border border-amber-500/20 rounded-full px-1.5 py-0.5 shrink-0">
                <AlertTriangle className="h-2.5 w-2.5" />
                Mehrere Firmen
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-0.5 text-xs text-muted-foreground">
            {isKa ? (
              <span className="inline-flex items-center gap-1">
                <KleinanzeigenLogo className="h-3 w-3 text-[8px]" />
                Kleinanzeigen
              </span>
            ) : isWa ? (
              <span className="inline-flex items-center gap-1">
                <ChannelIcon type="whatsapp" size="xs" />
                WhatsApp
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Mail className="h-3 w-3 text-blue-500" />
                E-Mail
              </span>
            )}
            <span className="hidden sm:inline">·</span>
            <span className="truncate hidden sm:inline">{conv.channelName}</span>
            {conv.contactEmail && !isWa && (
              <>
                <span className="hidden sm:inline">·</span>
                <span className="truncate hidden sm:inline">{conv.contactEmail}</span>
              </>
            )}
            {conv.contactPhone && isWa && (
              <>
                <span>·</span>
                <span className="truncate">{conv.contactPhone}</span>
              </>
            )}
          </div>
        </div>

        {/* Sales-agent per-conversation toggle */}
        <button
          onClick={toggleAiPaused}
          disabled={aiToggling}
          title={
            aiPaused
              ? "KI-Assistent ist für diesen Chat aus. Klicken, um ihn wieder zu aktivieren."
              : "KI-Assistent ist für diesen Chat an. Klicken, um ihn zu pausieren."
          }
          className={`hidden sm:inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
            aiPaused
              ? "border-border text-muted-foreground bg-muted/30 hover:bg-muted"
              : "border-violet-500/30 text-violet-700 bg-violet-500/5 hover:bg-violet-500/10"
          }`}
        >
          <Bot className="h-3.5 w-3.5" />
          {aiPaused ? "Assistent aus" : "Assistent an"}
        </button>

        {/* Context panel toggle */}
        <button
          onClick={() => setPanel(!panelOpen)}
          title={panelOpen ? "Schnellzugriff ausblenden" : "Schnellzugriff einblenden"}
          className={cn(
            "h-8 w-8 flex items-center justify-center rounded-lg transition-colors",
            panelOpen
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
        >
          <PanelRight className="h-4 w-4" />
        </button>

        {/* Status + menu */}
        <div className="relative">
          <button
            onClick={() => setShowMenu((v) => !v)}
            className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-9 z-50 w-60 rounded-lg border border-border bg-popover shadow-lg py-1">
                {conv.dealRecordId && (
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      router.push(`/objects/deals/${conv.dealRecordId}`);
                    }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted transition-colors"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Lead öffnen
                  </button>
                )}
                {isMobilePhone(conv.contactPhone, isWa) && (
                  <a
                    href={`tel:${conv.contactPhone}`}
                    onClick={() => setShowMenu(false)}
                    className="sm:hidden flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted transition-colors"
                  >
                    <Phone className="h-4 w-4" />
                    Anrufen
                  </a>
                )}
                {onSetStatus && (
                  <>
                    <div className="my-1 border-t border-border" />
                    {conv.status === "open" ? (
                      <>
                        <button
                          onClick={() => { setShowMenu(false); onSetStatus("resolved"); }}
                          className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted transition-colors"
                        >
                          <CheckCheck className="h-4 w-4" />
                          Erledigt
                        </button>
                        <button
                          onClick={() => { setShowMenu(false); onSetStatus("spam"); }}
                          className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted transition-colors"
                        >
                          <Ban className="h-4 w-4" />
                          Als Spam
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => { setShowMenu(false); onSetStatus("open"); }}
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted transition-colors"
                      >
                        <RotateCcw className="h-4 w-4" />
                        Wieder öffnen
                      </button>
                    )}
                  </>
                )}
                <div className="my-1 border-t border-border" />
                <button
                  onClick={() => handleCopyHistory("md")}
                  disabled={loadingMsgs || messages.length === 0}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Copy className="h-4 w-4" />
                  Verlauf kopieren (Markdown)
                </button>
                <button
                  onClick={() => handleCopyHistory("json")}
                  disabled={loadingMsgs || messages.length === 0}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Braces className="h-4 w-4" />
                  Verlauf kopieren (JSON)
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Subject bar (email/kleinanzeigen only) */}
      {conv.subject && !isWa && (
        <div className="px-4 py-2 bg-background/60 border-b border-border/60 text-xs text-muted-foreground shrink-0">
          <span className="font-medium text-foreground/70">Betreff:</span> {conv.subject}
        </div>
      )}

      {/* Copy feedback toast */}
      {copyFeedback && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div
            className={cn(
              "flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium shadow-lg border",
              copyFeedback === "error"
                ? "bg-red-500/10 border-red-500/30 text-red-700"
                : "bg-emerald-500/10 border-emerald-500/30 text-emerald-700",
            )}
          >
            {copyFeedback === "error" ? (
              <>
                <AlertCircle className="h-3.5 w-3.5" />
                Kopieren fehlgeschlagen
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5" />
                {copyFeedback === "md"
                  ? "Verlauf als Markdown kopiert"
                  : "Verlauf als JSON kopiert"}
              </>
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-1.5"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(0,0,0,0.035) 1px, transparent 0)",
          backgroundSize: "20px 20px",
        }}
      >
        {loadingMsgs ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-12">Keine Nachrichten</p>
        ) : (
          messages.map((msg, i) => {
            const prev = messages[i - 1];
            const next = messages[i + 1];
            const ts = msg.sentAt ?? msg.createdAt;
            const prevTs = prev?.sentAt ?? prev?.createdAt;
            const showDate = !prev || (prevTs && !sameDay(ts, prevTs));
            const isInbound = msg.direction === "inbound";
            const nextIsInbound = next?.direction === "inbound";
            // Show the contact avatar on the last inbound bubble of a burst
            const showAvatar = isInbound && (!next || !nextIsInbound);
            return (
              <div key={msg.id} className="space-y-1.5">
                {showDate && <DateSeparator iso={ts} />}
                <MessageBubble msg={msg} showAvatar={showAvatar} conv={conv} />
              </div>
            );
          })
        )}

        {/* AI suggestion bubble (manual, never auto-fires) */}
        {(aiSuggestion || aiSuggestionLoading || aiSuggestionError) && (
          <div
            style={{
              marginTop: 12,
              padding: "12px 14px",
              background:
                "linear-gradient(90deg, color-mix(in srgb, var(--accent-soft) 60%, #fff), #fff)",
              border:
                "1px dashed color-mix(in oklch, var(--kottke-accent) 30%, transparent)",
              borderRadius: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                fontFamily: "var(--f-mono)",
                letterSpacing: ".08em",
                textTransform: "uppercase",
                color: "var(--kottke-accent)",
                fontWeight: 500,
                marginBottom: 6,
              }}
            >
              <Sparkles className="h-[11px] w-[11px]" />
              Vorschlag
            </div>
            {aiSuggestionLoading ? (
              <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                Wird generiert …
              </div>
            ) : aiSuggestionError ? (
              <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>
                {aiSuggestionError}
              </div>
            ) : aiSuggestion ? (
              <>
                <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                  „{aiSuggestion}"
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <button className="k-btn sm" onClick={acceptAiSuggestion}>
                    Übernehmen
                  </button>
                  <button className="k-btn sm ghost" onClick={editAiSuggestion}>
                    Bearbeiten
                  </button>
                </div>
              </>
            ) : null}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Reply box */}
      <div
        className="border-t border-border px-3 sm:px-4 py-2.5 sm:py-3 bg-background shrink-0 space-y-2"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.625rem)" }}
      >
        {draftBannerEnabled && canSend && conv.dealRecordId && (
          <DraftSuggestionBanner
            dealRecordId={conv.dealRecordId}
            refreshKey={draftRefreshKey}
            onAcceptDraft={(text, suggestion) => {
              setReply(text);
              setAcceptedDraft(suggestion);
              // Defer so the textarea has the new value before we focus it,
              // ensuring the auto-grow effect kicks in on the same tick.
              requestAnimationFrame(() => {
                const el = textareaRef.current;
                if (!el) return;
                el.focus();
                const end = el.value.length;
                el.setSelectionRange(end, end);
              });
            }}
          />
        )}
        {sendError && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs space-y-1.5">
            {sendError.code === "WA_SESSION_EXPIRED" ? (
              <>
                <div className="flex items-start gap-2 text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    Das 24-Stunden-Antwortfenster ist abgelaufen. Du kannst nur noch eine
                    genehmigte <b>Template-Nachricht</b> senden, um das Gespräch fortzusetzen.
                  </span>
                </div>
                <button
                  onClick={() => {
                    setSendError(null);
                    onOpenCompose?.();
                  }}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Template-Nachricht senden
                </button>
              </>
            ) : (
              <div className="flex items-start gap-2 text-red-700">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{sendError.message ?? "Senden fehlgeschlagen"}</span>
              </div>
            )}
          </div>
        )}
        {canSend ? (
          <>
            {pendingAttachment && (
              <AttachmentPreview
                file={pendingAttachment}
                onRemove={() => {
                  setPendingAttachment(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              />
            )}
            <div className="flex items-end gap-2 rounded-2xl border border-input bg-muted/30 focus-within:border-ring/40 focus-within:bg-background focus-within:ring-2 focus-within:ring-ring/10 transition-colors px-3 py-2">
              {isWa && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,video/mp4,audio/mpeg,audio/ogg"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setPendingAttachment(f);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={sending}
                    className="h-9 w-9 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0 disabled:opacity-50"
                    title="Datei anhängen"
                  >
                    <Paperclip className="h-4 w-4" />
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={fetchAiSuggestion}
                disabled={aiSuggestionLoading || messages.length === 0}
                className="h-9 w-9 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0 disabled:opacity-50"
                title="KI-Vorschlag erstellen"
              >
                {aiSuggestionLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
              </button>
              {conv.dealRecordId && (
                <CustomerLinkComposer
                  dealRecordId={conv.dealRecordId}
                  firmaDisplayName={conv.channelName}
                  customerFirstName={
                    conv.contactName ? conv.contactName.split(" ")[0] : null
                  }
                  dealNumber={null}
                  onInsert={(text) => {
                    setReply((r) => (r.trim() ? `${r.trimEnd()}\n\n${text}` : text));
                    requestAnimationFrame(() => textareaRef.current?.focus());
                  }}
                />
              )}
              <textarea
                ref={textareaRef}
                className="flex-1 bg-transparent text-sm resize-none min-h-[28px] max-h-[40vh] sm:max-h-48 overflow-y-auto focus:outline-none placeholder:text-muted-foreground"
                placeholder={
                  pendingAttachment
                    ? "Bildunterschrift (optional)…"
                    : isWa
                      ? "WhatsApp-Nachricht schreiben…"
                      : "Nachricht schreiben…"
                }
                rows={1}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  // Touch keyboards: Enter must add a newline (standard expectation).
                  // Mouse/keyboard: Enter sends, Shift+Enter newline.
                  const isTouch =
                    typeof window !== "undefined" &&
                    window.matchMedia?.("(hover: none)").matches;
                  if (!isTouch && e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              <Button
                onClick={handleSend}
                disabled={(!reply.trim() && !pendingAttachment) || sending}
                size="sm"
                className="rounded-full h-9 w-9 p-0 shrink-0"
                title="Senden (Enter)"
              >
                {sending
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Send className="h-4 w-4" />
                }
              </Button>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-2">
            WhatsApp-Antworten erfordern die aktive WhatsApp Business API-Integration.
          </p>
        )}
      </div>
    </div>

    {/* ── Context panel (Zendesk-style quick actions) ── */}
    {panelOpen && (
      <InboxContextPanel
        conversationId={conv.id}
        dealRecordId={conv.dealRecordId}
        firma={/ceylan/i.test(conv.channelName) ? "ceylan" : "kottke"}
        firmaDisplayName={conv.channelName}
        customerName={contactLabel(conv)}
        agentStage={(conv.agentState?.stage as AgentStage | undefined) ?? null}
        onStageChange={onAgentStageChange}
        onDealLinked={onDealLinked}
        onInsert={(text) => {
          setReply((r) => (r.trim() ? `${r.trimEnd()}\n\n${text}` : text));
          requestAnimationFrame(() => textareaRef.current?.focus());
        }}
        onClose={() => setPanel(false)}
      />
    )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function InboxPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  // KOT-IDENTITY Phase 5b: merged person view. `merged` = show the combined
  // "Gesamt" timeline; `mergedOc` = which operating company's threads to merge.
  const [merged, setMerged] = useState(false);
  const [mergedOc, setMergedOc] = useState<string>("__none__");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  // Paket 3 (Inbox-Triage): "Offen" ist die Standardansicht; der kompakte
  // Umschalter im Listenkopf blendet erledigte Konversationen ein, wo sie
  // wieder geöffnet werden können. Spam bleibt ausgeblendet.
  const [statusFilter, setStatusFilter] = useState<"open" | "resolved">("open");
  // Multi-select funnel-stage filter. Empty set = "Alle" (show every stage).
  const [stageFilter, setStageFilter] = useState<Set<AgentStage>>(new Set());
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<"messaging" | "kleinanzeigen" | "whatsapp" | "other">("messaging");
  // KOT-IDENTITY Phase 6: triage lane. Default 'lead' keeps ads / newsletters /
  // platform notifications out of the inbox; 'info' shows them, 'all' shows both.
  const [laneFilter, setLaneFilter] = useState<"lead" | "info" | "all">("lead");
  const [search, setSearch] = useState("");
  // Nachrichtensuche (Paket 3): Serverseitige Suche über alle Nachrichten-
  // Inhalte, unabhängig von Lane/Status. null = keine Server-Ergebnisse
  // (leere Suche oder Antwort steht noch aus — dann greift der Client-Filter).
  const [searchResults, setSearchResults] = useState<Conversation[] | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  // Deep-link prefill for the compose dialog, populated from URL params when
  // the user arrives from the leads table.
  const [composePrefill, setComposePrefill] = useState<{
    channelAccountId?: string;
    toPhone?: string;
    customerName?: string;
    dealRecordId?: string | null;
  }>({});

  // KOT-IDENTITY: pending duplicate suggestions, used for an inline banner in the
  // detail so the operator can merge the person they are looking at, in place.
  const [suggestions, setSuggestions] = useState<{ survivorId: string; survivorName: string; absorbedId: string; absorbedName: string }[]>([]);

  const fetchConversations = useCallback(async () => {
    const params = new URLSearchParams({ status: statusFilter, lane: laneFilter });
    if (accountFilter !== "all") params.set("channelAccountId", accountFilter);
    const res = await fetch(`/api/v1/inbox/conversations?${params}`);
    if (res.ok) {
      const data = await res.json();
      const list: Conversation[] = data.data ?? [];
      setConversations(list);
      // Poll-Reconcile: `selected` ist ein eigenes Objekt und würde sonst
      // veralten. Nur die volatilen Felder mergen, nichts anderes anfassen.
      setSelected((s) => {
        if (!s) return s;
        const fresh = list.find((c) => c.id === s.id);
        if (!fresh) return s;
        if (
          fresh.aiPaused === s.aiPaused &&
          fresh.unreadCount === s.unreadCount &&
          fresh.dealRecordId === s.dealRecordId &&
          fresh.status === s.status &&
          JSON.stringify(fresh.agentState ?? null) === JSON.stringify(s.agentState ?? null)
        ) {
          return s;
        }
        return {
          ...s,
          aiPaused: fresh.aiPaused,
          unreadCount: fresh.unreadCount,
          dealRecordId: fresh.dealRecordId,
          status: fresh.status,
          agentState: fresh.agentState,
        };
      });
    }
  }, [statusFilter, accountFilter, laneFilter]);

  const fetchSuggestions = useCallback(async () => {
    const res = await fetch("/api/v1/persons/merge-suggestions");
    if (res.ok) setSuggestions((await res.json()).data ?? []);
  }, []);

  const decideSuggestion = useCallback(async (idA: string, idB: string, action: "merge" | "reject") => {
    const res = await fetch("/api/v1/persons/merge-suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, idA, idB }),
    });
    if (res.ok) {
      await fetchSuggestions();
      if (action === "merge") await fetchConversations();
    }
  }, [fetchSuggestions, fetchConversations]);

  useEffect(() => { void fetchSuggestions(); }, [fetchSuggestions]);

  const fetchAccounts = useCallback(async () => {
    const res = await fetch("/api/v1/inbox/channel-accounts");
    if (res.ok) {
      const data = await res.json();
      setAccounts(data.data ?? []);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchAccounts(), fetchConversations()]).finally(() =>
      setLoading(false)
    );
  }, [fetchAccounts, fetchConversations]);

  // ── Auto-refresh: poll every 60 s so new messages appear without manual
  // clicking. Pauses when the browser tab is hidden to save resources.
  const selectedRef = useRef<Conversation | null>(null);
  selectedRef.current = selected;

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    function startPolling() {
      if (timer) return;
      timer = setInterval(() => {
        // Silently refresh the conversation list (no loading spinner)
        fetchConversations();
      }, 60_000);
    }

    function stopPolling() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    function onVisibilityChange() {
      if (document.hidden) {
        stopPolling();
      } else {
        // Immediately refresh when the user comes back to the tab,
        // then resume the interval.
        fetchConversations();
        startPolling();
      }
    }

    startPolling();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fetchConversations]);

  // Handle deep links from the leads table / home page:
  //   ?conv=<id>[&merged=1]    → auto-select that conversation; merged=1 öffnet
  //                              die Gesamtansicht der Person wieder
  //   ?compose=1&phone=…&name=…&channelAccountId=…&dealRecordId=…
  //                            → auto-open composer pre-filled, so the
  //                              resulting conversation is linked to the lead
  useEffect(() => {
    const composeParam = searchParams.get("compose");
    if (composeParam !== "1") return;
    setComposePrefill({
      channelAccountId: searchParams.get("channelAccountId") ?? undefined,
      toPhone: searchParams.get("phone") ?? undefined,
      customerName: searchParams.get("name") ?? undefined,
      dealRecordId: searchParams.get("dealRecordId") ?? null,
    });
    setComposeOpen(true);
    // Clean the URL so a reload doesn't re-open the dialog.
    router.replace("/inbox");
  }, [searchParams, router]);

  // ── Restore (Paket 4): läuft genau einmal, nachdem die Liste erstmals
  // geladen ist — nicht bei jedem Poll. Danach gibt restoreDoneRef die
  // URL-Synchronisation unten frei. Status-/Lane-Filter werden nicht
  // angefasst: ist die Konversation nicht in der geladenen Ansicht, wird sie
  // einzeln nachgeladen und als Einzelansicht geöffnet.
  const restoreDoneRef = useRef(false);
  useEffect(() => {
    if (restoreDoneRef.current || loading) return;
    if (searchParams.get("compose") === "1") return; // Composer-Deep-Link hat Vorrang
    const convParam = searchParams.get("conv");
    restoreDoneRef.current = true;
    if (!convParam) return;

    const match = conversations.find((c) => c.id === convParam);
    if (match) {
      // Wie ein Klick auf die Personenzeile: gleiche Lese- und Merge-Logik.
      const personKey = match.crmRecordId ?? `contact:${match.contactId}`;
      const threads = conversations.filter(
        (c) => (c.crmRecordId ?? `contact:${c.contactId}`) === personKey
      );
      if (searchParams.get("merged") === "1" && threads.length > 1) {
        setMerged(true);
        const oc = match.operatingCompanyRecordId ?? "__none__";
        setMergedOc(oc);
        markReadLocally(
          threads
            .filter((c) => (c.operatingCompanyRecordId ?? "__none__") === oc)
            .map((c) => c.id)
        );
      } else {
        setMerged(false);
        markReadLocally([match.id]);
      }
      setSelected({ ...match, unreadCount: 0 });
      return;
    }

    // Nicht in der geladenen Liste (andere Lane / anderer Status):
    // direkt über die Einzel-Route laden.
    void (async () => {
      try {
        const res = await fetch(`/api/v1/inbox/conversations/${convParam}`);
        const data = res.ok ? await res.json() : null;
        const conv: Conversation | null = data?.data ?? null;
        if (!conv) throw new Error("not_found");
        setMerged(false);
        setSelected({ ...conv, unreadCount: 0 });
      } catch {
        toast.error("Konversation nicht gefunden");
        router.replace("/inbox", { scroll: false });
      }
    })();
  }, [loading, searchParams, conversations, router]);

  // ── URL-Sync (Paket 4): die ausgewählte Konversation als ?conv=<id> in der
  // URL spiegeln, damit Fälle teilbar sind und ein Reload an derselben Stelle
  // landet. replace statt push: kein History-Eintrag pro Auswahl. merged=1
  // steht für die Gesamtansicht der Person.
  const lastSyncedUrlRef = useRef<string | null>(null);
  useEffect(() => {
    if (!restoreDoneRef.current) return; // erst nach dem einmaligen Restore
    const url = selected
      ? `/inbox?conv=${selected.id}${merged ? "&merged=1" : ""}`
      : "/inbox";
    // Poll-Reconcile tauscht das selected-Objekt aus, ohne dass sich die URL
    // ändert — identische Replaces überspringen.
    if (lastSyncedUrlRef.current === url) return;
    lastSyncedUrlRef.current = url;
    router.replace(url, { scroll: false });
  }, [selected, merged, router]);

  async function handleSync() {
    setSyncing(true);
    try {
      await fetch("/api/v1/inbox/sync", { method: "POST" });
      await fetchConversations();
    } finally {
      setSyncing(false);
    }
  }


  // Manual stage override from the context panel — keep the list badge in sync.
  function handleAgentStageChange(convId: string, stage: AgentStage) {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId && c.agentState
          ? { ...c, agentState: { ...c.agentState, stage } }
          : c
      )
    );
    setSelected((s) =>
      s && s.id === convId && s.agentState
        ? { ...s, agentState: { ...s.agentState, stage } }
        : s
    );
  }

  // ── Nachrichtensuche: 300 ms Debounce, dann serverseitig in allen
  // Nachrichten und Kanälen suchen (Lane/Status werden serverseitig ignoriert).
  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/inbox/conversations?q=${encodeURIComponent(q)}`);
        if (cancelled || !res.ok) return;
        const data = await res.json();
        if (!cancelled) setSearchResults(data.data ?? []);
      } catch {
        // Netzwerkfehler: Client-Filter bleibt als Fallback aktiv.
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search]);

  // ── Erledigt/Spam-Triage (Paket 3). Eine Personenzeile kann mehrere
  // Konversationen bündeln; der Status wird auf alle angewendet.
  const patchStatus = useCallback(
    (ids: string[], status: ConversationStatus) =>
      Promise.all(
        ids.map((id) =>
          fetch(`/api/v1/inbox/conversations/${id}/status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
          })
        )
      ),
    []
  );

  async function handleSetStatus(ids: string[], status: ConversationStatus) {
    try {
      const results = await patchStatus(ids, status);
      if (results.some((r) => !r.ok)) throw new Error("status_failed");
      // Der neue Status passt nie zur aktuellen Ansicht — Zeilen entfernen.
      setConversations((prev) => prev.filter((c) => !ids.includes(c.id)));
      setSelected((s) => (s && ids.includes(s.id) ? null : s));
      if (status === "open") {
        toast.success("Wieder geöffnet");
      } else {
        toast.success(status === "resolved" ? "Als erledigt markiert" : "Als Spam markiert", {
          action: {
            label: "Rückgängig",
            onClick: () => {
              void patchStatus(ids, "open").then(() => fetchConversations());
            },
          },
        });
      }
    } catch {
      toast.error("Aktion fehlgeschlagen");
    }
  }

  // Unread-Fix: Öffnen markiert serverseitig als gelesen (Einzel- wie
  // Gesamtansicht) — die Badges sofort lokal nachziehen statt auf den
  // nächsten Poll zu warten.
  function markReadLocally(ids: string[]) {
    setConversations((prev) =>
      prev.some((c) => ids.includes(c.id) && c.unreadCount > 0)
        ? prev.map((c) =>
            ids.includes(c.id) && c.unreadCount > 0 ? { ...c, unreadCount: 0 } : c
          )
        : prev
    );
  }

  // Nach manueller Antwort oder Toggle: aiPaused in Liste + selected spiegeln.
  function handleAiPausedChange(convId: string, paused: boolean) {
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, aiPaused: paused } : c))
    );
    setSelected((s) => (s && s.id === convId ? { ...s, aiPaused: paused } : s));
  }

  // Kontext-Panel hat die Konversation mit einem Lead verknüpft: dealRecordId
  // in Liste + selected setzen, damit Panel und Listen-Badge sofort stimmen.
  function handleDealLinked(convId: string, dealRecordId: string) {
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, dealRecordId } : c))
    );
    setSelected((s) => (s && s.id === convId ? { ...s, dealRecordId } : s));
  }

  const searchMode = search.trim().length > 0;
  const filtered = (searchMode && searchResults !== null ? searchResults : conversations).filter((c) => {
    // Server-Suchergebnisse sind lane-/status-übergreifend und werden
    // ungefiltert angezeigt; der Block darunter ist die normale Ansicht
    // (plus Client-Filter als Sofort-Fallback, solange die Suche lädt).
    if (searchMode && searchResults !== null) return true;
    const isKa = isKleinanzeigenConv(c);
    const isWa = c.channelType === "whatsapp";
    if (sourceFilter === "messaging" && !(isKa || isWa)) return false;
    if (sourceFilter === "kleinanzeigen" && !isKa) return false;
    if (sourceFilter === "whatsapp" && !isWa) return false;
    if (sourceFilter === "other" && (isKa || isWa)) return false;
    // Funnel-stage filter (multi-select). Empty set = show all stages.
    if (stageFilter.size > 0) {
      const st = normalizeAgentStage(c.agentState?.stage);
      if (!st || !stageFilter.has(st)) return false;
    }
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      contactLabel(c).toLowerCase().includes(q) ||
      (c.subject?.toLowerCase().includes(q) ?? false) ||
      (c.lastMessagePreview?.toLowerCase().includes(q) ?? false)
    );
  });

  const sourceCounts = conversations.reduce(
    (acc, c) => {
      const isKa = isKleinanzeigenConv(c);
      const isWa = c.channelType === "whatsapp";
      if (isKa) acc.kleinanzeigen += 1;
      if (isWa) acc.whatsapp += 1;
      if (isKa || isWa) acc.messaging += 1;
      else acc.other += 1;
      return acc;
    },
    { messaging: 0, kleinanzeigen: 0, whatsapp: 0, other: 0 }
  );

  const unreadTotal = conversations.reduce((s, c) => s + c.unreadCount, 0);

  return (
    <>
    <div className="flex h-full overflow-hidden">
      {/* ── Left panel: conversation list ── */}
      <div
        className={cn(
          "flex flex-col border-r border-border",
          "w-full md:w-80 lg:w-96 shrink-0",
          selected ? "hidden md:flex" : "flex"
        )}
        style={{ background: "var(--inbox-rail)" }}
      >
        {/* Header */}
        <div className="px-4 pt-4 pb-2 shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h1 className="k-display text-[20px]" style={{ fontWeight: 500, letterSpacing: "-0.015em" }}>Posteingang</h1>
              {unreadTotal > 0 && (
                <span className="h-5 min-w-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center">
                  {unreadTotal}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {/* Triage-Ansicht: Offen | Erledigt */}
              <div className="flex items-center rounded-lg bg-muted p-0.5 text-[11px] font-medium mr-1">
                {([
                  { key: "open", label: "Offen" },
                  { key: "resolved", label: "Erledigt" },
                ] as const).map((v) => (
                  <button
                    key={v.key}
                    onClick={() => {
                      if (statusFilter === v.key) return;
                      setStatusFilter(v.key);
                      setSelected(null);
                    }}
                    className={cn(
                      "rounded-md px-2 py-0.5 transition-colors",
                      statusFilter === v.key
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setComposeOpen(true)}
                className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Neue WhatsApp-Nachricht"
              >
                <PenSquare className="h-4 w-4" />
              </button>
              <button
                onClick={handleSync}
                disabled={syncing}
                className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Nachrichten abrufen"
              >
                <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Suchen…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-input bg-muted/30 pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>

          {/* Lane tabs (KOT-IDENTITY Phase 6): keep ads / newsletters / platform
              notifications out of the lead inbox; switch to see them. */}
          <div className="flex rounded-lg bg-muted p-0.5 text-xs">
            {([
              { key: "lead", label: "Leads" },
              { key: "info", label: "Info / Werbung" },
              { key: "all", label: "Alle" },
            ] as const).map((l) => (
              <button
                key={l.key}
                onClick={() => { setLaneFilter(l.key); setSelected(null); }}
                className={cn(
                  "flex-1 rounded-md py-1 font-medium transition-colors",
                  laneFilter === l.key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {l.label}
              </button>
            ))}
          </div>

          {/* Duplicate merge suggestions (KOT-IDENTITY Part B) */}
          <MergeSuggestions onMerged={() => { void fetchConversations(); void fetchSuggestions(); }} />

          {/* Source filter */}
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
            <SourceChip
              active={sourceFilter === "messaging"}
              onClick={() => { setSourceFilter("messaging"); setAccountFilter("all"); setSelected(null); }}
              count={sourceCounts.messaging}
              activeClass="bg-primary text-primary-foreground border-primary"
              title="Kleinanzeigen + WhatsApp zusammen"
            >
              <InboxIcon className="h-3 w-3" />
              Messaging
            </SourceChip>
            <SourceChip
              active={sourceFilter === "kleinanzeigen"}
              onClick={() => { setSourceFilter("kleinanzeigen"); setAccountFilter("all"); setSelected(null); }}
              count={sourceCounts.kleinanzeigen}
              activeClass="bg-[#96c11f] text-white border-[#96c11f]"
              title="Nur Kleinanzeigen (alle Firmen kombiniert)"
            >
              <KleinanzeigenLogo />
              Kleinanzeigen
            </SourceChip>
            <SourceChip
              active={sourceFilter === "whatsapp"}
              onClick={() => { setSourceFilter("whatsapp"); setAccountFilter("all"); setSelected(null); }}
              count={sourceCounts.whatsapp}
              activeClass="bg-[#25D366] text-white border-[#25D366]"
              title="Nur WhatsApp"
            >
              <ChannelIcon type="whatsapp" size="xs" />
              WhatsApp
            </SourceChip>
            <SourceChip
              active={sourceFilter === "other"}
              onClick={() => { setSourceFilter("other"); setSelected(null); }}
              count={sourceCounts.other}
              activeClass="bg-foreground text-background border-foreground"
              title="Sonstige E-Mails (Werbung, Newsletter, …)"
            >
              <Archive className="h-3 w-3" />
              Sonstiges
            </SourceChip>
          </div>

          {sourceFilter === "messaging" && (
            <p className="text-[10px] text-muted-foreground px-0.5">
              Kleinanzeigen- und WhatsApp-Nachrichten in einem Posteingang.
            </p>
          )}
          {sourceFilter === "kleinanzeigen" && (
            <p className="text-[10px] text-muted-foreground px-0.5">
              Kombinierter Posteingang aller Firmen. Jede Nachricht zeigt unten, zu welcher Firma sie gehört.
            </p>
          )}

          {/* Account filter — only for "other" (generic email accounts) */}
          {sourceFilter === "other" && accounts.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
              <button
                onClick={() => setAccountFilter("all")}
                className={cn(
                  "shrink-0 text-xs px-2.5 py-1 rounded-full border transition-colors",
                  accountFilter === "all"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                Alle
              </button>
              {accounts.map((acc) => (
                <button
                  key={acc.id}
                  onClick={() => setAccountFilter(acc.id)}
                  className={cn(
                    "shrink-0 flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors",
                    accountFilter === acc.id
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  <ChannelIcon type={acc.channelType} size="xs" />
                  <span className="truncate max-w-[120px]">{acc.name}</span>
                </button>
              ))}
            </div>
          )}

          {/* Funnel-stage filter (multi-select) */}
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setStageFilter(new Set())}
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                stageFilter.size === 0
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              Alle
            </button>
            {STAGE_FILTERS.map((s) => {
              const active = stageFilter.has(s.value);
              return (
                <button
                  key={s.value}
                  onClick={() =>
                    setStageFilter((prev) => {
                      const next = new Set(prev);
                      if (next.has(s.value)) next.delete(s.value);
                      else next.add(s.value);
                      return next;
                    })
                  }
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                    active
                      ? s.activeClass
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {searchMode && (
            <p className="px-4 py-1.5 text-[10px] text-muted-foreground border-b border-border/50">
              Suche in allen Nachrichten und Kanälen
            </p>
          )}
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-2">
              <MessageCircle className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {search ? "Keine Treffer" : "Keine Konversationen"}
              </p>
              {!search && stageFilter.size === 0 && (
                <button
                  onClick={handleSync}
                  className="text-xs text-primary hover:underline mt-1"
                >
                  Jetzt abrufen
                </button>
              )}
            </div>
          ) : (
            groupConversationsByPerson(filtered).map((person) => (
              <PersonRow
                key={person.key}
                data={{
                  name: person.name,
                  channels: person.channels,
                  lastChannel: lastChannelOf(person.latest),
                  unread: person.unread,
                  conversationCount: person.conversations.length,
                  dealRecordId: person.dealRecordId,
                  phone: person.phone,
                  email: person.email,
                  firma: person.firma,
                  lastMessageAt: person.latest.lastMessageAt,
                  lastMessagePreview: person.latest.lastMessagePreview,
                  latestConversationId: person.latest.id,
                  agentStage: person.latest.agentState?.stage ?? null,
                  agentPriority: person.latest.agentState?.priority ?? null,
                  agentMissing: person.latest.agentState?.missing ?? null,
                }}
                active={person.conversations.some((c) => c.id === selected?.id)}
                statusView={statusFilter}
                onSetStatus={(status) =>
                  void handleSetStatus(person.conversations.map((c) => c.id), status)
                }
                onClick={() => {
                  if (person.conversations.length > 1) {
                    setMerged(true);
                    const oc = person.latest.operatingCompanyRecordId ?? "__none__";
                    setMergedOc(oc);
                    // Gesamtansicht markiert sich serverseitig als gelesen —
                    // betroffen sind die Threads derselben Firma.
                    markReadLocally(
                      person.conversations
                        .filter((c) => (c.operatingCompanyRecordId ?? "__none__") === oc)
                        .map((c) => c.id)
                    );
                  } else {
                    setMerged(false);
                    markReadLocally([person.latest.id]);
                  }
                  setSelected({ ...person.latest, unreadCount: 0 });
                }}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Right panel: conversation view ── */}
      <div className={cn(
        "flex-1 min-w-0",
        selected ? "flex flex-col" : "hidden md:flex md:flex-col"
      )}>
        {selected ? (() => {
          // KOT-IDENTITY Phase 5b: person detail. With several conversations a bar
          // switches between a merged "Gesamt" timeline (split per operating
          // company: Kottke / Ceylan stay separate) and the individual channel chats.
          const personKey = selected.crmRecordId ?? `contact:${selected.contactId}`;
          const threads = conversations
            .filter((c) => (c.crmRecordId ?? `contact:${c.contactId}`) === personKey)
            .sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));
          const multi = threads.length > 1;
          const ocKey = (c: Conversation) => c.operatingCompanyRecordId ?? "__none__";
          const firma = (c: Conversation) => (/ceylan/i.test(c.channelName) ? "Ceylan" : "Kottke");
          const companies = [...new Map(threads.map((c) => [ocKey(c), c] as const)).values()];
          const showMerged = merged && multi;
          const mergedIds = threads.filter((c) => ocKey(c) === mergedOc).map((c) => c.id);
          const sug = selected.crmRecordId ? suggestions.find((s) => s.survivorId === selected.crmRecordId || s.absorbedId === selected.crmRecordId) : undefined;
          const sugOther = sug ? (sug.survivorId === selected.crmRecordId ? sug.absorbedName : sug.survivorName) : "";
          return (
            <>
              {sug && (
                <div className="shrink-0 flex items-center gap-2 border-b border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-1.5 text-xs">
                  <span className="text-amber-800 dark:text-amber-300">Mögliche Dublette: <b>{sugOther}</b></span>
                  <div className="ml-auto flex gap-1.5 shrink-0">
                    <button onClick={() => decideSuggestion(sug.survivorId, sug.absorbedId, "merge")} className="rounded-md bg-amber-600 text-white px-2 py-0.5 font-medium hover:bg-amber-700">Zusammenführen</button>
                    <button onClick={() => decideSuggestion(sug.survivorId, sug.absorbedId, "reject")} className="rounded-md border border-amber-400 text-amber-700 px-2 py-0.5 hover:bg-amber-100">Verschieden</button>
                  </div>
                </div>
              )}
              {multi && (
                <div className="shrink-0 flex items-center gap-1.5 overflow-x-auto border-b border-border bg-muted/30 px-3 py-1.5 scrollbar-none">
                  {companies.map((s) => (
                    <button
                      key={"g" + ocKey(s)}
                      onClick={() => {
                        setMerged(true);
                        setMergedOc(ocKey(s));
                        // Gesamtansicht markiert sich serverseitig als gelesen.
                        markReadLocally(threads.filter((c) => ocKey(c) === ocKey(s)).map((c) => c.id));
                      }}
                      className={cn(
                        "shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold border transition-colors",
                        showMerged && mergedOc === ocKey(s) ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {companies.length > 1 ? `Gesamt · ${firma(s)}` : "Gesamt"}
                    </button>
                  ))}
                  <span className="shrink-0 mx-1 h-3 w-px bg-border" />
                  {threads.map((t) => {
                    const isKa = isKleinanzeigenConv(t);
                    const label = isKa ? "Kleinanzeigen" : t.channelType === "whatsapp" ? "WhatsApp" : (t.channelType as string) === "sms" ? "SMS" : "E-Mail";
                    const when = t.lastMessageAt ? new Date(t.lastMessageAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }) : "";
                    return (
                      <button
                        key={t.id}
                        onClick={() => {
                          setMerged(false);
                          markReadLocally([t.id]);
                          setSelected({ ...t, unreadCount: 0 });
                        }}
                        className={cn(
                          "shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium border transition-colors",
                          !showMerged && t.id === selected.id ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {label}{when ? ` · ${when}` : ""}{t.unreadCount > 0 ? ` (${t.unreadCount})` : ""}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="flex-1 min-h-0 flex flex-col">
                {showMerged ? (
                  <>
                    <PersonTimeline conversationIds={mergedIds} />
                    <div className="shrink-0 border-t border-border px-4 py-2 text-center text-[11px] text-muted-foreground">
                      Zum Antworten oben einen Kanal wählen.
                    </div>
                  </>
                ) : (
                  <ConversationView
                    key={selected.id}
                    conv={selected}
                    onBack={() => setSelected(null)}
                    onAgentStageChange={(stage) => handleAgentStageChange(selected.id, stage)}
                    onOpenCompose={() => setComposeOpen(true)}
                    onSetStatus={(status) => void handleSetStatus([selected.id], status)}
                    onAiPausedChange={(paused) => handleAiPausedChange(selected.id, paused)}
                    onDealLinked={(dealRecordId) => handleDealLinked(selected.id, dealRecordId)}
                  />
                )}
              </div>
            </>
          );
        })() : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
            <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center">
              <MessageCircle className="h-8 w-8 text-muted-foreground/50" />
            </div>
            <div>
              <p className="font-medium">Konversation auswählen</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                Wähle links eine Konversation aus, um Nachrichten zu lesen und zu antworten.
              </p>
            </div>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-2 text-sm text-primary hover:underline mt-2"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
              Nachrichten jetzt abrufen
            </button>
          </div>
        )}
      </div>
    </div>
    {composeOpen && (
      <ComposeWhatsAppModal
        accounts={accounts.filter((a) => a.channelType === "whatsapp" && a.isActive)}
        initialChannelAccountId={composePrefill.channelAccountId}
        initialPhone={composePrefill.toPhone}
        initialCustomerName={composePrefill.customerName}
        dealRecordId={composePrefill.dealRecordId}
        onClose={() => {
          setComposeOpen(false);
          setComposePrefill({});
        }}
        onSent={(conversationId) => {
          setComposeOpen(false);
          setComposePrefill({});
          void fetchConversations();
          // Select the conversation if it's already in the list, otherwise
          // the refetch above will pull it in and the user can click it.
          setTimeout(() => {
            setConversations((prev) => {
              const found = prev.find((c) => c.id === conversationId);
              if (found) setSelected(found);
              return prev;
            });
          }, 300);
        }}
      />
    )}
    </>
  );
}

// ─── Compose WhatsApp modal ───────────────────────────────────────────────────
// First-contact flow: pick a business number, enter recipient phone + name.
//
// The sender's transport decides the rest:
//   • WABA Cloud API (waPhoneNumberId set) — Meta only allows outbound-initiated
//     conversations via approved templates, so the composer makes you pick a
//     template and fill its `{{n}}` variables.
//   • Baileys personal WhatsApp (waPhoneNumberId null) — no template requirement
//     and no 24h window, so the composer offers a plain free-text box instead.

interface WhatsAppTemplate {
  name: string;
  language: string;
  status: string;
  category: string;
  components: Array<{ type: string; text?: string; format?: string }>;
  bodyVariableCount: number;
}

function ComposeWhatsAppModal({
  accounts,
  onClose,
  onSent,
  initialChannelAccountId,
  initialPhone,
  initialCustomerName,
  dealRecordId,
}: {
  accounts: ChannelAccount[];
  onClose: () => void;
  onSent: (conversationId: string) => void;
  initialChannelAccountId?: string;
  initialPhone?: string;
  initialCustomerName?: string;
  dealRecordId?: string | null;
}) {
  const [channelAccountId, setChannelAccountId] = useState<string>(
    initialChannelAccountId && accounts.some((a) => a.id === initialChannelAccountId)
      ? initialChannelAccountId
      : accounts[0]?.id ?? ""
  );
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [toPhone, setToPhone] = useState(initialPhone ?? "");
  const [customerName, setCustomerName] = useState(initialCustomerName ?? "");
  const [variables, setVariables] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // Free-text body, used only by the Baileys (personal WhatsApp) branch.
  const [messageText, setMessageText] = useState("");

  // Transport of the selected sender. Baileys accounts have no
  // waPhoneNumberId; only the in-house bridge can send outbound from the CRM.
  const selectedAccount = accounts.find((a) => a.id === channelAccountId) ?? null;
  const isBaileys = !!selectedAccount && !selectedAccount.waPhoneNumberId;
  const baileysOutboundSupported =
    isBaileys && selectedAccount?.baileysBridgeProvider === "inhouse";

  // Metadata: per-template variable labels. Keyed by `${name}|${language}`.
  type MetadataRow = {
    templateName: string;
    languageCode: string;
    variableLabels: Record<string, string>;
    headerImageUrl: string | null;
  };
  const [metadata, setMetadata] = useState<MetadataRow[]>([]);
  const [editingLabel, setEditingLabel] = useState<number | null>(null);
  const [labelDraft, setLabelDraft] = useState<string>("");

  // Fetch templates AND metadata whenever the channel account changes.
  // Baileys senders have no Meta templates, so skip the fetch entirely —
  // calling the templates endpoint for them only yields a "missing WABA id"
  // error. Their compose path is the free-text box below.
  useEffect(() => {
    if (!channelAccountId) return;
    setTemplatesError(null);
    setSelectedTemplate("");
    setVariables([]);
    setMetadata([]);
    setSendError(null);
    if (isBaileys) {
      setTemplates([]);
      setTemplatesLoading(false);
      return;
    }
    setTemplatesLoading(true);
    Promise.all([
      fetch(`/api/v1/inbox/channel-accounts/${channelAccountId}/templates`).then(
        async (res) => {
          const j = await res.json();
          if (!res.ok) throw new Error(j.error?.message ?? "Failed to load templates");
          return (j.data ?? []).filter(
            (t: WhatsAppTemplate) => t.status === "APPROVED"
          ) as WhatsAppTemplate[];
        }
      ),
      fetch(
        `/api/v1/inbox/channel-accounts/${channelAccountId}/templates/metadata`
      )
        .then(async (res) => {
          const j = await res.json();
          if (!res.ok) return [] as MetadataRow[];
          return (j.data ?? []) as MetadataRow[];
        })
        .catch(() => [] as MetadataRow[]),
    ])
      .then(([tpls, meta]) => {
        setTemplates(tpls);
        setMetadata(meta);
      })
      .catch((err) => setTemplatesError(err.message))
      .finally(() => setTemplatesLoading(false));
  }, [channelAccountId, isBaileys]);

  const activeMetadata = metadata.find(
    (m) =>
      m.templateName === selectedTemplate &&
      m.languageCode ===
        (templates.find((t) => t.name === selectedTemplate)?.language ?? "")
  );

  function labelFor(index: number): string {
    return activeMetadata?.variableLabels[String(index + 1)] ?? `{{${index + 1}}}`;
  }

  async function saveLabel(index: number, value: string) {
    const tpl = templates.find((t) => t.name === selectedTemplate);
    if (!tpl) return;
    const currentLabels = { ...(activeMetadata?.variableLabels ?? {}) };
    if (value.trim()) {
      currentLabels[String(index + 1)] = value.trim();
    } else {
      delete currentLabels[String(index + 1)];
    }
    // Optimistic update so the UI doesn't flicker.
    setMetadata((prev) => {
      const key = `${tpl.name}|${tpl.language}`;
      const others = prev.filter(
        (m) => `${m.templateName}|${m.languageCode}` !== key
      );
      const prior = prev.find(
        (m) => `${m.templateName}|${m.languageCode}` === key
      );
      return [
        ...others,
        {
          templateName: tpl.name,
          languageCode: tpl.language,
          variableLabels: currentLabels,
          headerImageUrl: prior?.headerImageUrl ?? null,
        },
      ];
    });
    try {
      await fetch(
        `/api/v1/inbox/channel-accounts/${channelAccountId}/templates/metadata`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            templateName: tpl.name,
            languageCode: tpl.language,
            variableLabels: currentLabels,
          }),
        }
      );
    } catch {
      // Silent — the optimistic state keeps working, the server just didn't
      // persist. Next modal open will reload from server anyway.
    }
  }

  async function saveHeaderImageUrl(value: string) {
    const tpl = templates.find((t) => t.name === selectedTemplate);
    if (!tpl) return;
    const trimmed = value.trim();
    const next = trimmed === "" ? null : trimmed;
    setMetadata((prev) => {
      const key = `${tpl.name}|${tpl.language}`;
      const others = prev.filter(
        (m) => `${m.templateName}|${m.languageCode}` !== key
      );
      const prior = prev.find(
        (m) => `${m.templateName}|${m.languageCode}` === key
      );
      return [
        ...others,
        {
          templateName: tpl.name,
          languageCode: tpl.language,
          variableLabels: prior?.variableLabels ?? {},
          headerImageUrl: next,
        },
      ];
    });
    try {
      await fetch(
        `/api/v1/inbox/channel-accounts/${channelAccountId}/templates/metadata`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            templateName: tpl.name,
            languageCode: tpl.language,
            headerImageUrl: next,
          }),
        }
      );
    } catch {
      // Silent — reloads from server on next open.
    }
  }

  // Reset variable inputs when the selected template changes.
  useEffect(() => {
    const tpl = templates.find((t) => t.name === selectedTemplate);
    if (!tpl) {
      setVariables([]);
      return;
    }
    setVariables(Array.from({ length: tpl.bodyVariableCount }, () => ""));
  }, [selectedTemplate, templates]);

  const activeTemplate = templates.find((t) => t.name === selectedTemplate);
  const bodyText =
    activeTemplate?.components.find((c) => c.type === "BODY")?.text ?? "";
  const previewText = bodyText.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => {
    const idx = Number(n) - 1;
    return variables[idx] || `{{${n}}}`;
  });

  const headerComponent = activeTemplate?.components.find(
    (c) => c.type === "HEADER"
  );
  const headerFormat = headerComponent?.format?.toUpperCase();
  const requiresHeaderImage = headerFormat === "IMAGE";
  const headerImageUrl = activeMetadata?.headerImageUrl ?? "";

  const phoneIsValid = toPhone.trim().replace(/\D+/g, "").length >= 7;
  const canSend =
    !sending &&
    !!channelAccountId &&
    phoneIsValid &&
    (isBaileys
      ? baileysOutboundSupported && messageText.trim().length > 0
      : !!selectedTemplate &&
        variables.every((v) => v.trim().length > 0) &&
        (!requiresHeaderImage || headerImageUrl.trim().length > 0));

  async function handleSend() {
    setSending(true);
    setSendError(null);
    try {
      if (isBaileys) {
        // Baileys: free-text first message via the in-house bridge.
        const res = await fetch("/api/v1/inbox/whatsapp/send-baileys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channelAccountId,
            toPhone,
            customerName,
            body: messageText,
            dealRecordId: dealRecordId ?? null,
          }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? "Send failed");
        onSent(j.data.conversationId);
        return;
      }

      // WABA Cloud API: open the conversation with an approved template.
      const tpl = templates.find((t) => t.name === selectedTemplate);
      const res = await fetch("/api/v1/inbox/whatsapp/send-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelAccountId,
          toPhone,
          customerName,
          templateName: selectedTemplate,
          languageCode: tpl?.language ?? "de",
          bodyParams: variables,
          dealRecordId: dealRecordId ?? null,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Send failed");
      onSent(j.data.conversationId);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-background rounded-lg shadow-xl w-full max-w-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <h2 className="font-semibold text-sm">Neue WhatsApp-Nachricht</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Keine aktiven WhatsApp-Nummern konfiguriert. Bitte in den Einstellungen
              unter <b>Einstellungen → WhatsApp</b> eine Nummer hinzufügen.
            </p>
          ) : (
            <>
              {/* From (channel account) */}
              <div className="space-y-1">
                <label className="text-xs font-medium">Absender</label>
                <select
                  value={channelAccountId}
                  onChange={(e) => setChannelAccountId(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.address}
                    </option>
                  ))}
                </select>
              </div>

              {/* Recipient */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Empfänger (Telefon)</label>
                  <input
                    type="tel"
                    placeholder="+49 170 1234567"
                    value={toPhone}
                    onChange={(e) => setToPhone(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Kundenname</label>
                  <input
                    type="text"
                    placeholder="Max Mustermann"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {/* Baileys (personal WhatsApp): free-text first message.
                  No template, no 24h window — just type and send. */}
              {isBaileys &&
                (baileysOutboundSupported ? (
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Nachricht</label>
                    <textarea
                      value={messageText}
                      onChange={(e) => setMessageText(e.target.value)}
                      rows={5}
                      placeholder="Nachricht eingeben…"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-y"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Persönliches WhatsApp – freie Textnachricht, keine Vorlage
                      nötig.
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-amber-600">
                    Diese Nummer ist über den OpenClaw-Bridge verbunden, der kein
                    Senden aus dem CRM unterstützt. Stelle das Konto in den
                    Integrationen auf den hauseigenen Bridge um, um von hier zu
                    schreiben.
                  </p>
                ))}

              {/* Template picker — WABA Cloud API only */}
              {!isBaileys && (
              <div className="space-y-1">
                <label className="text-xs font-medium">Template</label>
                {templatesLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Templates werden geladen…
                  </div>
                ) : templatesError ? (
                  <p className="text-xs text-red-600">{templatesError}</p>
                ) : templates.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Keine genehmigten Templates für diese Nummer gefunden.
                  </p>
                ) : (
                  <select
                    value={selectedTemplate}
                    onChange={(e) => setSelectedTemplate(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">— Template wählen —</option>
                    {templates.map((t) => (
                      <option key={`${t.name}-${t.language}`} value={t.name}>
                        {t.name} ({t.language}, {t.category.toLowerCase()})
                      </option>
                    ))}
                  </select>
                )}
              </div>
              )}

              {/* Header image URL — required when the template has an IMAGE header */}
              {activeTemplate && requiresHeaderImage && (
                <div className="space-y-1">
                  <label className="text-xs font-medium">
                    Header-Bild URL
                    <span className="text-muted-foreground font-normal ml-1">
                      (öffentlich erreichbar, einmal pro Template gespeichert)
                    </span>
                  </label>
                  <input
                    type="url"
                    placeholder="https://…/kottke-whatsapp-header.jpg"
                    defaultValue={headerImageUrl}
                    onBlur={(e) => {
                      if (e.target.value.trim() !== headerImageUrl) {
                        void saveHeaderImageUrl(e.target.value);
                      }
                    }}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                  {headerImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={headerImageUrl}
                      alt="Header preview"
                      className="mt-2 max-h-32 rounded border border-border"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <p className="text-[11px] text-amber-600">
                      Dieses Template hat ein Header-Bild. Ohne URL lehnt
                      Meta den Versand ab (#132012).
                    </p>
                  )}
                </div>
              )}

              {/* Variable inputs */}
              {activeTemplate && variables.length > 0 && (
                <div className="space-y-2">
                  <label className="text-xs font-medium">Variablen</label>
                  {variables.map((v, i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {editingLabel === i ? (
                          <input
                            autoFocus
                            type="text"
                            value={labelDraft}
                            onChange={(e) => setLabelDraft(e.target.value)}
                            onBlur={() => {
                              void saveLabel(i, labelDraft);
                              setEditingLabel(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.currentTarget.blur();
                              } else if (e.key === "Escape") {
                                setEditingLabel(null);
                              }
                            }}
                            placeholder={`Label für {{${i + 1}}}`}
                            className="flex-1 rounded border border-input bg-background px-2 py-0.5 text-xs"
                          />
                        ) : (
                          <>
                            <span className="font-mono text-[10px] text-muted-foreground/70">
                              {`{{${i + 1}}}`}
                            </span>
                            <span className="font-medium text-foreground">
                              {activeMetadata?.variableLabels[String(i + 1)] ?? ""}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setLabelDraft(
                                  activeMetadata?.variableLabels[String(i + 1)] ?? ""
                                );
                                setEditingLabel(i);
                              }}
                              className="text-muted-foreground/60 hover:text-foreground"
                              title="Label bearbeiten"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          </>
                        )}
                      </div>
                      <input
                        type="text"
                        value={v}
                        placeholder={labelFor(i)}
                        onChange={(e) =>
                          setVariables((prev) =>
                            prev.map((pv, pi) => (pi === i ? e.target.value : pv))
                          )
                        }
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Preview */}
              {activeTemplate && (
                <div className="space-y-1">
                  <label className="text-xs font-medium">Vorschau</label>
                  <div className="rounded-md bg-muted/40 border border-border p-3 text-sm whitespace-pre-wrap">
                    {previewText}
                  </div>
                </div>
              )}

              {sendError && <p className="text-xs text-red-600">{sendError}</p>}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border shrink-0">
          <Button variant="outline" size="sm" onClick={onClose}>
            Abbrechen
          </Button>
          <Button size="sm" onClick={handleSend} disabled={!canSend}>
            {sending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Senden
          </Button>
        </div>
      </div>
    </div>
  );
}
