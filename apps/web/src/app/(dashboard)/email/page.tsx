"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Mail,
  RefreshCw,
  Loader2,
  Search,
  Send,
  ArrowLeft,
  CheckCircle2,
  RotateCcw,
  Paperclip,
  Download,
  Inbox as InboxIcon,
  PenLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

// ─── Types (mirror the inbox service payloads) ───────────────────────────────

interface EmailConversation {
  id: string;
  channelType: "email" | "whatsapp";
  channelName: string;
  channelAddress: string;
  operatingCompanyRecordId: string | null;
  contactId: string;
  contactName: string | null;
  contactEmail: string | null;
  subject: string | null;
  status: "open" | "resolved" | "spam";
  lane: "lead" | "info" | "spam" | "review";
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  isKleinanzeigen: boolean;
}

interface EmailAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

interface EmailMessage {
  id: string;
  direction: "inbound" | "outbound";
  body: string | null;
  bodyHtml: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  subject: string | null;
  sentAt: string | null;
  isRead: boolean;
  attachments: EmailAttachment[];
}

interface OperatingCompany {
  id: string;
  name: string;
}

interface EmailAccount {
  id: string;
  name: string;
  address: string;
  channelType: "email" | "whatsapp";
  operatingCompanyRecordId: string | null;
  emailProvider: string | null;
  isActive: boolean;
}

