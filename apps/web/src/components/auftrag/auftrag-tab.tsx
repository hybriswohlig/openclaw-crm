"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, AlertTriangle, CheckCircle2, Circle, Plus, X, MessageCircle, ExternalLink } from "lucide-react";
import Link from "next/link";
import { RecordDetail } from "@/components/records/record-detail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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
    title: "Stammdaten",
    slugs: ["name", "deal", "operating_company"],
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

// Slugs rendered by custom sections (not by the generic RecordDetail)
const CUSTOM_SLUGS = new Set(["checklist"]);

export function AuftragTab({ recordId }: { recordId: string }) {
  const [loading, setLoading] = useState(true);
  const [object, setObject] = useState<ObjectData | null>(null);
  const [auftrag, setAuftrag] = useState<AuftragRecord | null>(null);
  const [criticalMissing, setCriticalMissing] = useState<CriticalMissing[]>([]);
  const [openQuestions, setOpenQuestions] = useState<string[]>([]);
  const [needsSync, setNeedsSync] = useState(false);

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
