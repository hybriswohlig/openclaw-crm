"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Loader2,
  RefreshCw,
  Mail,
  MessageCircle,
  Search,
  CheckCheck,
  AlertCircle,
  ChevronDown,
  Building2,
  AlertTriangle,
  Send,
  ArrowLeft,
  MoreVertical,
  X,
  Check,
  Tag,
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
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-start gap-3 px-4 py-3 text-left transition-colors border-b border-border/50",
        active
          ? "bg-accent"
          : "hover:bg-muted/60",
        conv.unreadCount > 0 && !active && "bg-muted/20"
      )}
    >
      {/* Avatar */}
      <div className="relative shrink-0 mt-0.5">
        <div className={cn(
          "h-10 w-10 rounded-full flex items-center justify-center text-sm font-semibold",
          "bg-primary/10 text-primary"
        )}>
          {contactInitial(conv)}
        </div>
        {/* Channel badge */}
        <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-background border border-border flex items-center justify-center">
          {isKa ? <KleinanzeigenLogo className="h-3 w-3 text-[8px]" /> : <ChannelIcon type={conv.channelType} size="xs" />}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={cn("text-sm truncate", conv.unreadCount > 0 && !active ? "font-semibold" : "font-medium")}>
              {contactLabel(conv)}
            </span>
            {isKa && <KleinanzeigenLogo />}
            {conv.multiCompanyFlag && (
              <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" aria-label="Hat mehrere Unternehmen kontaktiert" />
            )}
          </div>
          <span className="text-[10px] text-muted-foreground shrink-0">
            {fmtTime(conv.lastMessageAt)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-1 mt-0.5">
          <div className="min-w-0">
            {conv.subject && (
              <p className="text-xs text-muted-foreground truncate">{conv.subject}</p>
            )}
            <p className="text-xs text-muted-foreground truncate">
              {conv.lastMessagePreview ?? "—"}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {conv.unreadCount > 0 && !active && (
              <span className="h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center">
                {conv.unreadCount}
              </span>
            )}
          </div>
        </div>

        {/* Company tag */}
        <div className="flex items-center gap-1 mt-1">
          <span className="text-[10px] text-muted-foreground truncate">{conv.channelName}</span>
        </div>
      </div>
    </button>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: Message }) {
  const isOut = msg.direction === "outbound";
  const time = fmtFullTime(msg.sentAt ?? msg.createdAt);

  return (
    <div className={cn("flex", isOut ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[72%] rounded-2xl px-4 py-2.5 text-sm shadow-sm",
          isOut
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted text-foreground rounded-bl-sm"
        )}
      >
        <p className="whitespace-pre-wrap break-words">{msg.body}</p>
        <div className={cn(
          "flex items-center gap-1 mt-1 text-[10px]",
          isOut ? "text-primary-foreground/70 justify-end" : "text-muted-foreground"
        )}>
          <span>{time}</span>
          {isOut && (
            msg.status === "sent" || msg.status === "delivered"
              ? <CheckCheck className="h-3 w-3" />
              : msg.status === "failed"
                ? <AlertCircle className="h-3 w-3 text-red-400" />
                : null
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Conversation View ────────────────────────────────────────────────────────

function ConversationView({
  conv,
  onBack,
  onStatusChange,
}: {
  conv: Conversation;
  onBack: () => void;
  onStatusChange: (status: ConversationStatus) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(true);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    if (!reply.trim() || sending) return;
    setSending(true);
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
        textareaRef.current?.focus();
      } else {
        const err = await res.json();
        alert(err.error ?? "Senden fehlgeschlagen");
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

  const canSend = conv.channelType === "email"; // WhatsApp send requires live API

  const isKa = isKleinanzeigenConv(conv);

  return (
    <div className="flex flex-col h-full">
      {/* Company banner */}
      <div className="flex items-center justify-center gap-2 px-4 py-1.5 border-b border-border bg-muted/40 shrink-0">
        {isKa && <KleinanzeigenLogo />}
        <span className="text-[11px] text-muted-foreground">
          {isKa ? "Kleinanzeigen · " : ""}{conv.channelName}
        </span>
      </div>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background shrink-0">
        <button onClick={onBack} className="md:hidden text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </button>

        <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm shrink-0">
          {contactInitial(conv)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-sm truncate">{contactLabel(conv)}</p>
            {conv.multiCompanyFlag && (
              <span className="flex items-center gap-1 text-[10px] text-amber-600 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5 shrink-0">
                <AlertTriangle className="h-2.5 w-2.5" />
                Mehrere Firmen
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <ChannelIcon type={conv.channelType} />
            <span className="text-xs text-muted-foreground">{conv.channelName}</span>
            {conv.contactEmail && (
              <span className="text-xs text-muted-foreground">· {conv.contactEmail}</span>
            )}
          </div>
        </div>

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

      {/* Subject bar (email) */}
      {conv.subject && (
        <div className="px-4 py-2 bg-muted/30 border-b border-border text-xs text-muted-foreground">
          <span className="font-medium">Betreff:</span> {conv.subject}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {loadingMsgs ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-12">Keine Nachrichten</p>
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)
        )}
        <div ref={bottomRef} />
      </div>

      {/* Reply box */}
      <div className="border-t border-border px-4 py-3 bg-background shrink-0">
        {canSend ? (
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              className="flex-1 rounded-xl border border-input bg-muted/30 px-3 py-2 text-sm resize-none min-h-[42px] max-h-36 focus:outline-none focus:ring-2 focus:ring-ring/20"
              placeholder="Nachricht schreiben…"
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
              disabled={!reply.trim() || sending}
              size="sm"
              className="rounded-xl h-[42px] px-3"
            >
              {sending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Send className="h-4 w-4" />
              }
            </Button>
          </div>
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
  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ConversationStatus>("open");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "kleinanzeigen">("all");
  const [search, setSearch] = useState("");

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
    if (sourceFilter === "kleinanzeigen" && !isKleinanzeigenConv(c)) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      contactLabel(c).toLowerCase().includes(q) ||
      (c.subject?.toLowerCase().includes(q) ?? false) ||
      (c.lastMessagePreview?.toLowerCase().includes(q) ?? false)
    );
  });

  const unreadTotal = conversations.reduce((s, c) => s + c.unreadCount, 0);

  return (
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
            <div>
              <h1 className="font-semibold text-base">Posteingang</h1>
              {unreadTotal > 0 && (
                <p className="text-xs text-muted-foreground">{unreadTotal} ungelesen</p>
              )}
            </div>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="E-Mails abrufen"
            >
              <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
            </button>
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
          <div className="flex gap-1.5">
            <button
              onClick={() => setSourceFilter("all")}
              className={cn(
                "shrink-0 flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors",
                sourceFilter === "all"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              <Tag className="h-3 w-3" />
              Alle Quellen
            </button>
            <button
              onClick={() => {
                setSourceFilter(sourceFilter === "kleinanzeigen" ? "all" : "kleinanzeigen");
                setAccountFilter("all");
                setSelected(null);
              }}
              className={cn(
                "shrink-0 flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors",
                sourceFilter === "kleinanzeigen"
                  ? "bg-[#96c11f] text-white border-[#96c11f]"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
              title="Nur Kleinanzeigen (alle Firmen kombiniert)"
            >
              <KleinanzeigenLogo />
              Kleinanzeigen
            </button>
          </div>

          {sourceFilter === "kleinanzeigen" && (
            <p className="text-[10px] text-muted-foreground px-0.5">
              Kombinierter Posteingang aller Firmen. Jede Nachricht zeigt unten, zu welcher Firma sie gehört.
            </p>
          )}

          {/* Account filter */}
          {sourceFilter !== "kleinanzeigen" && accounts.length > 1 && (
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
                  E-Mails jetzt abrufen
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
              E-Mails jetzt abrufen
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
