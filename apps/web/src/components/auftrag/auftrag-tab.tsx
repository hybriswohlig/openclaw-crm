"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, AlertTriangle, CheckCircle2, Circle, Plus, X, MessageCircle, ExternalLink } from "lucide-react";
import Link from "next/link";
import { RecordDetail } from "@/components/records/record-detail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DealDocumentActions } from "@/components/DealDocumentActions";
import type { DealData, Firma } from "@/components/GenerateDocumentDialog";
import { ZeitschaetzungSection } from "@/components/auftrag/zeitschaetzung-section";
import {
  GenerateWorkerInstructionsDialog,
  type AnweisungContext,
} from "@/components/GenerateWorkerInstructionsDialog";

// Shape returned by /api/v1/objects/auftraege
interface AttributeDef {
  id: string;
  slug: string;
  title: string;
  type: string;
  isRequired: boolean;
  isMultiselect: boolean;
  options?: { id: string; title: string; color: string }[];
  statuses?: { id: string; title: string; color: string; isActive: boolean }[];
}

interface ObjectData {
  id: string;
  slug: string;
  attributes: AttributeDef[];
}

interface AuftragRecord {
  id: string;
  values: Record<string, unknown>;
}

interface CriticalMissing {
  field: string;
  question: string;
}

interface LeadContext {
  name: string | null;
  move_date: string | null;
  move_from_address: unknown;
  move_to_address: unknown;
  floors_from: number | null;
  floors_to: number | null;
  elevator_from: string | null;
  elevator_to: string | null;
  inventory_notes: string | null;
  operating_company: { id: string; displayName: string } | null;
}

function buildDealDataForDocs(
  dealRecordId: string,
  ctx: LeadContext
): DealData | null {
  // Require the bare minimum the skill needs (firma + customer surname).
  if (!ctx.operating_company || !ctx.name) return null;
  const company = ctx.operating_company.displayName.toLowerCase();
  const firma: Firma = company.includes("ceylan") ? "ceylan" : "kottke";

  const nameParts = ctx.name.trim().split(/\s+/).filter(Boolean);
  if (nameParts.length === 0) return null;
  const nachname = nameParts[nameParts.length - 1];
  const vorname =
    nameParts.length > 1 ? nameParts.slice(0, -1).join(" ") : undefined;

  const besonderheiten = [
    ctx.floors_from != null &&
      `Auszug ${ctx.floors_from}. Stock${ctx.elevator_from ? ` (${ctx.elevator_from})` : ""}`,
    ctx.floors_to != null &&
      `Einzug ${ctx.floors_to}. Stock${ctx.elevator_to ? ` (${ctx.elevator_to})` : ""}`,
  ]
    .filter(Boolean)
    .join(", ") || undefined;

  const fromAddr = formatLocation(ctx.move_from_address);
  const toAddr = formatLocation(ctx.move_to_address);

  return {
    dealRecordId,
    firma,
    kunde: {
      vorname,
      nachname,
      adresse: fromAddr !== "—" ? fromAddr : undefined,
    },
    auftrag: {
      strecke_von: fromAddr !== "—" ? fromAddr : undefined,
      strecke_nach: toAddr !== "—" ? toAddr : undefined,
      datum: ctx.move_date ?? undefined,
      volumen: ctx.inventory_notes ?? undefined,
      besonderheiten,
    },
  };
}

/**
 * Assemble the AnweisungContext from Lead context + Auftrag values. Returns
 * null if firma / kunde are missing — the button is then hidden, same gate
 * as buildDealDataForDocs.
 */
