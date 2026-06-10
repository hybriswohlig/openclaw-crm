"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { RecordDetail } from "@/components/records/record-detail";
import { RelatedRecords } from "@/components/records/related-records";
import { ActivityTimeline } from "@/components/records/activity-timeline";
import { RecordNotes } from "@/components/notes/record-notes";
import { RecordTasks } from "@/components/tasks/record-tasks";
import { QuotationTab } from "@/components/quotation/quotation-tab";
import { FinancialTab } from "@/components/financial/financial-tab";
import { MediaTab } from "@/components/media/media-tab";
import { DealInsightsTab } from "@/components/deal-insights/deal-insights-tab";
import { AuftragTab } from "@/components/auftrag/auftrag-tab";
import { RecordConversations } from "@/components/records/record-conversations";
import { ShareLinkPanel } from "@/components/customer-link/share-link-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Trash2,
  Users,
  Building2,
  Handshake,
  Box,
  Truck,
  Sparkles,
  Loader2,
  X,
  Check,
  ArrowRight as ArrowRightIcon,
  AlertTriangle,
  FileText,
} from "lucide-react";
import { extractPersonalName } from "@/lib/display-name";
import { useBackgroundJobs } from "@/components/background-jobs";

interface ObjectData {
  id: string;
  slug: string;
  singularName: string;
  pluralName: string;
  icon: string;
  attributes: any[];
}

interface RecordData {
  id: string;
  objectId: string;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  values: Record<string, unknown>;
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  users: Users,
  "building-2": Building2,
  handshake: Handshake,
  truck: Truck,
};

// ─── AI Insights approval types ──────────────────────────────────────────────

interface InsightsExtracted {
  customer_name: string | null;
  move_date: string | null;
  move_from_address: string | null;
  move_to_address: string | null;
  floors: string | null;
  inventory_notes: string | null;
  estimated_value_eur: number | null;
  customer_phone: string | null;
  customer_email: string | null;
}

interface InsightsData {
  extracted: InsightsExtracted;
  suggested_stage: string | null;
  activity_note: string;
  summary: string;
  missingFields: string[];
  openCustomerQuestions: string[];
  legalFlags: Array<{ topic: string; reason: string }>;
}

interface InsightsSuggestions {
  insights: InsightsData;
  transcript: { messageCount: number; conversationCount: number };
  selectedFields: string[];
  applyStage: boolean;
  applyNote: boolean;
  /** Transcript freshness token from the preview; sent back on apply so the
   * server can reuse the reviewed JSON instead of re-extracting. */
  fingerprint?: string;
}

const fmtBool = (v: unknown) => (v === true ? "Ja" : v === false ? "Nein" : String(v));
const fmtList = (v: unknown) => (Array.isArray(v) ? v.join(", ") : String(v));

