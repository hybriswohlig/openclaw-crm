// apps/web/src/components/inbox/context-panel.tsx
//
// Zendesk-style context panel on the right side of an open inbox
// conversation. Quick access to: Status-Link erstellen (guided wizard),
// Auftragsbestätigung / Rechnung erstellen (with missing-data check +
// KI-Analyse), Kostenrechner (same mechanism as the Auftragsübersicht), and
// the deal's generated documents.
//
// On lg+ it renders as a static third column; below that as an overlay
// drawer with backdrop. All data hangs off the conversation's dealRecordId.
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Calculator,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  Receipt,
  Sparkles,
  X,
} from "lucide-react";
import { type AgentStage, normalizeAgentStage } from "@/lib/agent-stage";
import { cn } from "@/lib/utils";
import {
  GenerateDocumentDialog,
  type DealData,
  type DocumentType,
  type PrefilledPreise,
} from "@/components/GenerateDocumentDialog";
import { QuotationCalculator } from "@/components/quotation/quotation-calculator";
import { StatusLinkWizard } from "@/components/inbox/status-link-wizard";
import { renderSnippet } from "@/components/inbox/customer-link-composer";
import {
  buildDealDataForDocs,
  missingDocFields,
  type LeadContext,
} from "@/lib/deal-doc-data";

// ─── Types ───────────────────────────────────────────────────────────────────

interface DealDocument {
  id: string;
  documentType: string;
  fileName: string;
  fileSize: number;
  uploadedAt: string;
}

interface QuotationPayload {
  id: string;
  fixedPrice: string | null;
  isVariable: boolean;
  notes: string | null;
  lineItems: Array<{
    type: "helper" | "transporter" | "other";
    description: string;
    quantity: number;
    unitRate: string;
    sortOrder: number;
  }>;
  depositRequiredCents?: number | null;
  paymentMethodPreference?: "bank_transfer" | "paypal" | "cash" | "card" | null;
  validUntil?: string | null;
  summary?: string | null;
  showStandardInclusions?: boolean;
  selectedPackageSlug?: string | null;
}

interface InsightsExtractedSuggestion {
  key: string;
  label: string;
  value: string;
}

type LifecycleKey =
  | "erstkontakt"
  | "infos_erhalten"
  | "angebot"
  | "angenommen"
  | "umzugstermin"
  | "bezahlt"
  | "bewertung";

interface LifecycleMilestone {
  key: LifecycleKey;
  label: string;
  at: string | null;
  done: boolean;
}

interface DealLifecycle {
  milestones: LifecycleMilestone[];
  current: LifecycleKey | null;
}

// Funnel stages the operator can set by hand. Order = funnel order.
const STAGE_OPTIONS: Array<{ value: AgentStage; label: string; dot: string }> = [
  { value: "erstkontakt", label: "Erstkontakt", dot: "bg-muted-foreground/50" },
  { value: "infos_erhalten", label: "Infos erhalten", dot: "bg-sky-500" },
  { value: "angebot_raus", label: "Angebot raus", dot: "bg-violet-500" },
  { value: "angenommen", label: "Angenommen", dot: "bg-emerald-500" },
  { value: "verloren", label: "Verloren", dot: "bg-rose-500" },
];

const DOC_TYPE_LABELS: Record<string, string> = {
  order_confirmation: "Auftragsbestätigung",
  invoice: "Rechnung",
  payment_confirmation: "Zahlungsbestätigung",
  worker_instructions: "Auftragsanweisung",
};

