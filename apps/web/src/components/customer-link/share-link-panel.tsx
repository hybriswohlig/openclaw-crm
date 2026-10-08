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
  FileText,
  Download,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import { DateOfferComposer } from "./date-offer-composer";
import { PackageOptionsComposer } from "./package-options-composer";

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
  const [annahmeAktiv, setAnnahmeAktiv] = useState(false);

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

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            readOnly
            value={link.url}
            onClick={(e) => e.currentTarget.select()}
            className="h-9 min-w-[10rem] flex-1 truncate rounded-lg border border-border bg-background px-3 text-xs text-muted-foreground"
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

      <KvaAnnahmeBlock dealRecordId={dealRecordId} onChange={setAnnahmeAktiv} />

      {!revoked && <CustomerVisibleDocuments dealRecordId={dealRecordId} />}

      {!revoked && !annahmeAktiv && <PackageOptionsComposer dealRecordId={dealRecordId} />}

      {!revoked && !annahmeAktiv && <DateOfferComposer dealRecordId={dealRecordId} />}

      {!revoked && annahmeAktiv && (
        <p className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          Angebot, Pakete und Termine sind seit der Annahme gesperrt. Für Änderungen zuerst die Annahme aufheben.
        </p>
      )}
    </div>
  );
}

interface Widerrufen {
  eingegangenAt: string;
  name: string;
  bestaetigt: boolean;
}

interface AktiveAnnahme {
  abweichungen: Array<{ feld: "Termin" | "Auszug" | "Einzug"; angenommen: string; aktuell: string | null }>;
  signedAt: string;
  acceptedFullName: string | null;
  confirmedTotalCents: number;
  selectedOptionName: string | null;
  moveDate: string | null;
  versicherungGewuenscht: boolean;
  confirmationSentAt: string | null;
}

/**
 * Zeigt die aktive Kundenannahme und erlaubt Admins, sie aufzuheben. Danach
 * sind Angebot, Pakete und Termine wieder änderbar, und der Kunde muss neu
 * annehmen. Die aufgehobene Annahme bleibt als Nachweis gespeichert.
 */
function KvaAnnahmeBlock({
  dealRecordId,
  onChange,
}: {
  dealRecordId: string;
  onChange: (aktiv: boolean) => void;
}) {
  const [annahme, setAnnahme] = useState<AktiveAnnahme | null>(null);
  const [widerrufen, setWiderrufen] = useState<Widerrufen | null>(null);
  const [darfAufheben, setDarfAufheben] = useState(false);
  const [arbeitet, setArbeitet] = useState(false);

  const laden = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/deals/${dealRecordId}/kva-annahme`);
      if (!res.ok) return;
      const j = (await res.json()) as {
        data?: { aktiv: AktiveAnnahme | null; widerrufen?: Widerrufen | null; darfAufheben?: boolean };
      };
      const aktiv = j.data?.aktiv ?? null;
      setAnnahme(aktiv);
      setWiderrufen(j.data?.widerrufen ?? null);
      setDarfAufheben(j.data?.darfAufheben === true);
      onChange(!!aktiv);
    } catch {
      // Anzeige ist optional; ohne Antwort bleibt der Block leer.
    }
  }, [dealRecordId, onChange]);

  useEffect(() => {
    void laden();
  }, [laden]);

  async function aufheben() {
    const grund = window.prompt("Grund für das Aufheben (der Kunde muss danach neu annehmen):");
    if (!grund || grund.trim().length < 3) return;
    setArbeitet(true);
    try {
      const res = await fetch(`/api/v1/deals/${dealRecordId}/kva-annahme`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grund: grund.trim() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        toast.error(j?.error?.message ?? "Annahme konnte nicht aufgehoben werden.");
        return;
      }
      toast.success("Annahme aufgehoben. Der Kunde muss das Angebot neu annehmen.");
      await laden();
    } finally {
      setArbeitet(false);
    }
  }

  if (!annahme && widerrufen) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-950 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-100">
        <div className="font-medium">
          Vom Kunden widerrufen am{" "}
          {new Date(widerrufen.eingegangenAt).toLocaleString("de-DE", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "Europe/Berlin",
          })}
        </div>
        <div className="mt-1 text-xs leading-relaxed">
          {widerrufen.name} hat über den Statuslink widerrufen. Termin freigeben und bereits gezahlte Beträge binnen 14
          Tagen erstatten.{" "}
          {widerrufen.bestaetigt
            ? "Die Eingangsbestätigung ist verschickt."
            : "Die Eingangsbestätigung ist noch nicht verschickt, bitte selbst schicken."}
        </div>
      </div>
    );
  }
  if (!annahme) return null;
  const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    annahme.confirmedTotalCents / 100
  );
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
      <div className="font-medium">
        Vom Kunden angenommen am{" "}
        {new Date(annahme.signedAt).toLocaleString("de-DE", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Europe/Berlin",
        })}
      </div>
      <div className="mt-1 text-xs leading-relaxed">
        {[
          annahme.acceptedFullName,
          euro,
          annahme.selectedOptionName,
          annahme.moveDate
            ? `Termin ${new Date(`${annahme.moveDate}T12:00:00`).toLocaleDateString("de-DE")}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
      <div className="mt-1 text-xs">
        {annahme.confirmationSentAt ? "Bestätigung an den Kunden verschickt." : "Bestätigung noch nicht verschickt."}
        {annahme.versicherungGewuenscht && " Versicherungswunsch: ja."}
      </div>
      {annahme.abweichungen?.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100">
          <div className="font-medium">Seit der Annahme geändert</div>
          <ul className="mt-1 space-y-0.5">
            {annahme.abweichungen.map((a) => (
              <li key={a.feld}>
                {a.feld}: angenommen {anzeigeWert(a.feld, a.angenommen)}, jetzt {a.aktuell ? anzeigeWert(a.feld, a.aktuell) : "leer"}
              </li>
            ))}
          </ul>
          <p className="mt-1">
            Der Kunde sieht im Portal den neuen Stand. Die Änderung schriftlich bestätigen lassen (z. B. per WhatsApp)
            {darfAufheben
              ? " oder die Annahme aufheben und neu annehmen lassen."
              : " oder einen Admin bitten, die Annahme aufzuheben, damit der Kunde neu annimmt."}
          </p>
        </div>
      )}
      {darfAufheben && (
        <button
          type="button"
          onClick={aufheben}
          disabled={arbeitet}
          className="mt-3 rounded-lg border border-emerald-300 bg-white/70 px-3 py-1.5 text-xs font-medium hover:bg-white disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-900/40"
        >
          {arbeitet ? "Wird aufgehoben…" : "Annahme aufheben"}
        </button>
      )}
    </div>
  );
}