// Every extracted field the KI-Analyse can write. Deal-level + Auftrag-level.
// (customer_name / phone / email are propagated to the linked person via the
// applyContact flag, not via selectedFields, so they are not listed here.)
const FIELD_LABELS: Record<string, { label: string; format: (v: unknown) => string }> = {
  // ── Deal-level ──
  inventory_notes: { label: "Inventar / Güter", format: (v) => String(v) },
  move_date: { label: "Umzugsdatum", format: (v) => String(v) },
  estimated_value_eur: { label: "Geschätzter Wert", format: (v) => `${v} €` },
  move_from_address: { label: "Abholadresse", format: (v) => String(v) },
  move_to_address: { label: "Zieladresse", format: (v) => String(v) },
  floors_from: { label: "Stockwerk (Abholung)", format: (v) => String(v) },
  floors_to: { label: "Stockwerk (Ziel)", format: (v) => String(v) },
  elevator_from: { label: "Zugang (Abholung)", format: (v) => String(v) },
  elevator_to: { label: "Zugang (Ziel)", format: (v) => String(v) },
  // ── Auftrag-level ──
  volume_cbm: { label: "Volumen (m³)", format: (v) => `${v} m³` },
  boxes_needed: { label: "Kartons benötigt", format: (v) => String(v) },
  dismantling_required: { label: "Demontage erforderlich", format: fmtBool },
  packing_service: { label: "Einpackservice", format: fmtBool },
  piano_transport: { label: "Klaviertransport", format: fmtBool },
  disposal_required: { label: "Sperrmüll / Entsorgung", format: fmtBool },
  storage_required: { label: "Einlagerung", format: fmtBool },
  parking_halteverbot_needed: { label: "Halteverbot benötigt", format: fmtBool },
  time_window_start: { label: "Start (geplant)", format: (v) => String(v) },
  time_window_end: { label: "Ende (geplant)", format: (v) => String(v) },
  special_requests: { label: "Sonderwünsche", format: (v) => String(v) },
  payment_method: { label: "Zahlungsart", format: (v) => String(v) },
  transporter: { label: "Transporter", format: (v) => String(v) },
  worker_count: { label: "Anzahl Arbeiter", format: (v) => String(v) },
  equipment_needed: { label: "Werkzeug / Material", format: fmtList },
  walking_distance_from_m: { label: "Laufweg Abholung (m)", format: (v) => `${v} m` },
  walking_distance_to_m: { label: "Laufweg Ziel (m)", format: (v) => `${v} m` },
  contact_pickup_name: { label: "Kontakt Abholort", format: (v) => String(v) },
  contact_pickup_phone: { label: "Kontakt Abholort (Tel.)", format: (v) => String(v) },
  contact_dropoff_name: { label: "Kontakt Zielort", format: (v) => String(v) },
  contact_dropoff_phone: { label: "Kontakt Zielort (Tel.)", format: (v) => String(v) },
  amount_outstanding_eur: { label: "Offener Betrag", format: (v) => `${v} €` },
};

/** Select every extracted field that actually carries a value, so a single
 *  "Übernehmen" fills everything the chat established (user can still uncheck). */
function buildDefaultSelections(insights: InsightsData): string[] {
  const ext = insights.extracted as unknown as Record<string, unknown>;
  return Object.keys(FIELD_LABELS).filter((key) => {
    const v = ext[key];
    if (v == null) return false;
    if (typeof v === "string" && v.trim() === "") return false;
    if (Array.isArray(v) && v.length === 0) return false;
    return true;
  });
}