// German labels for the KI-Analyse suggestion list. Keys not listed fall back
// to the raw slug — better visible-but-ugly than silently dropped.
const INSIGHT_LABELS: Record<string, string> = {
  inventory_notes: "Inventar / Güter",
  move_date: "Umzugsdatum",
  estimated_value_eur: "Geschätzter Wert (€)",
  move_from_address: "Auszugsadresse",
  move_to_address: "Einzugsadresse",
  floors_from: "Stockwerk (Auszug)",
  floors_to: "Stockwerk (Einzug)",
  elevator_from: "Zugang (Auszug)",
  elevator_to: "Zugang (Einzug)",
  volume_cbm: "Volumen (m³)",
  boxes_needed: "Kartons benötigt",
  dismantling_required: "Demontage erforderlich",
  packing_service: "Einpackservice",
  piano_transport: "Klaviertransport",
  disposal_required: "Sperrmüll / Entsorgung",
  storage_required: "Einlagerung",
  parking_halteverbot_needed: "Halteverbot benötigt",
  time_window_start: "Start (geplant)",
  time_window_end: "Ende (geplant)",
  special_requests: "Sonderwünsche",
  payment_method: "Zahlungsart",
  worker_count: "Anzahl Arbeiter",
};

function fmtValue(v: unknown): string {
  if (v === true) return "Ja";
  if (v === false) return "Nein";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** "vor 5 Min" / "vor 3 Std" / "vor 2 Tagen" for the freshness chip. */
function relTimeDe(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min`;
  const h = Math.round(min / 60);
  if (h < 24) return `vor ${h} Std`;
  const d = Math.round(h / 24);
  return d === 1 ? "vor 1 Tag" : `vor ${d} Tagen`;
}

/** Shape of the cached ai.insights_extracted payload we render. */
interface CachedKiSummary {
  createdAt: string;
  summary: string | null;
  criticalMissing: Array<{ field?: string; question?: string }>;
  missingFields: string[];
}

/** Map quotation values to the GenerateDocumentDialog prefill shape. */
function prefillFromQuotation(
  q: QuotationPayload | null,
  firma: "kottke" | "ceylan"
): PrefilledPreise | undefined {
  if (!q) return undefined;
  const prefill: PrefilledPreise = {};
  if (q.depositRequiredCents != null && q.depositRequiredCents > 0) {
    prefill.anzahlungBar = q.depositRequiredCents / 100;
    prefill.anzahlungMethod =
      q.paymentMethodPreference === "paypal"
        ? "paypal"
        : q.paymentMethodPreference === "bank_transfer"
          ? "bank_transfer"
          : "bar";
  }
  if (!q.isVariable && q.fixedPrice && Number(q.fixedPrice) > 0) {
    if (firma === "ceylan") {
      prefill.modell = "pauschale";
      prefill.pauschaleBetragCeylan = Number(q.fixedPrice);
    } else {
      prefill.modell = "pauschale";
      prefill.pauschalePositionen = [
        { titel: "Umzug pauschal", betrag: Number(q.fixedPrice) },
      ];
    }
    return prefill;
  }
  if (q.isVariable && q.lineItems?.length) {
    const helpers = q.lineItems.filter((l) => l.type === "helper");
    const transporters = q.lineItems.filter((l) => l.type === "transporter");
    prefill.modell = "stundensatz";
    if (helpers.length > 0) {
      prefill.helferAnzahl = helpers.reduce((s, l) => s + l.quantity, 0);
      prefill.helferRate = Number(helpers[0].unitRate) || undefined;
    }
    if (transporters.length > 0) {
      prefill.transporterRate = Number(transporters[0].unitRate) || undefined;
    }
    return prefill;
  }
  return Object.keys(prefill).length > 0 ? prefill : undefined;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function InboxContextPanel({
  conversationId,
  dealRecordId,
  firma,
  firmaDisplayName,
  customerName,
  agentStage,
  onStageChange,
  onInsert,
  onClose,
}: {
  conversationId: string;
  dealRecordId: string | null;
  firma: "kottke" | "ceylan";
  firmaDisplayName: string | null;
  customerName: string | null;
  agentStage: AgentStage | null;
  /** Called after a manual stage change so the inbox list updates its badge. */
  onStageChange?: (stage: AgentStage) => void;
  onInsert: (text: string) => void;
  onClose: () => void;
}) {
  const router = useRouter();

  // Manual stage editing (normalise legacy stored values for display)
  const [stage, setStage] = useState<AgentStage | null>(normalizeAgentStage(agentStage));
  const [stageMenuOpen, setStageMenuOpen] = useState(false);
  const [stageSaving, setStageSaving] = useState(false);
  useEffect(() => setStage(normalizeAgentStage(agentStage)), [agentStage, conversationId]);

  // Lifecycle timeline
  const [lifecycle, setLifecycle] = useState<DealLifecycle | null>(null);

  // Panel data
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DealDocument[]>([]);
  const [quotation, setQuotation] = useState<QuotationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // Modals
  const [wizardOpen, setWizardOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [docDialog, setDocDialog] = useState<{
    type: DocumentType;
    deal: DealData;
    prefill?: PrefilledPreise;
  } | null>(null);

  // AB/RE missing-data flow
  const [docFlowLoading, setDocFlowLoading] = useState<DocumentType | null>(null);
  const [missingDialog, setMissingDialog] = useState<{
    type: DocumentType;
    missing: string[];
    leadContext: LeadContext | null;
  } | null>(null);

  // KI-Analyse mini flow
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<{
    type: DocumentType;
    items: InsightsExtractedSuggestion[];
    selected: Set<string>;
    /** Full previewed insights + freshness token: sent back on apply so the
     * server reuses the reviewed JSON instead of re-running the extraction. */
    insights: unknown;
    fingerprint?: string;
  } | null>(null);
  const [applying, setApplying] = useState(false);

  // Cached KI-Zusammenfassung (rendered instantly from the durable
  // ai.insights_extracted event; kept warm by the keep-warm cron).
  const [kiSummary, setKiSummary] = useState<CachedKiSummary | null>(null);
  const [kiCopiedIdx, setKiCopiedIdx] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!dealRecordId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [linkRes, docsRes, qRes, lifeRes, kiRes] = await Promise.all([
        fetch(`/api/v1/customer-link/${dealRecordId}`),
        fetch(`/api/v1/deals/${dealRecordId}/documents`),
        fetch(`/api/v1/deals/${dealRecordId}/quotation`),
        fetch(`/api/v1/deals/${dealRecordId}/lifecycle`),
        fetch(`/api/v1/deals/${dealRecordId}/latest-insights`),
      ]);
      if (kiRes.ok) {
        const j = (await kiRes.json()) as {
          data?: {
            createdAt?: string;
            payload?: {
              summary?: unknown;
              criticalMissing?: unknown;
              missingFields?: unknown;
            };
          };
        };
        const p = j.data?.payload;
        if (j.data?.createdAt && p) {
          setKiSummary({
            createdAt: j.data.createdAt,
            summary: typeof p.summary === "string" ? p.summary : null,
            criticalMissing: Array.isArray(p.criticalMissing)
              ? (p.criticalMissing as Array<{ field?: string; question?: string }>)
              : [],
            missingFields: Array.isArray(p.missingFields)
              ? (p.missingFields as string[])
              : [],
          });
        } else {
          setKiSummary(null);
        }
      } else {
        setKiSummary(null);
      }
      if (linkRes.ok) {
        const j = (await linkRes.json()) as { data?: { url?: string | null } };
        setLinkUrl(j.data?.url ?? null);
      } else {
        setLinkUrl(null);
      }
      if (docsRes.ok) {
        const j = (await docsRes.json()) as { data?: DealDocument[] };
        setDocuments(j.data ?? []);
      }
      if (qRes.ok) {
        const j = (await qRes.json()) as { data?: QuotationPayload | null };
        setQuotation(j.data ?? null);
      }
      if (lifeRes.ok) {
        const j = (await lifeRes.json()) as { data?: DealLifecycle };
        setLifecycle(j.data ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [dealRecordId]);

  async function changeStage(next: AgentStage) {
    setStageMenuOpen(false);
    if (next === stage) return;
    const prev = stage;
    setStage(next);
    setStageSaving(true);
    try {
      const res = await fetch(
        `/api/v1/inbox/conversations/${conversationId}/agent-stage`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage: next }),
        }
      );
      if (res.ok) onStageChange?.(next);
      else setStage(prev);
    } catch {
      setStage(prev);
    } finally {
      setStageSaving(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const customerFirstName = customerName?.trim().split(/\s+/)[0] ?? null;

  async function copyLink() {
    if (!linkUrl) return;
    try {
      await navigator.clipboard.writeText(linkUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }

  /** Minimal DealData when the lead context can't provide one (person-row parity). */
  function fallbackDealData(): DealData | null {
    if (!dealRecordId || !customerName) return null;
    return {
      dealRecordId,
      firma,
      kunde: { nachname: customerName },
      auftrag: {},
    };
  }

  /** Click on "Rechnung/AB erstellen": check data, then dialog or missing prompt. */
  async function startDocFlow(type: DocumentType) {
    if (!dealRecordId || docFlowLoading) return;
    setDocFlowLoading(type);
    setAnalyzeError(null);
    try {
      const res = await fetch(`/api/v1/deals/${dealRecordId}/auftrag`);
      const j = res.ok
        ? ((await res.json()) as { data?: { leadContext?: LeadContext | null } })
        : null;
      const leadContext = j?.data?.leadContext ?? null;
      const missing = missingDocFields(leadContext, !!quotation);
      if (missing.length > 0) {
        setMissingDialog({ type, missing, leadContext });
        return;
      }
      openDocDialog(type, leadContext);
    } finally {
      setDocFlowLoading(null);
    }
  }

  function openDocDialog(type: DocumentType, leadContext: LeadContext | null) {
    if (!dealRecordId) return;
    const deal =
      (leadContext ? buildDealDataForDocs(dealRecordId, leadContext) : null) ??
      fallbackDealData();
    if (!deal) return;
    setMissingDialog(null);
    setSuggestions(null);
    setDocDialog({ type, deal, prefill: prefillFromQuotation(quotation, firma) });
  }

  /** KI-Analyse: extract from the chat, let the user approve, apply, retry. */
  async function runAnalyze(type: DocumentType) {
    if (!dealRecordId || analyzing) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await fetch(`/api/v1/deals/${dealRecordId}/insights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: false }),
      });
      if (!res.ok) {
        setAnalyzeError("Analyse fehlgeschlagen.");
        return;
      }
      const data = (await res.json()) as {
        data?: {
          insights?: { extracted?: Record<string, unknown> } | null;
          error?: string;
          fingerprint?: string;
        };
      };
      const extracted = data.data?.insights?.extracted;
      if (!extracted) {
        setAnalyzeError(
          data.data?.error ?? "Keine Nachrichten mit diesem Lead verknüpft."
        );
        return;
      }
      const items: InsightsExtractedSuggestion[] = Object.entries(extracted)
        .filter(([, v]) => {
          if (v == null) return false;
          if (typeof v === "string" && v.trim() === "") return false;
          if (Array.isArray(v) && v.length === 0) return false;
          return true;
        })
        .map(([key, v]) => ({
          key,
          label: INSIGHT_LABELS[key] ?? key,
          value: fmtValue(v),
        }));
      if (items.length === 0) {
        setAnalyzeError("Die KI-Analyse hat keine neuen Daten gefunden.");
        return;
      }
      setMissingDialog(null);
      setSuggestions({
        type,
        items,
        selected: new Set(items.map((i) => i.key)),
        insights: data.data?.insights ?? null,
        fingerprint: data.data?.fingerprint,
      });
    } catch {
      setAnalyzeError("Netzwerkfehler bei der Analyse.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function applySuggestions() {
    if (!dealRecordId || !suggestions) return;
    setApplying(true);
    try {
      await fetch(`/api/v1/deals/${dealRecordId}/insights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apply: true,
          selectedFields: [...suggestions.selected],
          applyStage: false,
          applyNote: true,
          // Reuse the previewed JSON server-side; without this every
          // "Übernehmen & weiter" paid for a second full extraction.
          insights: suggestions.insights,
          fingerprint: suggestions.fingerprint,
        }),
      });
      // Re-fetch lead context and continue into the document dialog.
      const res = await fetch(`/api/v1/deals/${dealRecordId}/auftrag`);
      const j = res.ok
        ? ((await res.json()) as { data?: { leadContext?: LeadContext | null } })
        : null;
      openDocDialog(suggestions.type, j?.data?.leadContext ?? null);
    } finally {
      setApplying(false);
    }
  }

  const hasDeal = !!dealRecordId;

  return (
    <>
      {/* Mobile/tablet backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={onClose} />

      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-[min(100vw-3rem,340px)] flex-col border-l border-border lg:static lg:z-auto lg:w-[340px] lg:shrink-0"
        style={{ background: "var(--inbox-panel)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold">Schnellzugriff</span>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Panel schließen"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!hasDeal ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              Kein Lead mit dieser Konversation verknüpft. Aktionen sind
              verfügbar, sobald ein Lead existiert.
            </p>
          ) : (
            <>
              {/* ── Aktionen ── */}
              <Section title="Aktionen">
                <ActionRow
                  icon={<Link2 className="h-4 w-4" />}
                  label="Status-Link erstellen"
                  hint="Kunden-Portal konfigurieren"
                  onClick={() => setWizardOpen(true)}
                />
                <ActionRow
                  icon={<FileText className="h-4 w-4" />}
                  label="Auftragsbestätigung erstellen"
                  loading={docFlowLoading === "AB"}
                  onClick={() => void startDocFlow("AB")}
                />
                <ActionRow
                  icon={<Receipt className="h-4 w-4" />}
                  label="Rechnung erstellen"
                  loading={docFlowLoading === "RE"}
                  onClick={() => void startDocFlow("RE")}
                />
                <ActionRow
                  icon={<Calculator className="h-4 w-4" />}
                  label="Kostenrechner"
                  hint="Wie in der Auftragsübersicht"
                  onClick={() => setCalcOpen(true)}
                />
                {analyzeError && (
                  <p className="mx-3 mb-2 rounded-md bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
                    {analyzeError}
                  </p>
                )}
              </Section>

              {/* ── KI-Zusammenfassung (instant, from the durable cache) ── */}
              <Section title="KI-Zusammenfassung">
                {loading ? (
                  <PanelSpinner />
                ) : kiSummary ? (
                  <div className="space-y-2 px-3 pb-3">
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <Sparkles className="h-3 w-3" />
                      <span>Stand: {relTimeDe(kiSummary.createdAt)}</span>
                    </div>
                    {kiSummary.summary && (
                      <p className="text-xs leading-relaxed text-foreground/90">
                        {kiSummary.summary}
                      </p>
                    )}
                    {kiSummary.criticalMissing.filter((m) => m.question).length > 0 && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-medium uppercase tracking-wider text-amber-600 dark:text-amber-500">
                            Fehlt noch
                          </span>
                          <button
                            onClick={() =>
                              onInsert(
                                kiSummary.criticalMissing
                                  .map((m) => m.question)
                                  .filter(Boolean)
                                  .join("\n")
                              )
                            }
                            className="text-[10px] text-primary hover:underline"
                            title="Alle offenen Fragen als eine Nachricht in den Antwort-Editor übernehmen"
                          >
                            Alle Fragen übernehmen
                          </button>
                        </div>
                        {kiSummary.criticalMissing
                          .filter((m) => m.question)
                          .map((m, i) => (
                            <div
                              key={i}
                              className="flex items-start gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5"
                            >
                              <span className="flex-1 text-[11px] leading-snug">
                                {m.question}
                              </span>
                              <button
                                onClick={() => onInsert(m.question!)}
                                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                                title="In den Antwort-Editor übernehmen"
                              >
                                <FileText className="h-3 w-3" />
                              </button>
                              <button
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(m.question!);
                                    setKiCopiedIdx(i);
                                    window.setTimeout(() => setKiCopiedIdx(null), 1200);
                                  } catch {
                                    // ignore
                                  }
                                }}
                                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                                title="Frage kopieren"
                              >
                                {kiCopiedIdx === i ? (
                                  <Check className="h-3 w-3 text-emerald-600" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                              </button>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="px-3 pb-3 text-[11px] text-muted-foreground">
                    Noch keine KI-Analyse vorhanden. Sie entsteht automatisch,
                    sobald neue Nachrichten eingehen, oder über die KI-Analyse
                    im AB/RE-Dialog.
                  </p>
                )}
              </Section>

              {/* ── Status (manually editable funnel stage) ── */}
              <Section title="Status">
                <div className="relative px-3 pb-3">
                  <button
                    onClick={() => setStageMenuOpen((v) => !v)}
                    disabled={stageSaving}
                    className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-60"
                  >
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        STAGE_OPTIONS.find((s) => s.value === stage)?.dot ??
                          "bg-muted-foreground/40"
                      )}
                    />
                    <span className="flex-1 truncate font-medium">
                      {STAGE_OPTIONS.find((s) => s.value === stage)?.label ??
                        "Kein Status"}
                    </span>
                    {stageSaving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </button>
                  {stageMenuOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setStageMenuOpen(false)}
                      />
                      <div className="absolute left-3 right-3 z-50 mt-1 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-lg">
                        {STAGE_OPTIONS.map((s) => (
                          <button
                            key={s.value}
                            onClick={() => void changeStage(s.value)}
                            className={cn(
                              "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted",
                              s.value === stage && "bg-muted/60"
                            )}
                          >
                            <span className={cn("h-2 w-2 shrink-0 rounded-full", s.dot)} />
                            <span className="flex-1 truncate">{s.label}</span>
                            {s.value === stage && <Check className="h-3.5 w-3.5" />}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </Section>

              {/* ── Status-Link ── */}
              <Section title="Status-Link">
                {loading ? (
                  <PanelSpinner />
                ) : linkUrl ? (
                  <div className="px-3 pb-3">
                    <div className="flex items-center gap-1.5">
                      <input
                        readOnly
                        value={linkUrl}
                        onClick={(e) => e.currentTarget.select()}
                        className="h-8 min-w-0 flex-1 truncate rounded-md border border-border bg-muted/40 px-2 text-[11px] text-muted-foreground"
                      />
                      <button
                        onClick={copyLink}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border hover:bg-accent"
                        title="Link kopieren"
                      >
                        {copied ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                    <button
                      onClick={() =>
                        onInsert(
                          renderSnippet("kva_available", {
                            url: linkUrl,
                            firmaName: firmaDisplayName ?? "wir",
                            customerFirstName,
                            dealNumber: null,
                          })
                        )
                      }
                      className="mt-2 inline-flex h-8 w-full items-center justify-center rounded-md border border-border text-xs font-medium hover:bg-accent"
                    >
                      Nachricht mit Link in Chat einfügen
                    </button>
                  </div>
                ) : (
                  <p className="px-3 pb-3 text-xs text-muted-foreground">
                    Noch kein Link. Über „Status-Link erstellen" konfigurieren.
                  </p>
                )}
              </Section>

              {/* ── Dokumente ── */}
              <Section title={`Dokumente${documents.length ? ` (${documents.length})` : ""}`}>
                {loading ? (
                  <PanelSpinner />
                ) : documents.length === 0 ? (
                  <p className="px-3 pb-3 text-xs text-muted-foreground">
                    Noch keine Dokumente. Erstellte PDFs erscheinen hier.
                  </p>
                ) : (
                  <ul className="space-y-1 px-2 pb-2">
                    {documents.map((d) => (
                      <li key={d.id}>
                        <a
                          href={`/api/v1/deals/${dealRecordId}/documents/${d.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-muted"
                        >
                          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted">
                            <FileText className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-medium">
                              {DOC_TYPE_LABELS[d.documentType] ?? d.documentType}
                            </span>
                            <span className="block truncate text-[10px] text-muted-foreground">
                              {d.fileName} · {fmtDate(d.uploadedAt)}
                            </span>
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {/* ── Lead ── */}
              <Section title="Lead">
                <div className="px-3 pb-3">
                  <button
                    onClick={() => router.push(`/objects/deals/${dealRecordId}`)}
                    className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-border text-xs font-medium hover:bg-accent"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Lead öffnen
                  </button>
                </div>
              </Section>

              {/* ── Interaktionen (lifecycle timeline) ── */}
              <Section title="Interaktionen">
                {loading ? (
                  <PanelSpinner />
                ) : lifecycle ? (
                  <LifecycleTimeline lifecycle={lifecycle} />
                ) : (
                  <p className="px-3 pb-3 text-xs text-muted-foreground">
                    Noch keine Interaktionen.
                  </p>
                )}
              </Section>
            </>
          )}
        </div>
      </aside>

      {/* ── Status-Link wizard ── */}
      {wizardOpen && dealRecordId && (
        <StatusLinkWizard
          dealRecordId={dealRecordId}
          firmaDisplayName={firmaDisplayName}
          customerFirstName={customerFirstName}
          onClose={() => setWizardOpen(false)}
          onInsert={onInsert}
          onFinished={() => void refresh()}
        />
      )}

      {/* ── Kostenrechner modal (same component as Auftragsübersicht) ── */}
      {calcOpen && dealRecordId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-border bg-background shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Calculator className="h-4 w-4" />
                Kostenrechner
              </span>
              <button
                onClick={() => setCalcOpen(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Schließen"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <QuotationCalculator
                recordId={dealRecordId}
                quotation={quotation}
                onSaved={() => {
                  void refresh();
                  setCalcOpen(false);
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Missing-data prompt ── */}
      {missingDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-background p-5 shadow-xl">
            <h3 className="text-sm font-semibold">
              Es fehlen noch Angaben für die{" "}
              {missingDialog.type === "AB" ? "Auftragsbestätigung" : "Rechnung"}
            </h3>
            <ul className="mt-3 space-y-1.5">
              {missingDialog.missing.map((m) => (
                <li key={m} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                  {m}
                </li>
              ))}
            </ul>
            {analyzeError && (
              <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {analyzeError}
              </p>
            )}
            <div className="mt-5 space-y-2">
              <button
                onClick={() => void runAnalyze(missingDialog.type)}
                disabled={analyzing}
                className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-foreground text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
              >
                {analyzing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {analyzing ? "Analysiere Chat…" : "KI-Analyse aus Chat starten"}
              </button>
              <button
                onClick={() =>
                  openDocDialog(missingDialog.type, missingDialog.leadContext)
                }
                className="inline-flex h-9 w-full items-center justify-center rounded-md border border-border text-sm font-medium hover:bg-accent"
              >
                Trotzdem manuell fortfahren
              </button>
              <button
                onClick={() => {
                  setMissingDialog(null);
                  setAnalyzeError(null);
                }}
                className="inline-flex h-9 w-full items-center justify-center rounded-md text-sm text-muted-foreground hover:bg-muted"
              >
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── KI-Analyse suggestions approval ── */}
      {suggestions && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl border border-border bg-background shadow-xl">
            <div className="border-b border-border px-5 py-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-4 w-4" />
                KI-Analyse: gefundene Daten
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Auswahl wird in den Lead übernommen, dann geht es weiter zur{" "}
                {suggestions.type === "AB" ? "Auftragsbestätigung" : "Rechnung"}.
              </p>
            </div>
            <div className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
              {suggestions.items.map((item) => {
                const checked = suggestions.selected.has(item.key);
                return (
                  <label
                    key={item.key}
                    className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSuggestions((prev) => {
                          if (!prev) return prev;
                          const selected = new Set(prev.selected);
                          if (checked) selected.delete(item.key);
                          else selected.add(item.key);
                          return { ...prev, selected };
                        })
                      }
                      className="mt-0.5 h-4 w-4"
                    />
                    <span className="min-w-0">
                      <span className="block text-xs font-medium">{item.label}</span>
                      <span className="block break-words text-xs text-muted-foreground">
                        {item.value}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
              <button
                onClick={() => setSuggestions(null)}
                className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm hover:bg-accent"
              >
                Abbrechen
              </button>
              <button
                onClick={() => void applySuggestions()}
                disabled={applying || suggestions.selected.size === 0}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-foreground px-4 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
              >
                {applying && <Loader2 className="h-4 w-4 animate-spin" />}
                Übernehmen & weiter
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Document generation dialog ── */}
      {docDialog && (
        <GenerateDocumentDialog
          open
          documentType={docDialog.type}
          deal={docDialog.deal}
          prefill={docDialog.prefill}
          onClose={() => {
            setDocDialog(null);
            void refresh();
          }}
        />
      )}
    </>
  );
}

// ─── Small pieces ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border/60">
      <div className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

function ActionRow({
  icon,
  label,
  hint,
  loading,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted",
        loading && "opacity-60"
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{label}</span>
        {hint && (
          <span className="block truncate text-[11px] text-muted-foreground">{hint}</span>
        )}
      </span>
    </button>
  );
}

function PanelSpinner() {
  return (
    <div className="flex items-center gap-2 px-3 pb-3 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      Lädt…
    </div>
  );
}

function lifecycleDate(key: LifecycleKey, at: string | null): string {
  if (!at) return "—";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "—";
  // Move date and payment date are plain days; the rest carry a wall-clock time.
  if (key === "umzugstermin" || key === "bezahlt") {
    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  }
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Vertical milestone timeline like Zendesk's "Interactions": done steps get a
 * filled dot, the step in flight pulses (warm accent), future steps are
 * hollow. The connecting rail fills up to the current step.
 */
function LifecycleTimeline({ lifecycle }: { lifecycle: DealLifecycle }) {
  const { milestones, current } = lifecycle;
  return (
    <ul className="px-3 pb-4 pt-1">
      {milestones.map((m, i) => {
        const isCurrent = m.key === current;
        const isLast = i === milestones.length - 1;
        const isFutureMove = m.key === "umzugstermin" && !m.done && m.at;
        return (
          <li key={m.key} className="relative flex gap-3 pb-4 last:pb-0">
            {/* Rail */}
            {!isLast && (
              <span
                className={cn(
                  "absolute left-[5px] top-4 h-full w-px",
                  m.done ? "bg-[var(--kottke-accent)]/40" : "bg-border"
                )}
                aria-hidden
              />
            )}
            {/* Dot */}
            <span className="relative mt-1 flex h-[11px] w-[11px] shrink-0 items-center justify-center">
              {isCurrent ? (
                <>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--kottke-accent)] opacity-60" />
                  <span className="relative inline-flex h-[11px] w-[11px] rounded-full bg-[var(--kottke-accent)]" />
                </>
              ) : m.done ? (
                <span className="inline-flex h-[11px] w-[11px] items-center justify-center rounded-full bg-[var(--kottke-accent)] text-white">
                  <Check className="h-2 w-2" strokeWidth={3} />
                </span>
              ) : (
                <span className="inline-flex h-[11px] w-[11px] rounded-full border-2 border-border bg-background" />
              )}
            </span>
            {/* Label + time */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "text-xs font-medium",
                    m.done || isCurrent ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {m.label}
                </span>
                {isCurrent && (
                  <span className="rounded-full bg-[var(--kottke-accent)]/12 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-[var(--kottke-accent)]">
                    aktuell
                  </span>
                )}
              </div>
              <span className="text-[11px] text-muted-foreground">
                {isFutureMove
                  ? `geplant: ${lifecycleDate(m.key, m.at)}`
                  : lifecycleDate(m.key, m.at)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
