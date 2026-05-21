"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Copy, Check, ExternalLink, Trash2, Link as LinkIcon } from "lucide-react";

interface LinkInfo {
  token: string;
  url: string;
  viewCount?: number;
  firstViewedAt?: string | null;
  lastViewedAt?: string | null;
  revokedAt?: string | null;
}

/**
 * Share panel rendered on the Lead detail page. Shows the customer's
 * status-link URL with copy / open / revoke actions plus a tiny usage
 * counter so the operator sees engagement at a glance.
 */
export function ShareLinkPanel({ dealRecordId }: { dealRecordId: string }) {
  const [link, setLink] = useState<LinkInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/customer-link/${dealRecordId}`);
      if (res.status === 404) {
        setLink(null);
      } else if (res.ok) {
        const json = (await res.json()) as { data: LinkInfo };
        setLink(json.data);
      }
    } finally {
      setLoading(false);
    }
  }, [dealRecordId]);

  useEffect(() => {
    load();
  }, [load]);

  const [disabledForOc, setDisabledForOc] = useState(false);

  async function createLink() {
    setCreating(true);
    try {
      const res = await fetch(`/api/v1/customer-link/${dealRecordId}`, {
        method: "POST",
      });
      if (res.ok) {
        const json = (await res.json()) as {
          data: LinkInfo & { skipped?: boolean };
        };
        if (json.data.skipped) {
          setDisabledForOc(true);
          setLink(null);
        } else {
          setLink(json.data);
        }
      }
    } finally {
      setCreating(false);
    }
  }

  async function revoke() {
    if (!confirm("Soll der Kunden-Link wirklich gesperrt werden? Bestehende Bestätigungen bleiben erhalten.")) return;
    const res = await fetch(`/api/v1/customer-link/${dealRecordId}`, { method: "DELETE" });
    if (res.ok) await load();
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-card px-4 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Kunden-Link wird geladen…
      </div>
    );
  }

  if (disabledForOc) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <LinkIcon className="h-4 w-4" /> Kunden-Status-Link
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Das Status-Portal ist für diese Firma in den{" "}
          <a className="underline" href="/settings/customer-portal">
            Einstellungen
          </a>{" "}
          deaktiviert.
        </p>
      </div>
    );
  }

  if (!link) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <LinkIcon className="h-4 w-4" /> Kunden-Status-Link
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Noch kein Link erstellt. Sobald ein Kostenvoranschlag gespeichert wird,
          erstellt das System den Link automatisch. Du kannst ihn auch hier
          jetzt schon manuell anlegen.
        </p>
        <button
          type="button"
          onClick={createLink}
          disabled={creating}
          className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LinkIcon className="h-3.5 w-3.5" />}
          Link jetzt erstellen
        </button>
      </div>
    );
  }

  const revoked = !!link.revokedAt;

  return (
    <div className="rounded-xl border border-border/50 bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <LinkIcon className="h-4 w-4" />
          Kunden-Status-Link
        </div>
        {revoked ? (
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-destructive">
            Gesperrt
          </span>
        ) : (
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {link.viewCount ?? 0}× geöffnet
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          readOnly
          value={link.url}
          onClick={(e) => e.currentTarget.select()}
          className="h-9 flex-1 truncate rounded-lg border border-border bg-background px-3 text-xs text-muted-foreground"
        />
        <button
          type="button"
          onClick={copy}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium hover:bg-accent"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Kopiert" : "Kopieren"}
        </button>
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium hover:bg-accent"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Öffnen
        </a>
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          {link.lastViewedAt
            ? `Zuletzt geöffnet: ${new Date(link.lastViewedAt).toLocaleString("de-DE")}`
            : "Noch nicht geöffnet"}
        </span>
        {!revoked && (
          <button
            type="button"
            onClick={revoke}
            className="inline-flex items-center gap-1 text-destructive hover:underline"
          >
            <Trash2 className="h-3 w-3" />
            sperren
          </button>
        )}
      </div>
    </div>
  );
}