function buildAnweisungCtx(
  dealRecordId: string,
  lead: LeadContext,
  auftragValues: Record<string, unknown>
): AnweisungContext | null {
  const base = buildDealDataForDocs(dealRecordId, lead);
  if (!base) return null;

  const fromAddr = formatLocation(lead.move_from_address);
  const toAddr = formatLocation(lead.move_to_address);

  const asNum = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const asBool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
  const asStr = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v : null;
  const asArr = (v: unknown): string[] => {
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === "string");
  };
  const selectOpt = (v: unknown): string | null => {
    if (typeof v === "string") return v;
    if (v && typeof v === "object" && "title" in v) {
      const t = (v as { title: unknown }).title;
      if (typeof t === "string") return t;
    }
    return null;
  };

  const checkRaw = auftragValues.checklist;
  const checkliste: { label: string; done: boolean }[] = Array.isArray(checkRaw)
    ? (checkRaw as { label?: unknown; done?: unknown }[])
        .map((c) => ({
          label: typeof c.label === "string" ? c.label : "",
          done: !!c.done,
        }))
        .filter((c) => c.label.length > 0)
    : [];

  const equipment: string[] = (() => {
    const v = auftragValues.equipment_needed;
    if (Array.isArray(v)) {
      return v
        .map((x) => (typeof x === "string" ? x : selectOpt(x)))
        .filter((x): x is string => !!x);
    }
    return asArr(v);
  })();

  const amountOut = auftragValues.amount_outstanding;
  void amountOut; // not used — prices stay out of the Anweisung by design

  return {
    dealRecordId,
    firma: base.firma,
    kunde: {
      vorname: base.kunde.vorname,
      nachname: base.kunde.nachname,
      telefon: undefined, // not on Lead today
      email: base.kunde.email,
    },
    auftrag: {
      datum: lead.move_date ?? undefined,
      zeit_von:
        typeof auftragValues.time_window_start === "string"
          ? auftragValues.time_window_start.slice(11, 16)
          : undefined,
      zeit_bis:
        typeof auftragValues.time_window_end === "string"
          ? auftragValues.time_window_end.slice(11, 16)
          : undefined,
      strecke_von: fromAddr !== "—" ? fromAddr : undefined,
      strecke_nach: toAddr !== "—" ? toAddr : undefined,
      adresse_von: fromAddr !== "—" ? fromAddr : undefined,
      adresse_nach: toAddr !== "—" ? toAddr : undefined,
      stockwerk_von: asNum(lead.floors_from),
      zugang_von: lead.elevator_from,
      laufweg_von_m: asNum(auftragValues.walking_distance_from_m),
      stockwerk_nach: asNum(lead.floors_to),
      zugang_nach: lead.elevator_to,
      laufweg_nach_m: asNum(auftragValues.walking_distance_to_m),
      halteverbot: asBool(auftragValues.parking_halteverbot_needed),
      volumen: (() => {
        const v = auftragValues.volume_cbm;
        if (typeof v === "number" && Number.isFinite(v) && v > 0) return `${v} m³`;
        if (typeof v === "string" && v.trim()) return `${v} m³`;
        return lead.inventory_notes ?? null;
      })(),
      transporter: selectOpt(auftragValues.transporter),
      helfer_anzahl: asNum(auftragValues.worker_count),
      klavier_transport: asBool(auftragValues.piano_transport),
      demontage: asBool(auftragValues.dismantling_required),
      einpackservice: asBool(auftragValues.packing_service),
      entsorgung: asBool(auftragValues.disposal_required),
      einlagerung: asBool(auftragValues.storage_required),
      ausstattung: equipment,
      kontakte: {
        abholung_name: asStr(auftragValues.contact_pickup_name),
        abholung_telefon: asStr(auftragValues.contact_pickup_phone),
        ziel_name: asStr(auftragValues.contact_dropoff_name),
        ziel_telefon: asStr(auftragValues.contact_dropoff_phone),
      },
      checkliste,
      sonderwuensche: asStr(auftragValues.special_requests),
      notizen: asStr(auftragValues.notes),
    },
  };
}