function anzeigeWert(feld: "Termin" | "Auszug" | "Einzug", wert: string): string {
  return feld === "Termin" ? new Date(`${wert}T12:00:00`).toLocaleDateString("de-DE") : wert;
}

interface DealDocumentMeta {
  id: string;
  documentType: "order_confirmation" | "invoice" | "payment_confirmation" | "worker_instructions";
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: string;
}

/**
 * Mirrors the two PDFs the customer sees on the public portal
 * (Auftragsbestätigung at Stage 2, Rechnung at Stage 4) and gives the
 * operator a one-click download + inline preview button — same endpoint
 * + download=1 pattern as financial-tab.tsx so nothing diverges.
 */
function CustomerVisibleDocuments({ dealRecordId }: { dealRecordId: string }) {
  const [docs, setDocs] = useState<DealDocumentMeta[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/deals/${dealRecordId}/documents`);
      if (!res.ok) {
        setDocs([]);
        return;
      }
      const json = (await res.json()) as { data: DealDocumentMeta[] };
      setDocs(json.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [dealRecordId]);

  useEffect(() => {
    load();
  }, [load]);

  function triggerDownload(doc: DealDocumentMeta) {
    const a = document.createElement("a");
    a.href = `/api/v1/deals/${dealRecordId}/documents/${doc.id}?download=1`;
    a.download = doc.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-card px-4 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Dokumente werden geladen…
      </div>
    );
  }

  // Only render the section when at least one customer-visible doc exists.
  // If the operator hasn't uploaded an Auftragsbestätigung or Rechnung yet
  // there's nothing for them to download from this panel, and the financial
  // tab is the right place to add it.
  const visible = (docs ?? []).filter(
    (d) => d.documentType === "order_confirmation" || d.documentType === "invoice"
  );
  if (visible.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <FileText className="h-3.5 w-3.5" />
          Kunden-Dokumente
        </div>
        <p className="mt-1">
          Noch keine Auftragsbestätigung oder Rechnung hochgeladen. PDFs werden im{" "}
          <span className="font-medium">Finanzen</span>-Tab gepflegt und
          erscheinen automatisch hier.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <FileText className="h-4 w-4" />
          Kunden-Dokumente
        </div>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Im Portal sichtbar
        </span>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        Dieselben PDFs, die der Kunde im Status-Link aufrufen kann.
      </p>

      <ul className="mt-3 space-y-2">
        {visible.map((doc) => (
          <li
            key={doc.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/40 p-3"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium">
                {DOC_TYPE_LABELS[doc.documentType]}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {doc.fileName} · {fmtBytes(doc.fileSize)}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <a
                href={`/api/v1/deals/${dealRecordId}/documents/${doc.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent"
                title="In neuem Tab ansehen"
              >
                <Eye className="h-3.5 w-3.5" />
                Vorschau
              </a>
              <button
                type="button"
                onClick={() => triggerDownload(doc)}
                className="inline-flex h-8 items-center gap-1 rounded-md bg-foreground px-2.5 text-xs font-medium text-background hover:opacity-90"
              >
                <Download className="h-3.5 w-3.5" />
                PDF
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const DOC_TYPE_LABELS: Record<DealDocumentMeta["documentType"], string> = {
  order_confirmation: "Auftragsbestätigung",
  invoice: "Rechnung",
  payment_confirmation: "Zahlungsbestätigung",
  worker_instructions: "Auftragsanweisung (Crew)",
};

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
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