type Bucket = "direct" | "kleinanzeigen" | "spam" | "all";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string | null, email: string | null): string {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function fmtListTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "short" });
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function fmtFullTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function EmailPage() {
  const [convs, setConvs] = useState<EmailConversation[]>([]);
  const [companies, setCompanies] = useState<OperatingCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const [bucket, setBucket] = useState<Bucket>("direct");
  const [statusFilter, setStatusFilter] = useState<"open" | "resolved">("open");
  const [search, setSearch] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [mobileThread, setMobileThread] = useState(false);

  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  // In-flight guards: button `disabled` relies on async state, so a fast double
  // click can fire two sends before the re-render. A ref blocks the second.
  const sendingRef = useRef(false);
  const composingRef = useRef(false);

  // Compose (new email) dialog state.
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeFrom, setComposeFrom] = useState("");
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeSending, setComposeSending] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);

  // ── Data loaders ──────────────────────────────────────────────────────────

  const fetchConvs = useCallback(async () => {
    try {
      // lane=all disables the positive lane filter; excludeLane=lead then drops
      // the lead pipeline (owned by the main Inbox) so the mailbox never
      // duplicates it. Net: direct correspondence + Kleinanzeigen infos + spam.
      const res = await fetch(
        `/api/v1/inbox/conversations?channelType=email&lane=all&excludeLane=lead&status=${statusFilter}&limit=500`
      );
      if (res.ok) {
        const json = (await res.json()) as { data: EmailConversation[] };
        setConvs(json.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    setLoading(true);
    fetchConvs();
  }, [fetchConvs]);

  useEffect(() => {
    fetch("/api/v1/operating-companies")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.data && setCompanies(j.data))
      .catch(() => {});

    fetch("/api/v1/inbox/channel-accounts")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const accs: EmailAccount[] = (j?.data ?? []).filter(
          (a: EmailAccount) => a.channelType === "email" && a.isActive
        );
        setEmailAccounts(accs);
        if (accs.length > 0) setComposeFrom((prev) => prev || accs[0].id);
      })
      .catch(() => {});
  }, []);

  // Light auto-refresh so new mail surfaces without a manual sync click.
  useEffect(() => {
    const id = setInterval(fetchConvs, 30000);
    return () => clearInterval(id);
  }, [fetchConvs]);

  const fetchThread = useCallback(async (id: string) => {
    setThreadLoading(true);
    try {
      const res = await fetch(`/api/v1/inbox/conversations/${id}/messages`);
      if (res.ok) {
        const json = (await res.json()) as { data: EmailMessage[] };
        setMessages(json.data ?? []);
      }
    } finally {
      setThreadLoading(false);
    }
  }, []);

  function openConv(id: string) {
    setSelectedId(id);
    setMobileThread(true);
    setReply("");
    setSendError(null);
    fetchThread(id);
    // Optimistically clear the unread badge in the list.
    setConvs((prev) => prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
  }

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSync() {
    setSyncing(true);
    try {
      await fetch("/api/v1/inbox/sync", { method: "POST" });
      await fetchConvs();
      if (selectedId) await fetchThread(selectedId);
    } finally {
      setSyncing(false);
    }
  }

  async function handleSend() {
    if (!reply.trim() || !selectedId || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/v1/inbox/conversations/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = typeof err.error === "object" ? err.error?.message : err.error;
        setSendError(msg ?? "Senden fehlgeschlagen.");
        return;
      }
      setReply("");
      await fetchThread(selectedId);
      await fetchConvs();
    } catch {
      setSendError("Netzwerkfehler beim Senden.");
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  }

  async function handleResolve(toStatus: "resolved" | "open") {
    if (!selectedId) return;
    await fetch(`/api/v1/inbox/conversations/${selectedId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: toStatus }),
    });
    await fetchConvs();
    // Resolving removes it from the "Offen" list — drop the reading pane.
    if (toStatus === "resolved" && statusFilter === "open") {
      setSelectedId(null);
      setMobileThread(false);
    }
  }

  function openCompose() {
    setComposeError(null);
    setComposeTo("");
    setComposeSubject("");
    setComposeBody("");
    if (!composeFrom && emailAccounts[0]) setComposeFrom(emailAccounts[0].id);
    setComposeOpen(true);
  }

  async function handleCompose() {
    if (!composeFrom || !composeTo.trim() || !composeBody.trim() || composingRef.current) return;
    composingRef.current = true;
    setComposeSending(true);
    setComposeError(null);
    try {
      const res = await fetch("/api/v1/inbox/email/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelAccountId: composeFrom,
          to: composeTo.trim(),
          subject: composeSubject.trim(),
          body: composeBody.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = typeof json.error === "object" ? json.error?.message : json.error;
        setComposeError(msg ?? "Senden fehlgeschlagen.");
        return;
      }
      setComposeOpen(false);
      // Outbound threads land in the 'info' lane (non-Kleinanzeigen) → they show
      // in the Posteingang bucket. Switch there so the new mail is visible.
      setBucket("direct");
      setStatusFilter("open");
      await fetchConvs();
      const newId = json.data?.conversationId as string | undefined;
      if (newId) openConv(newId);
    } catch {
      setComposeError("Netzwerkfehler beim Senden.");
    } finally {
      setComposeSending(false);
      composingRef.current = false;
    }
  }

  // ── Derived list ────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return convs.filter((c) => {
      // Bucket split: keep Kleinanzeigen and spam out of the main "Direkt" view.
      if (bucket === "direct" && (c.isKleinanzeigen || c.lane === "spam")) return false;
      if (bucket === "kleinanzeigen" && !c.isKleinanzeigen) return false;
      if (bucket === "spam" && c.lane !== "spam") return false;
      if (!q) return true;
      return (
        (c.contactName ?? "").toLowerCase().includes(q) ||
        (c.contactEmail ?? "").toLowerCase().includes(q) ||
        (c.subject ?? "").toLowerCase().includes(q) ||
        (c.lastMessagePreview ?? "").toLowerCase().includes(q)
      );
    });
  }, [convs, bucket, search]);

  const counts = useMemo(() => {
    let direct = 0,
      ka = 0,
      spam = 0;
    for (const c of convs) {
      if (c.lane === "spam") spam++;
      else if (c.isKleinanzeigen) ka++;
      else direct++;
    }
    return { direct, ka, spam, all: convs.length };
  }, [convs]);

  const selected = convs.find((c) => c.id === selectedId) ?? null;
  const companyName = (id: string | null) =>
    id ? companies.find((c) => c.id === id)?.name ?? null : null;

  const buckets: { key: Bucket; label: string; count: number }[] = [
    { key: "direct", label: "Posteingang", count: counts.direct },
    { key: "kleinanzeigen", label: "Kleinanzeigen", count: counts.ka },
    { key: "spam", label: "Spam", count: counts.spam },
    { key: "all", label: "Alle", count: counts.all },
  ];

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-[100dvh] md:h-full overflow-hidden">
      {/* ── List pane ── */}
      <div
        className={`${
          mobileThread ? "hidden" : "flex"
        } md:flex w-full md:w-[360px] lg:w-[400px] shrink-0 flex-col border-r border-border bg-card/40`}
      >
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-border space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="flex items-center gap-2 text-base font-semibold">
              <Mail className="h-4 w-4 text-primary" />
              E-Mail
            </h1>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
                {syncing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                <span className="ml-1.5 hidden sm:inline">Abrufen</span>
              </Button>
              <Button size="sm" onClick={openCompose} disabled={emailAccounts.length === 0}>
                <PenLine className="h-3.5 w-3.5" />
                <span className="ml-1.5">Neu</span>
              </Button>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Suchen (Name, Betreff, E-Mail)"
              className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-1.5 text-sm"
            />
          </div>

          {/* Bucket chips */}
          <div className="flex flex-wrap gap-1.5">
            {buckets.map((b) => (
              <button
                key={b.key}
                onClick={() => setBucket(b.key)}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium border transition-colors ${
                  bucket === b.key
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-primary/40"
                }`}
              >
                {b.label}
                <span className={bucket === b.key ? "opacity-80" : "opacity-60"}>{b.count}</span>
              </button>
            ))}
          </div>

          {/* Status toggle */}
          <div className="flex gap-1.5">
            {(["open", "resolved"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`flex-1 rounded-md px-2 py-1 text-xs font-medium border transition-colors ${
                  statusFilter === s
                    ? "bg-muted text-foreground border-border"
                    : "bg-background text-muted-foreground border-transparent hover:border-border"
                }`}
              >
                {s === "open" ? "Offen" : "Erledigt"}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Wird geladen…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 text-center text-sm text-muted-foreground p-8">
              <InboxIcon className="h-7 w-7 opacity-40" />
              <p>Keine E-Mails in dieser Ansicht.</p>
            </div>
          ) : (
            filtered.map((c) => {
              const active = c.id === selectedId;
              const unread = c.unreadCount > 0;
              return (
                <button
                  key={c.id}
                  onClick={() => openConv(c.id)}
                  className={`w-full text-left px-3.5 py-3 border-b border-border/60 flex gap-3 transition-colors ${
                    active ? "bg-muted" : "hover:bg-muted/50"
                  }`}
                >
                  <span
                    className="h-9 w-9 shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold"
                    aria-hidden
                  >
                    {initials(c.contactName, c.contactEmail)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`truncate text-sm ${unread ? "font-semibold" : "font-medium"}`}>
                        {c.contactName || c.contactEmail || "Unbekannt"}
                      </span>
                      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                        {fmtListTime(c.lastMessageAt)}
                      </span>
                    </div>
                    <div className={`truncate text-xs ${unread ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                      {c.subject || "(kein Betreff)"}
                    </div>
                    <div className="truncate text-xs text-muted-foreground mt-0.5">
                      {c.lastMessagePreview || ""}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      {c.isKleinanzeigen && (
                        <span className="inline-flex rounded px-1.5 py-px text-[10px] bg-amber-500/10 text-amber-600 border border-amber-400/20">
                          Kleinanzeigen
                        </span>
                      )}
                      {companyName(c.operatingCompanyRecordId) && (
                        <span className="inline-flex rounded px-1.5 py-px text-[10px] bg-muted text-muted-foreground border border-border">
                          {companyName(c.operatingCompanyRecordId)}
                        </span>
                      )}
                      {unread && (
                        <span className="ml-auto inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-semibold h-4 min-w-4 px-1">
                          {c.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Reading pane ── */}
      <div className={`${mobileThread ? "flex" : "hidden"} md:flex flex-1 flex-col min-w-0`}>
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground gap-3 p-8">
            <Mail className="h-10 w-10 opacity-30" />
            <p className="text-sm">Waehle links eine E-Mail aus.</p>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="border-b border-border px-4 md:px-6 py-3 flex items-start gap-3 shrink-0">
              <button
                onClick={() => {
                  setMobileThread(false);
                }}
                className="md:hidden mt-0.5 text-muted-foreground"
                aria-label="Zurueck"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-sm truncate">
                  {selected.subject || "(kein Betreff)"}
                </h2>
                <p className="text-xs text-muted-foreground truncate">
                  {selected.contactName ? `${selected.contactName} · ` : ""}
                  {selected.contactEmail}
                  {companyName(selected.operatingCompanyRecordId)
                    ? ` · ${companyName(selected.operatingCompanyRecordId)}`
                    : ""}
                </p>
              </div>
              {selected.status === "resolved" ? (
                <Button size="sm" variant="outline" onClick={() => handleResolve("open")}>
                  <RotateCcw className="h-3.5 w-3.5 sm:mr-1.5" />
                  <span className="hidden sm:inline">Wieder oeffnen</span>
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => handleResolve("resolved")}>
                  <CheckCircle2 className="h-3.5 w-3.5 sm:mr-1.5" />
                  <span className="hidden sm:inline">Erledigt</span>
                </Button>
              )}
            </div>

            {/* Thread body */}
            <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-3 bg-muted/20">
              {threadLoading && messages.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Wird geladen…
                </div>
              ) : (
                messages.map((m) => {
                  const outbound = m.direction === "outbound";
                  return (
                    <div
                      key={m.id}
                      className={`rounded-lg border p-3.5 max-w-[680px] ${
                        outbound
                          ? "ml-auto bg-primary/5 border-primary/20"
                          : "mr-auto bg-card border-border"
                      }`}
                    >
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground mb-1.5">
                        <span className="font-medium text-foreground">
                          {outbound ? "Du" : m.fromAddress || selected.contactName || "Kunde"}
                        </span>
                        <span>→ {m.toAddress || (outbound ? selected.contactEmail : selected.channelAddress)}</span>
                        <span className="ml-auto">{fmtFullTime(m.sentAt)}</span>
                      </div>
                      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                        {m.body || ""}
                      </p>
                      {m.attachments.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {m.attachments.map((att) => {
                            const url = `/api/v1/inbox/attachments/${att.id}/content`;
                            if (att.mimeType.startsWith("image/")) {
                              return (
                                // eslint-disable-next-line @next/next/no-img-element
                                <a key={att.id} href={url} target="_blank" rel="noreferrer">
                                  <img
                                    src={url}
                                    alt={att.fileName}
                                    className="max-h-44 rounded-md border border-border object-cover"
                                  />
                                </a>
                              );
                            }
                            return (
                              <a
                                key={att.id}
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs hover:bg-muted"
                              >
                                <Paperclip className="h-3.5 w-3.5" />
                                <span className="max-w-40 truncate">{att.fileName}</span>
                                <span className="text-muted-foreground">{fmtSize(att.fileSize)}</span>
                                <Download className="h-3.5 w-3.5 text-muted-foreground" />
                              </a>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={threadEndRef} />
            </div>

            {/* Composer */}
            <div className="border-t border-border px-4 md:px-6 py-3 shrink-0 space-y-2">
              {sendError && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  {sendError}
                </div>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Antwort schreiben…  (Cmd/Strg + Enter sendet)"
                  rows={2}
                  className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[44px] max-h-40"
                />
                <Button onClick={handleSend} disabled={sending || !reply.trim()} className="shrink-0">
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  <span className="ml-1.5 hidden sm:inline">Senden</span>
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Compose new email */}
      <Dialog open={composeOpen} onOpenChange={(v) => !v && setComposeOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Neue E-Mail</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {emailAccounts.length > 1 ? (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Von</label>
                <select
                  value={composeFrom}
                  onChange={(e) => setComposeFrom(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {emailAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.address})
                    </option>
                  ))}
                </select>
              </div>
            ) : emailAccounts.length === 1 ? (
              <p className="text-xs text-muted-foreground">
                Von: <span className="font-medium text-foreground">{emailAccounts[0].address}</span>
              </p>
            ) : null}

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">An *</label>
              <input
                type="email"
                value={composeTo}
                onChange={(e) => setComposeTo(e.target.value)}
                placeholder="kunde@example.com"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Betreff</label>
              <input
                type="text"
                value={composeSubject}
                onChange={(e) => setComposeSubject(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Nachricht *</label>
              <textarea
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                rows={8}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
              />
            </div>
            {composeError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {composeError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setComposeOpen(false)}>
              Abbrechen
            </Button>
            <Button
              onClick={handleCompose}
              disabled={composeSending || !composeTo.trim() || !composeBody.trim()}
            >
              {composeSending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <Send className="h-4 w-4 mr-1.5" />
              )}
              Senden
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
