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
import { RecordConversations } from "@/components/records/record-conversations";
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
}

const FIELD_LABELS: Record<string, { label: string; format: (v: unknown) => string }> = {
  inventory_notes: { label: "Inventar / Güter", format: (v) => String(v) },
  move_date: { label: "Umzugsdatum", format: (v) => String(v) },
  estimated_value_eur: { label: "Geschätzter Wert", format: (v) => `${v} €` },
};

function buildDefaultSelections(insights: InsightsData): string[] {
  const fields: string[] = [];
  const ext = insights.extracted;
  if (ext.inventory_notes) fields.push("inventory_notes");
  if (ext.move_date) fields.push("move_date");
  if (ext.estimated_value_eur != null) fields.push("estimated_value_eur");
  return fields;
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
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [insightsPanel, setInsightsPanel] = useState<InsightsSuggestions | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

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

  // Step 1: Extract (preview only — no changes written)
  const handleAnalyze = useCallback(async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    setInsightsPanel(null);
    try {
      const res = await fetch(`/api/v1/deals/${recordId}/insights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: false }),
      });
      if (!res.ok) {
        setAnalyzeError("Analyse fehlgeschlagen");
        return;
      }
      const data = await res.json();
      const d = data.data;
      if (!d?.insights) {
        setAnalyzeError(d?.error ?? "Keine Nachrichten mit diesem Deal verknüpft.");
        return;
      }
      // Open the approval panel with suggestions.
      setInsightsPanel({
        insights: d.insights,
        transcript: d.transcript,
        selectedFields: buildDefaultSelections(d.insights),
        applyStage: !!d.insights.suggested_stage,
        applyNote: true,
      });
    } catch {
      setAnalyzeError("Netzwerkfehler bei der Analyse");
    } finally {
      setAnalyzing(false);
    }
  }, [recordId]);

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
        }),
      });
      if (res.ok) {
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
