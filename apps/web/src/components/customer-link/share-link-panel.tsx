"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  Copy,
  Check,
  ExternalLink,
  Trash2,
  Link as LinkIcon,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Smartphone,
  Monitor,
  Clock,
} from "lucide-react";
import { DateOfferComposer } from "./date-offer-composer";

interface VisitTelemetry {
  sessionCount: number;
  totalActiveMs: number;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
  recent: Array<{
    sessionId: string;
    openedAt: string;
    lastHeartbeatAt: string;
    activeMs: number;
    channel: string | null;
    isMobile: boolean | null;
    stageAtOpen: number | null;
  }>;
}

interface LinkInfo {
  token: string;
  url: string;
  viewCount?: number;
  firstViewedAt?: string | null;
  lastViewedAt?: string | null;
  revokedAt?: string | null;
  telemetry?: VisitTelemetry | null;
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
  const [telemetryOpen, setTelemetryOpen] = useState(false);

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

  async function reactivate() {
    const res = await fetch(`/api/v1/customer-link/${dealRecordId}`, { method: "PATCH" });
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
  const telemetry = link.telemetry ?? null;
  const hasEngagement =
    telemetry &&
    (telemetry.sessionCount > 0 || telemetry.totalActiveMs > 0);

  return (
    <div className="space-y-3">
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

        {/* Engagement summary tile. Bigger numbers when we have data so the
            operator can size up activity at a glance; collapses to the same
            "Noch nicht geöffnet" hint otherwise. */}
        {hasEngagement ? (
          <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg border border-border/60 bg-background/40 p-3 text-center">
            <Stat
              label="Sitzungen"
              value={String(telemetry!.sessionCount)}
            />
            <Stat
              label="Zeit aktiv"
              value={formatDuration(telemetry!.totalActiveMs)}
            />
            <Stat
              label="Zuletzt"
              value={
                telemetry!.lastViewedAt
                  ? relativeFromNow(telemetry!.lastViewedAt)
                  : "—"
              }
            />
          </div>
        ) : (
          <div className="mt-3 text-[11px] text-muted-foreground">
            Noch nicht geöffnet.
          </div>
        )}

        {hasEngagement && telemetry!.recent.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setTelemetryOpen((v) => !v)}
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              {telemetryOpen ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
              {telemetryOpen ? "Verlauf ausblenden" : "Verlauf anzeigen"}
            </button>
            {telemetryOpen && (
              <ul className="mt-2 space-y-1.5 text-[11px]">
                {telemetry!.recent.map((v) => (
                  <li
                    key={v.sessionId}
                    className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-background/40 px-2 py-1.5"
                  >
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      {v.isMobile ? (
                        <Smartphone className="h-3 w-3" />
                      ) : (
                        <Monitor className="h-3 w-3" />
                      )}
                      <span className="text-foreground">
                        {new Date(v.openedAt).toLocaleString("de-DE", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </span>
                      {v.channel && v.channel !== "unknown" && (
                        <span className="rounded-full bg-muted px-1.5 py-px text-[9px] uppercase">
                          {v.channel}
                        </span>
                      )}
                      {v.stageAtOpen != null && (
                        <span className="rounded-full bg-muted px-1.5 py-px text-[9px] uppercase">
                          Stage {v.stageAtOpen}
                        </span>
                      )}
                    </span>
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {formatDuration(v.activeMs)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <div className="mt-3 flex items-center justify-end text-[11px] text-muted-foreground">
          {revoked ? (
            <button
              type="button"
              onClick={reactivate}
              className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
            >
              <RotateCcw className="h-3 w-3" />
              Re-aktivieren
            </button>
          ) : (
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

      {!revoked && <DateOfferComposer dealRecordId={dealRecordId} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-sm font-medium tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "0 s";
  const totalSeconds = Math.round(ms / 1000);
  const min = Math.floor(totalSeconds / 60);
  const sec = totalSeconds % 60;
  if (min === 0) return `${sec} s`;
  if (min < 60) return sec === 0 ? `${min} Min` : `${min} Min ${sec} s`;
  const h = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin === 0 ? `${h} h` : `${h} h ${remMin} Min`;
}

function relativeFromNow(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMs = Date.now() - then;
  if (diffMs < 60_000) return "gerade eben";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `vor ${minutes} Min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `vor ${days} Tagen`;
  return new Date(iso).toLocaleDateString("de-DE");
}