export default function RecordDetailPage() {
  const params = useParams<{ slug: string; recordId: string }>();
  const router = useRouter();
  const { slug, recordId } = params;

  const [object, setObject] = useState<ObjectData | null>(null);
  const [record, setRecord] = useState<RecordData | null>(null);
  const [related, setRelated] = useState<{ related: any[]; forward: any[] }>({
    related: [],
    forward: [],
  });
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [insightsPanel, setInsightsPanel] = useState<InsightsSuggestions | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [applyNotice, setApplyNotice] = useState<{ skipped: string[]; errors: string[] } | null>(null);

  // KI-Analyse runs in the global background job center, so the user can
  // navigate freely while it loads; the review panel opens via the
  // consumption effect below as soon as the result is in.
  const { jobs: bgJobs, startInsightsJob, takeInsightsResult } = useBackgroundJobs();
  const analyzing = bgJobs.some(
    (j) => j.kind === "insights" && j.dealRecordId === recordId && j.status === "running"
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [objRes, recRes] = await Promise.all([
        fetch(`/api/v1/objects/${slug}`),
        fetch(`/api/v1/objects/${slug}/records/${recordId}`),
      ]);

      if (objRes.ok) setObject(await objRes.json().then((r) => r.data));
      if (recRes.ok) setRecord(await recRes.json().then((r) => r.data));

      // Load related and activity in parallel
      const [relRes, actRes] = await Promise.all([
        fetch(`/api/v1/objects/${slug}/records/${recordId}/related`),
        fetch(`/api/v1/objects/${slug}/records/${recordId}/activity`),
      ]);

      if (relRes.ok) setRelated(await relRes.json().then((r) => r.data));
      if (actRes.ok) setActivities(await actRes.json().then((r) => r.data));
    } finally {
      setLoading(false);
    }
  }, [slug, recordId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const [resolvingScope, setResolvingScope] = useState(false);
  const handleResolveScopeChange = useCallback(
    async (action: "accept" | "dismiss") => {
      setResolvingScope(true);
      try {
        await fetch(`/api/v1/deals/${recordId}/scope-change`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        await fetchData();
      } finally {
        setResolvingScope(false);
      }
    },
    [recordId, fetchData]
  );

  const handleUpdate = useCallback(
    async (attrSlug: string, value: unknown) => {
      setRecord((prev) =>
        prev ? { ...prev, values: { ...prev.values, [attrSlug]: value } } : prev
      );

      await fetch(`/api/v1/objects/${slug}/records/${recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: { [attrSlug]: value } }),
      });
    },
    [slug, recordId]
  );

  const handleDelete = useCallback(async () => {
    if (!confirm("Are you sure you want to delete this record?")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/objects/${slug}/records/${recordId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        router.push(`/objects/${slug}`);
      }
    } finally {
      setDeleting(false);
    }
  }, [slug, recordId, router]);

  // Step 1: Extract (preview only — no changes written). Runs as a global
  // background job: the user can keep working anywhere; a popup appears when
  // the analysis is done and the review panel opens via the effect below.
  const handleAnalyze = useCallback(() => {
    if (analyzing) return;
    setAnalyzeError(null);
    setInsightsPanel(null);
    let label = "Deal";
    const nameVal = record?.values?.name;
    if (typeof nameVal === "string" && nameVal.trim()) {
      label = nameVal;
    } else if (nameVal && typeof nameVal === "object") {
      label = extractPersonalName(nameVal) || "Deal";
    }
    startInsightsJob({ dealRecordId: recordId, label, source: "deal-page" });
  }, [recordId, record, analyzing, startInsightsJob]);

  // Consume a finished KI-Analyse for THIS record (whether started here or
  // from the inbox panel) and open the review panel with the results.
  useEffect(() => {
    if (slug !== "deals") return;
    const job = takeInsightsResult(recordId);
    if (!job) return;
    if (job.status === "error" || !job.result) {
      setAnalyzeError(job.error ?? "Analyse fehlgeschlagen");
      return;
    }
    const insights = job.result.insights as InsightsData;
    const transcript = job.result.transcript as {
      messageCount: number;
      conversationCount: number;
    };
    setInsightsPanel({
      insights,
      transcript,
      selectedFields: buildDefaultSelections(insights),
      applyStage: !!insights.suggested_stage,
      applyNote: true,
      fingerprint: job.result.fingerprint,
    });
    // bgJobs in deps: re-check whenever the job center state changes.
  }, [bgJobs, slug, recordId, takeInsightsResult]);

  // Step 2: Apply user-approved suggestions
  const handleApplyInsights = useCallback(async () => {
    if (!insightsPanel) return;
    setApplying(true);
    try {
      const res = await fetch(`/api/v1/deals/${recordId}/insights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apply: true,
          selectedFields: insightsPanel.selectedFields,
          applyStage: insightsPanel.applyStage,
          applyNote: insightsPanel.applyNote,
          // Reuse the reviewed JSON server-side (skips the second extraction)
          // as long as the transcript fingerprint still matches.
          insights: insightsPanel.insights,
          fingerprint: insightsPanel.fingerprint,
        }),
      });
      if (res.ok) {
        const r = (await res.json().catch(() => null))?.data as
          | { skipped?: string[]; errors?: string[] }
          | undefined;
        const skipped = Array.isArray(r?.skipped) ? r!.skipped! : [];
        const errors = Array.isArray(r?.errors) ? r!.errors! : [];
        setApplyNotice(skipped.length || errors.length ? { skipped, errors } : null);
        setInsightsPanel(null);
        fetchData();
      }
    } finally {
      setApplying(false);
    }
  }, [recordId, insightsPanel, fetchData]);

  if (loading && !record) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!object || !record) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Record not found
      </div>
    );
  }

  const nameAttr = object.attributes.find((a: any) => a.slug === "name");
  let displayName = "Unnamed";
  if (nameAttr) {
    const val = record.values.name;
    if (nameAttr.type === "personal_name" && val) {
      displayName = extractPersonalName(val) || "Unnamed";
    } else if (typeof val === "string") {
      displayName = val;
    }
  }

  const ObjIcon = iconMap[object.icon] || Box;

  return (
    <div className="flex h-full">
      {/* Main content */}
      <div className="flex-1 overflow-auto">
        {/* Header */}
        <div className="border-b border-border px-6 py-4">
          <div className="flex items-center gap-3 mb-3">
            <Link href={`/objects/${slug}`}>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ObjIcon className="h-4 w-4" />
              <Link href={`/objects/${slug}`} className="hover:text-foreground">
                {object.pluralName}
              </Link>
              <span>/</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold">{displayName}</h1>
            <div className="flex items-center gap-2">
              {slug === "deals" && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAnalyze}
                    disabled={analyzing}
                  >
                    {analyzing ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="mr-1.5 h-4 w-4" />
                    )}
                    {analyzing ? "Analysiere…" : "KI-Analyse"}
                  </Button>
                  {analyzeError && (
                    <span className="text-xs text-red-500">{analyzeError}</span>
                  )}
                </>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                disabled={deleting}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="mr-1 h-4 w-4" />
                {deleting ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </div>
        </div>

        {slug === "deals" && (
          <div className="px-6 pt-4">
            <ShareLinkPanel dealRecordId={recordId} />
          </div>
        )}

        {/* KI-Analyse: fields that could not be written / step errors */}
        {slug === "deals" && applyNotice && (
          <div className="px-6 pt-4">
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-700">
                  <AlertTriangle className="h-4 w-4" />
                  KI-Analyse übernommen, aber nicht alles konnte gesetzt werden
                </div>
                <button
                  type="button"
                  onClick={() => setApplyNotice(null)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  schließen
                </button>
              </div>
              {applyNotice.skipped.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {applyNotice.skipped.map((s, i) => (
                    <li key={i}>• {s}</li>
                  ))}
                </ul>
              )}
              {applyNotice.errors.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-red-600">
                  {applyNotice.errors.map((e, i) => (
                    <li key={i}>⚠ {e}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Post-quote scope-change warning */}
        {slug === "deals" &&
        (record?.values as Record<string, unknown> | undefined)?.scope_changed_after_quote ? (
          <div className="px-6 pt-4">
            <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-red-700">
                <AlertTriangle className="h-4 w-4" />
                Umfang nach Angebot geändert — Preis prüfen
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Der Kunde hat den Umfang geändert, nachdem bereits ein Angebot abgegeben wurde. Der
                ursprünglich angebotene Umfang bleibt gespeichert.
              </p>
              {typeof (record?.values as Record<string, unknown>)?.pending_inventory_notes ===
                "string" &&
              (record?.values as Record<string, unknown>).pending_inventory_notes ? (
                <div className="mt-2 text-xs">
                  <div className="mb-0.5 text-muted-foreground">Neu erkannt (zur Prüfung):</div>
                  <div className="rounded bg-background/60 p-2 whitespace-pre-wrap">
                    {String((record?.values as Record<string, unknown>).pending_inventory_notes)}
                  </div>
                </div>
              ) : null}
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  onClick={() => handleResolveScopeChange("accept")}
                  disabled={resolvingScope}
                >
                  Preis aktualisiert
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleResolveScopeChange("dismiss")}
                  disabled={resolvingScope}
                >
                  Änderung verwerfen
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Tabs */}
        <div className="px-6 py-4">
          <Tabs defaultValue="attributes">
            <TabsList>
              <TabsTrigger value="attributes">Attributes</TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
              <TabsTrigger value="tasks">Tasks</TabsTrigger>
              <TabsTrigger value="activity">
                Activity
                {activities.length > 0 && (
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {activities.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="related">
                Related
                {(related.related.length + related.forward.length) > 0 && (
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {related.related.length + related.forward.length}
                  </span>
                )}
              </TabsTrigger>
              {(slug === "deals" || slug === "people") && (
                <TabsTrigger value="conversations">Chats</TabsTrigger>
              )}
              {slug === "deals" && (
                <TabsTrigger value="quotation">Quotation</TabsTrigger>
              )}
              {slug === "deals" && (
                <TabsTrigger value="auftrag">Auftragsübersicht</TabsTrigger>
              )}
              {slug === "deals" && (
                <TabsTrigger value="financials">Finanzen</TabsTrigger>
              )}
              {slug === "deals" && (
                <TabsTrigger value="media">Medien</TabsTrigger>
              )}
              {slug === "deals" && (
                <TabsTrigger value="insights">KI-Insights</TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="attributes">
              <RecordDetail
                attributes={object.attributes}
                values={record.values}
                onUpdate={handleUpdate}
              />
            </TabsContent>

            <TabsContent value="notes">
              <RecordNotes objectSlug={slug} recordId={recordId} />
            </TabsContent>

            <TabsContent value="tasks">
              <RecordTasks objectSlug={slug} recordId={recordId} />
            </TabsContent>

            <TabsContent value="activity">
              <ActivityTimeline activities={activities} />
            </TabsContent>

            <TabsContent value="related">
              <RelatedRecords
                related={related.related}
                forward={related.forward}
              />
            </TabsContent>

            {(slug === "deals" || slug === "people") && (
              <TabsContent value="conversations">
                <RecordConversations objectSlug={slug} recordId={recordId} />
              </TabsContent>
            )}

            {slug === "deals" && (
              <TabsContent value="quotation">
                <QuotationTab recordId={recordId} />
              </TabsContent>
            )}
            {slug === "deals" && (
              <TabsContent value="auftrag">
                <AuftragTab recordId={recordId} />
              </TabsContent>
            )}
            {slug === "deals" && (
              <TabsContent value="financials">
                <FinancialTab recordId={recordId} />
              </TabsContent>
            )}
            {slug === "deals" && (
              <TabsContent value="media">
                <MediaTab recordId={recordId} />
              </TabsContent>
            )}
            {slug === "deals" && (
              <TabsContent value="insights">
                <DealInsightsTab recordId={recordId} />
              </TabsContent>
            )}
          </Tabs>
        </div>
      </div>

      {/* Right sidebar - metadata */}
      <div className="hidden w-64 shrink-0 border-l border-border lg:block">
        <div className="p-4 space-y-4">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Record Info
          </h3>
          <div className="space-y-3">
            <MetaItem label="Record ID" value={record.id.slice(0, 8) + "..."} />
            <MetaItem label="Object" value={object.singularName} />
            <MetaItem
              label="Created"
              value={new Date(record.createdAt).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            />
            <MetaItem
              label="Updated"
              value={new Date(record.updatedAt).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            />
          </div>
        </div>
      </div>

      {/* ── AI Insights Approval Panel ─────────────────────────────────── */}
      {insightsPanel && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/20"
            onClick={() => setInsightsPanel(null)}
          />
          {/* Panel */}
          <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md overflow-y-auto border-l border-border bg-background shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-5 py-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-500" />
                <h2 className="text-sm font-semibold">KI-Analyse Vorschläge</h2>
              </div>
              <button
                onClick={() => setInsightsPanel(null)}
                className="rounded-md p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-5 px-5 py-4">
              {/* Summary */}
              <div className="rounded-lg bg-violet-500/5 border border-violet-500/20 p-3">
                <p className="text-sm leading-relaxed">{insightsPanel.insights.summary}</p>
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  Basierend auf {insightsPanel.transcript.messageCount} Nachrichten in{" "}
                  {insightsPanel.transcript.conversationCount} Unterhaltung(en)
                </p>
              </div>

              {/* Stage suggestion */}
              {insightsPanel.insights.suggested_stage && (
                <div className="rounded-lg border p-3 space-y-2">
                  <label className="flex items-center justify-between gap-2 cursor-pointer">
                    <div className="flex items-center gap-2">
                      <ArrowRightIcon className="h-4 w-4 text-amber-500" />
                      <div>
                        <span className="text-sm font-medium">Pipeline-Stufe ändern</span>
                        <p className="text-xs text-muted-foreground">
                          Vorschlag: <strong>{insightsPanel.insights.suggested_stage}</strong>
                        </p>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={insightsPanel.applyStage}
                      onChange={(e) =>
                        setInsightsPanel((p) => p ? { ...p, applyStage: e.target.checked } : p)
                      }
                      className="h-4 w-4 rounded border-gray-300"
                    />
                  </label>
                </div>
              )}

              {/* Data fields */}
              {Object.entries(FIELD_LABELS).map(([key, { label, format }]) => {
                const value = insightsPanel.insights.extracted[key as keyof InsightsExtracted];
                if (value == null) return null;
                const isSelected = insightsPanel.selectedFields.includes(key);
                return (
                  <div key={key} className="rounded-lg border p-3">
                    <label className="flex items-center justify-between gap-2 cursor-pointer">
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium">{label}</span>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {format(value)}
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) =>
                          setInsightsPanel((p) => {
                            if (!p) return p;
                            const sf = e.target.checked
                              ? [...p.selectedFields, key]
                              : p.selectedFields.filter((f) => f !== key);
                            return { ...p, selectedFields: sf };
                          })
                        }
                        className="h-4 w-4 rounded border-gray-300"
                      />
                    </label>
                  </div>
                );
              })}

              {/* Activity note */}
              {insightsPanel.insights.activity_note && (
                <div className="rounded-lg border p-3 space-y-2">
                  <label className="flex items-center justify-between gap-2 cursor-pointer">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-blue-500" />
                      <span className="text-sm font-medium">Aktivitätsnotiz posten</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={insightsPanel.applyNote}
                      onChange={(e) =>
                        setInsightsPanel((p) => p ? { ...p, applyNote: e.target.checked } : p)
                      }
                      className="h-4 w-4 rounded border-gray-300"
                    />
                  </label>
                  <p className="text-xs text-muted-foreground leading-relaxed pl-6">
                    {insightsPanel.insights.activity_note}
                  </p>
                </div>
              )}

              {/* Missing fields */}
              {insightsPanel.insights.missingFields.length > 0 && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 mb-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Noch fehlende Informationen
                  </div>
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {insightsPanel.insights.missingFields.map((f, i) => (
                      <li key={i}>• {f}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Open customer questions */}
              {insightsPanel.insights.openCustomerQuestions.length > 0 && (
                <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-blue-700 mb-1.5">
                    Offene Kundenfragen
                  </div>
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {insightsPanel.insights.openCustomerQuestions.map((q, i) => (
                      <li key={i}>• {q}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 border-t bg-background px-5 py-3 flex items-center justify-between gap-3">
              <Button variant="ghost" size="sm" onClick={() => setInsightsPanel(null)}>
                Abbrechen
              </Button>
              <Button
                size="sm"
                onClick={handleApplyInsights}
                disabled={applying || (
                  insightsPanel.selectedFields.length === 0 &&
                  !insightsPanel.applyStage &&
                  !insightsPanel.applyNote
                )}
              >
                {applying ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-1.5 h-4 w-4" />
                )}
                Übernehmen
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{value}</dd>
    </div>
  );
}