function formatLocation(v: unknown): string {
  if (!v) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return (
      [o.line1, o.postcode, o.city].filter(Boolean).join(", ") ||
      (typeof o.line1 === "string" ? o.line1 : "—")
    );
  }
  return "—";
}

function formatDateDE(iso: string | null): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function extractRefDisplay(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object" && v && "displayName" in v) {
    const d = (v as { displayName: unknown }).displayName;
    if (typeof d === "string") return d;
  }
  return null;
}

interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
  note?: string;
}

// Attribute slugs grouped by UI section. Attributes not listed here get
// dumped into the last "Weitere Details" section so nothing is lost.
const SECTIONS: { title: string; slugs: string[] }[] = [
  {
    // operating_company is intentionally NOT here — it's a read-only mirror
    // of the Deal's value to enforce one source of truth. Edit it on the Deal.
    title: "Stammdaten",
    slugs: ["name", "deal"],
  },
  {
    title: "Logistik",
    slugs: [
      "transporter",
      "worker_count",
      "time_window_start",
      "time_window_end",
      "parking_halteverbot_needed",
      "walking_distance_from_m",
      "walking_distance_to_m",
    ],
  },
  {
    title: "Umfang",
    slugs: [
      "volume_cbm",
      "boxes_needed",
      "dismantling_required",
      "packing_service",
      "piano_transport",
      "disposal_required",
      "storage_required",
    ],
  },
  { title: "Werkzeug / Material", slugs: ["equipment_needed"] },
  {
    title: "Kontakte am Tag",
    slugs: ["contact_pickup_name", "contact_pickup_phone", "contact_dropoff_name", "contact_dropoff_phone"],
  },
  { title: "Zahlung", slugs: ["payment_method", "amount_outstanding"] },
  { title: "Sonderwünsche & Notizen", slugs: ["special_requests", "notes"] },
];

// Slugs handled by custom sections (not by the generic RecordDetail editor).
// `operating_company` is read-only mirrored from the Lead — users cannot edit
// it on the Auftrag, so we suppress the attribute field entirely.
// The Zeitschätzung block owns depot + drive/load/total estimate fields.
const CUSTOM_SLUGS = new Set([
  "checklist",
  "operating_company",
  "depot",
  "drive_segments_json",
  "drive_minutes_total",
  "load_unload_minutes",
  "total_minutes",
  "time_estimate_computed_at",
  "price_calc_json",
]);

