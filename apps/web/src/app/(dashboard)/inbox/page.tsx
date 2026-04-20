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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

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
}

interface Conversation {
  id: string;
  channelAccountId: string;
  channelType: ChannelType;
  channelName: string;
  channelAddress: string;
  operatingCompanyRecordId: string | null;
  contactId: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  multiCompanyFlag: boolean;
  subject: string | null;
  status: ConversationStatus;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  dealRecordId: string | null;
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

  return (
    <div className={cn("flex items-end gap-2", isOut ? "justify-end" : "justify-start")}>
      {/* Inbound avatar slot (only on last bubble of a burst) */}
      {!isOut && (
        <div className={cn("shrink-0 w-7", showAvatar ? "" : "invisible")}>
          <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[11px] font-semibold">
            {contactInitial(conv)}
          </div>
        </div>
      )}

      <div
        className={cn(
          "group/bubble max-w-[72%] rounded-2xl px-3.5 py-2 text-sm",
          isOut
            ? "bg-primary text-primary-foreground rounded-br-md shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
            : "bg-muted text-foreground rounded-bl-md"
        )}
      >
        <p className="whitespace-pre-wrap break-words leading-snug">{msg.body}</p>
        <div
          className={cn(
            "flex items-center gap-1 mt-0.5 text-[10px] tabular-nums",
            isOut ? "text-primary-foreground/70 justify-end" : "text-muted-foreground/80"
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
  onStatusChange,
  onOpenCompose,
}: {
  conv: Conversation;
  onBack: () => void;
  onStatusChange: (status: ConversationStatus) => void;
  onOpenCompose?: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(true);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<{ code?: string; message?: string } | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<File | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchMessages = useCallback(async () => {
    setLoadingMsgs(true);
    try {
      const res = await fetch(`/api/v1/inbox/conversations/${conv.id}/messages`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.data ?? []);
      }
    } finally {
      setLoadingMsgs(false);
    }
  }, [conv.id]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
        setMessages((prev) => [...prev, data.data]);
        setReply("");
        setSendError(null);
        textareaRef.current?.focus();
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
        setMessages((prev) => [...prev, data.data]);
        setReply("");
        setPendingAttachment(null);
        setSendError(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        textareaRef.current?.focus();
      } else {
        const err = await res.json().catch(() => ({}));
        const errObj = typeof err.error === "object" ? err.error : { message: err.error };
        setSendError(errObj);
      }
    } finally {
      setSending(false);
    }
  }

  async function handleStatusChange(status: ConversationStatus) {
    setShowMenu(false);
    await fetch(`/api/v1/inbox/conversations/${conv.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    onStatusChange(status);
  }

  const canSend = conv.channelType === "email" || conv.channelType === "whatsapp";

  const isKa = isKleinanzeigenConv(conv);
  const isWa = conv.channelType === "whatsapp";

  return (
    <div className="flex flex-col h-full bg-muted/20">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background shrink-0">
        <button onClick={onBack} className="md:hidden text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </button>

        <div className="relative shrink-0">
          <div className={cn(
            "h-11 w-11 rounded-full flex items-center justify-center font-semibold text-base",
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
          <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
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
            <span>·</span>
            <span className="truncate">{conv.channelName}</span>
            {conv.contactEmail && !isWa && (
              <>
                <span>·</span>
                <span className="truncate">{conv.contactEmail}</span>
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

        {/* Quick resolve */}
        {conv.status === "open" && (
          <button
            onClick={() => handleStatusChange("resolved")}
            className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-emerald-500/30 text-emerald-700 bg-emerald-500/5 hover:bg-emerald-500/10 transition-colors"
          >
            <Check className="h-3.5 w-3.5" />
            Erledigt
          </button>
        )}

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
              <div className="absolute right-0 top-9 z-50 w-48 rounded-lg border border-border bg-popover shadow-lg py-1">
                {conv.status !== "resolved" && (
                  <button
                    onClick={() => handleStatusChange("resolved")}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted transition-colors text-emerald-600"
                  >
                    <Check className="h-4 w-4" />
                    Als erledigt markieren
                  </button>
                )}
                {conv.status !== "open" && (
                  <button
                    onClick={() => handleStatusChange("open")}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted transition-colors"
                  >
                    <MessageCircle className="h-4 w-4" />
                    Wieder öffnen
                  </button>
                )}
                {conv.status !== "spam" && (
                  <button
                    onClick={() => handleStatusChange("spam")}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted transition-colors text-destructive"
                  >
                    <X className="h-4 w-4" />
                    Als Spam markieren
                  </button>
                )}
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

      {/* Messages */}
      <div
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
        <div ref={bottomRef} />
      </div>

      {/* Reply box */}
      <div className="border-t border-border px-4 py-3 bg-background shrink-0 space-y-2">
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
              <textarea
                ref={textareaRef}
                className="flex-1 bg-transparent text-sm resize-none min-h-[28px] max-h-36 focus:outline-none placeholder:text-muted-foreground"
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
                  if (e.key === "Enter" && !e.shiftKey) {
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
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function InboxPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ConversationStatus>("open");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<"messaging" | "kleinanzeigen" | "whatsapp" | "other">("messaging");
  const [search, setSearch] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  // Deep-link prefill for the compose dialog, populated from URL params when
  // the user arrives from the leads table.
  const [composePrefill, setComposePrefill] = useState<{
    channelAccountId?: string;
    toPhone?: string;
    customerName?: string;
    dealRecordId?: string | null;
  }>({});

  const fetchConversations = useCallback(async () => {
    const params = new URLSearchParams({ status: statusFilter });
    if (accountFilter !== "all") params.set("channelAccountId", accountFilter);
    const res = await fetch(`/api/v1/inbox/conversations?${params}`);
    if (res.ok) {
      const data = await res.json();
      setConversations(data.data ?? []);
    }
  }, [statusFilter, accountFilter]);

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

  // Handle deep links from the leads table:
  //   ?conv=<id>               → auto-select that conversation
  //   ?compose=1&phone=…&name=…&channelAccountId=…&dealRecordId=…
  //                            → auto-open composer pre-filled, so the
  //                              resulting conversation is linked to the lead
  useEffect(() => {
    const convParam = searchParams.get("conv");
    const composeParam = searchParams.get("compose");
    if (!convParam && !composeParam) return;

    if (composeParam === "1") {
      setComposePrefill({
        channelAccountId: searchParams.get("channelAccountId") ?? undefined,
        toPhone: searchParams.get("phone") ?? undefined,
        customerName: searchParams.get("name") ?? undefined,
        dealRecordId: searchParams.get("dealRecordId") ?? null,
      });
      setComposeOpen(true);
      // Clean the URL so a reload doesn't re-open the dialog.
      router.replace("/inbox");
      return;
    }

    if (convParam && conversations.length > 0) {
      const match = conversations.find((c) => c.id === convParam);
      if (match) {
        setSelected(match);
        // If the match isn't visible under the current filter, clear filter
        // so the user actually sees it highlighted in the list.
        if (match.status !== statusFilter) {
          setStatusFilter(match.status);
        }
        router.replace("/inbox");
      }
    }
  }, [searchParams, conversations, router, statusFilter]);

  async function handleSync() {
    setSyncing(true);
    try {
      await fetch("/api/v1/inbox/sync", { method: "POST" });
      await fetchConversations();
    } finally {
      setSyncing(false);
    }
  }

  function handleStatusChange(convId: string, status: ConversationStatus) {
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, status } : c))
    );
    if (selected?.id === convId) {
      if (status !== statusFilter) {
        setSelected(null);
      } else {
        setSelected((s) => s ? { ...s, status } : s);
      }
    }
  }

  const filtered = conversations.filter((c) => {
    const isKa = isKleinanzeigenConv(c);
    const isWa = c.channelType === "whatsapp";
    if (sourceFilter === "messaging" && !(isKa || isWa)) return false;
    if (sourceFilter === "kleinanzeigen" && !isKa) return false;
    if (sourceFilter === "whatsapp" && !isWa) return false;
    if (sourceFilter === "other" && (isKa || isWa)) return false;
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
          "flex flex-col border-r border-border bg-background",
          "w-full md:w-80 lg:w-96 shrink-0",
          selected ? "hidden md:flex" : "flex"
        )}
      >
        {/* Header */}
        <div className="px-4 pt-4 pb-2 shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h1 className="font-semibold text-base">Posteingang</h1>
              {unreadTotal > 0 && (
                <span className="h-5 min-w-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center">
                  {unreadTotal}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
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

          {/* Status tabs */}
          <div className="flex rounded-lg bg-muted p-0.5 text-xs">
            {(["open", "resolved", "spam"] as ConversationStatus[]).map((s) => (
              <button
                key={s}
                onClick={() => { setStatusFilter(s); setSelected(null); }}
                className={cn(
                  "flex-1 rounded-md py-1 font-medium transition-colors",
                  statusFilter === s
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {s === "open" ? "Offen" : s === "resolved" ? "Erledigt" : "Spam"}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
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
              {!search && statusFilter === "open" && (
                <button
                  onClick={handleSync}
                  className="text-xs text-primary hover:underline mt-1"
                >
                  Jetzt abrufen
                </button>
              )}
            </div>
          ) : (
            filtered.map((conv) => (
              <ConvListItem
                key={conv.id}
                conv={conv}
                active={selected?.id === conv.id}
                onClick={() => setSelected(conv)}
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
        {selected ? (
          <ConversationView
            key={selected.id}
            conv={selected}
            onBack={() => setSelected(null)}
            onStatusChange={(status) => handleStatusChange(selected.id, status)}
            onOpenCompose={() => setComposeOpen(true)}
          />
        ) : (
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
// First-contact flow: pick a business number, enter recipient phone + name,
// pick an approved template, fill its `{{n}}` variables, send. Meta only
// allows outbound-initiated conversations via approved templates, which is
// why the composer below doesn't offer a free-text option.

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
  useEffect(() => {
    if (!channelAccountId) return;
    setTemplatesLoading(true);
    setTemplatesError(null);
    setSelectedTemplate("");
    setVariables([]);
    setMetadata([]);
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
  }, [channelAccountId]);

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

  const canSend =
    !sending &&
    channelAccountId &&
    toPhone.trim().replace(/\D+/g, "").length >= 7 &&
    selectedTemplate &&
    variables.every((v) => v.trim().length > 0) &&
    (!requiresHeaderImage || headerImageUrl.trim().length > 0);

  async function handleSend() {
    setSending(true);
    setSendError(null);
    try {
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

              {/* Template picker */}
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