export function AuftragTab({ recordId }: { recordId: string }) {
  const [loading, setLoading] = useState(true);
  const [object, setObject] = useState<ObjectData | null>(null);
  const [auftrag, setAuftrag] = useState<AuftragRecord | null>(null);
  const [criticalMissing, setCriticalMissing] = useState<CriticalMissing[]>([]);
  const [openQuestions, setOpenQuestions] = useState<string[]>([]);
  const [leadContext, setLeadContext] = useState<LeadContext | null>(null);
  const [needsSync, setNeedsSync] = useState(false);
  const [anweisungOpen, setAnweisungOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [auftragRes, objRes] = await Promise.all([
        fetch(`/api/v1/deals/${recordId}/auftrag`),
        fetch(`/api/v1/objects/auftraege`),
      ]);

      if (auftragRes.ok) {
        const json = await auftragRes.json();
        const d = json.data;
        if (d?.missing === "auftraege-object") {
          setNeedsSync(true);
          setAuftrag(null);
        } else {
          setAuftrag(d?.auftrag ?? null);
          setCriticalMissing(d?.criticalMissing ?? []);
          setOpenQuestions(d?.openCustomerQuestions ?? []);
          setLeadContext(d?.leadContext ?? null);
        }
      }
      if (objRes.ok) {
        const json = await objRes.json();
        setObject(json.data ?? null);
      } else if (objRes.status === 404) {
        setNeedsSync(true);
      }
    } finally {
      setLoading(false);
    }
  }, [recordId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleUpdate = useCallback(
    async (slug: string, value: unknown) => {
      if (!auftrag) return;
      setAuftrag({ ...auftrag, values: { ...auftrag.values, [slug]: value } });
      await fetch(`/api/v1/objects/auftraege/records/${auftrag.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: { [slug]: value } }),
      });
    },
    [auftrag]
  );

  const checklist: ChecklistItem[] = useMemo(() => {
    if (!auftrag) return [];
    const raw = auftrag.values.checklist;
    if (!Array.isArray(raw)) return [];
    return raw as ChecklistItem[];
  }, [auftrag]);

  const setChecklist = useCallback(
    (next: ChecklistItem[]) => {
      if (!auftrag) return;
      handleUpdate("checklist", next);
    },
    [auftrag, handleUpdate]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (needsSync || !object) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
        <div className="flex items-center gap-2 font-medium text-amber-700 mb-1">
          <AlertTriangle className="h-4 w-4" />
          Auftrag-Objekt ist noch nicht in der Datenbank angelegt
        </div>
        <p className="text-muted-foreground">
          Bitte einmalig <code className="rounded bg-muted px-1 py-0.5 text-xs">pnpm -F @openclaw-crm/web db:sync-objects</code> ausführen, damit die Tabelle „Aufträge" und die neuen Deal-Attribute angelegt werden.
        </p>
      </div>
    );
  }

  if (!auftrag) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        Auftrag wird erstellt…
      </div>
    );
  }

  const attrsBySlug = new Map(object.attributes.map((a) => [a.slug, a]));
  const grouped = SECTIONS.map((section) => ({
    title: section.title,
    attrs: section.slugs
      .map((s) => attrsBySlug.get(s))
      .filter((a): a is AttributeDef => !!a && !CUSTOM_SLUGS.has(a.slug)),
  }));
  const listedSlugs = new Set(SECTIONS.flatMap((s) => s.slugs));
  const extras = object.attributes.filter(
    (a) => !listedSlugs.has(a.slug) && !CUSTOM_SLUGS.has(a.slug)
  );

  const doneCount = checklist.filter((c) => c.done).length;
  const totalCount = checklist.length;

  return (
    <div className="space-y-6">
      {/* ── Open link to full Auftrag page ─────────────────────────── */}
      <div className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">
        <span className="text-muted-foreground">
          Dies ist die Auftragsübersicht für die Monteure. Der vollständige Auftragsdatensatz lebt in
          <span className="font-medium text-foreground"> Aufträge</span>.
        </span>
        <Link
          href={`/objects/auftraege/${auftrag.id}`}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Öffnen <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {/* ── Lead context (read-only) ───────────────────────────────── */}
      {leadContext && (
        <section className="rounded-lg border border-border bg-muted/10 p-3 sm:p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Lead-Kontext
            </h3>
            <Link
              href={`/objects/deals/${recordId}`}
              className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              Im Lead bearbeiten <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <LeadFact
              label="Ausführende Firma"
              value={leadContext.operating_company?.displayName ?? "— (im Lead zuweisen)"}
            />
            <LeadFact label="Umzugsdatum" value={formatDateDE(leadContext.move_date)} />
            <LeadFact
              label="Inventar / Notizen"
              value={leadContext.inventory_notes ?? "—"}
              truncate
            />
            <LeadFact
              label="Abholadresse"
              value={formatLocation(leadContext.move_from_address)}
            />
            <LeadFact
              label="Zieladresse"
              value={formatLocation(leadContext.move_to_address)}
            />
            <LeadFact
              label="Zugang Abholung"
              value={[leadContext.elevator_from, leadContext.floors_from != null ? `${leadContext.floors_from}. Stock` : null]
                .filter(Boolean)
                .join(" · ") || "—"}
            />
            <LeadFact
              label="Zugang Ziel"
              value={[leadContext.elevator_to, leadContext.floors_to != null ? `${leadContext.floors_to}. Stock` : null]
                .filter(Boolean)
                .join(" · ") || "—"}
            />
          </dl>
        </section>
      )}

      {/* ── Dokumente erstellen (Auftragsbestätigung / Rechnung) ───── */}
      {leadContext && (() => {
        const dealData = buildDealDataForDocs(recordId, leadContext);
        if (!dealData) {
          return (
            <section className="rounded-lg border border-dashed border-border bg-muted/10 p-3 sm:p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Dokumente erstellen
              </h3>
              <p className="text-xs text-muted-foreground">
                Zum Erstellen einer Auftragsbestätigung oder Rechnung müssen
                <span className="font-medium text-foreground"> ausführende Firma</span> und
                <span className="font-medium text-foreground"> Kundenname</span> im Lead gesetzt sein.
              </p>
            </section>
          );
        }
        const anweisungCtx = buildAnweisungCtx(recordId, leadContext, auftrag.values);
        return (
          <section className="rounded-lg border border-border bg-muted/10 p-3 sm:p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Dokumente erstellen
              </h3>
              <span className="text-[10px] text-muted-foreground">
                Vorausgefüllt aus dem Lead — Preise im Modal nachtragen
              </span>
            </div>
            <DealDocumentActions deal={dealData} />
            {anweisungCtx && (
              <div className="border-t border-border pt-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  Crew-Unterlagen (intern, ohne Preise)
                </div>
                <button
                  type="button"
                  onClick={() => setAnweisungOpen(true)}
                  className="rounded border bg-white px-3 py-1.5 text-sm hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-800"
                >
                  Auftragsanweisung erstellen
                </button>
              </div>
            )}
            {anweisungCtx && anweisungOpen && (
              <GenerateWorkerInstructionsDialog
                open
                ctx={anweisungCtx}
                onClose={() => setAnweisungOpen(false)}
              />
            )}
          </section>
        );
      })()}

      {/* ── Zeitschätzung & Preis-Kalkulator ─────────────────────────── */}
      {leadContext && (
        <ZeitschaetzungSection
          recordId={recordId}
          dealData={buildDealDataForDocs(recordId, leadContext)}
          onLeadUpdated={load}
          initial={{
            depotName:
              extractRefDisplay(auftrag.values.depot) ?? null,
            driveMinutesTotal:
              typeof auftrag.values.drive_minutes_total === "number"
                ? auftrag.values.drive_minutes_total
                : null,
            loadUnloadMinutes:
              typeof auftrag.values.load_unload_minutes === "number"
                ? auftrag.values.load_unload_minutes
                : null,
            totalMinutes:
              typeof auftrag.values.total_minutes === "number"
                ? auftrag.values.total_minutes
                : null,
            computedAt:
              typeof auftrag.values.time_estimate_computed_at === "string"
                ? auftrag.values.time_estimate_computed_at
                : null,
            segments:
              (auftrag.values.drive_segments_json as
                | { legs?: never; pickupAddress?: string; dropoffAddress?: string; warnings?: string[] }
                | null) ?? null,
          }}
        />
      )}

      {/* ── Critical-missing orange card ───────────────────────────── */}
      {criticalMissing.length > 0 && (
        <div className="rounded-lg border border-orange-500/40 bg-orange-500/10 p-4">
          <div className="flex items-start gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-orange-600 mt-0.5 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-orange-700">
                Fehlende Infos — müssen wir noch erfragen
              </h3>
              <p className="text-xs text-orange-700/80 mt-0.5">
                Diese Fragen solltest du dem Kunden stellen, bevor der Auftrag geplant wird:
              </p>
            </div>
          </div>
          <ul className="space-y-2 pl-6">
            {criticalMissing.map((cm, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <MessageCircle className="h-3.5 w-3.5 text-orange-600 mt-1 shrink-0" />
                <div>
                  <div className="font-medium">{cm.question}</div>
                  <div className="text-xs text-muted-foreground">Feld: {cm.field}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {openQuestions.length > 0 && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 text-sm">
          <div className="flex items-center gap-1.5 font-medium text-blue-700 mb-1.5">
            <MessageCircle className="h-3.5 w-3.5" />
            Offene Kundenfragen
          </div>
          <ul className="space-y-0.5 text-xs text-muted-foreground pl-5 list-disc">
            {openQuestions.map((q, i) => <li key={i}>{q}</li>)}
          </ul>
        </div>
      )}

      {/* ── Sections ─────────────────────────────────────────────── */}
      {grouped.map((g) =>
        g.attrs.length === 0 ? null : (
          <section key={g.title} className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3">
              {g.title}
            </h3>
            <div className="rounded-md border border-border bg-background">
              <RecordDetail
                attributes={g.attrs as never}
                values={auftrag.values}
                onUpdate={handleUpdate}
              />
            </div>
          </section>
        )
      )}

      {/* ── Checklist ────────────────────────────────────────────── */}
      <section className="space-y-2">
        <div className="flex items-center justify-between px-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Checkliste
          </h3>
          <span className="text-xs text-muted-foreground">
            {doneCount} / {totalCount} erledigt
          </span>
        </div>
        <div className="rounded-md border border-border bg-background p-3 space-y-1">
          {totalCount > 0 && (
            <div className="h-1.5 w-full rounded-full bg-muted mb-3 overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${totalCount === 0 ? 0 : (doneCount / totalCount) * 100}%` }}
              />
            </div>
          )}
          {checklist.map((item, idx) => (
            <ChecklistRow
              key={item.key + idx}
              item={item}
              onToggle={() => {
                const next = checklist.map((c, i) =>
                  i === idx ? { ...c, done: !c.done } : c
                );
                setChecklist(next);
              }}
              onRemove={() => setChecklist(checklist.filter((_, i) => i !== idx))}
            />
          ))}
          <AddChecklistItem
            onAdd={(label) => {
              const key = `custom_${Date.now()}`;
              setChecklist([...checklist, { key, label, done: false }]);
            }}
          />
        </div>
      </section>

      {/* ── Any unlisted attributes ──────────────────────────────── */}
      {extras.length > 0 && (
        <section className="space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3">
            Weitere Details
          </h3>
          <div className="rounded-md border border-border bg-background">
            <RecordDetail
              attributes={extras as never}
              values={auftrag.values}
              onUpdate={handleUpdate}
            />
          </div>
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────

function ChecklistRow({
  item,
  onToggle,
  onRemove,
}: {
  item: ChecklistItem;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="group flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-muted/40">
      <button
        type="button"
        onClick={onToggle}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        {item.done ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
        ) : (
          <Circle className="h-5 w-5" />
        )}
      </button>
      <span
        className={cn(
          "flex-1 text-sm",
          item.done && "text-muted-foreground line-through"
        )}
      >
        {item.label}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
        aria-label="Entfernen"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function AddChecklistItem({ onAdd }: { onAdd: (label: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" />
        Punkt hinzufügen
      </button>
    );
  }

  const commit = () => {
    const trimmed = label.trim();
    if (trimmed) onAdd(trimmed);
    setLabel("");
    setAdding(false);
  };

  return (
    <div className="mt-1 flex items-center gap-2">
      <Input
        autoFocus
        value={label}
        placeholder="Neuer Checklistenpunkt…"
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setLabel("");
            setAdding(false);
          }
        }}
        className="h-8 text-sm"
      />
      <Button size="sm" variant="ghost" onClick={commit}>
        Hinzufügen
      </Button>
    </div>
  );
}

function LeadFact({
  label,
  value,
  truncate,
}: {
  label: string;
  value: string;
  truncate?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-sm text-foreground",
          truncate && "line-clamp-2"
        )}
        title={truncate ? value : undefined}
      >
        {value}
      </dd>
    </div>
  );
}
