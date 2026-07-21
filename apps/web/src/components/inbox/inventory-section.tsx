"use client";

/**
 * Inventar-Liste im Inbox-Kontextpanel (AI-Umzugsanalyse Phase 2a).
 * Zeigt die strukturierten deal_inventory_items, lässt den Operator Zeilen
 * abhaken (mitnehmen ja/nein) oder löschen und stößt die Chat-Extraktion an.
 * Jede Handkorrektur stempelt source='operator' und überlebt Re-Extraktionen.
 */

import { useCallback, useEffect, useState } from "react";
import { Camera, MessageSquarePlus, Package, RefreshCw, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface InventoryItem {
  id: string;
  name: string;
  category: string | null;
  quantity: number;
  sizeClass: "klein" | "mittel" | "gross" | "sperrig" | null;
  heavyFlag: boolean;
  fragileFlag: boolean;
  disassemblyRequired: boolean;
  moveFlag: boolean;
  dimensionsEstimate: string | null;
  volumeCbmEstimate: string | null;
  confidence: "hoch" | "mittel" | "niedrig" | null;
  source: "chat" | "foto" | "operator";
  needsPhoto: boolean;
  notes: string | null;
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: "warn" | "info" }) {
  return (
    <span
      className={cn(
        "rounded px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide",
        tone === "warn"
          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
          : "bg-muted text-muted-foreground"
      )}
    >
      {children}
    </span>
  );
}

export function InventorySection({
  dealRecordId,
  onInsert,
}: {
  dealRecordId: string;
  /** Fügt Text in den Antwort-Editor ein (gleicher Mechanismus wie die KI-Frage-Chips). */
  onInsert?: (text: string) => void;
}) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [analyzingPhotos, setAnalyzingPhotos] = useState(false);
  const [photoInfo, setPhotoInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/deals/${dealRecordId}/inventory`);
      if (res.ok) {
        const j = (await res.json()) as { data?: InventoryItem[] };
        setItems(j.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [dealRecordId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  async function extract() {
    setExtracting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/deals/${dealRecordId}/inventory/extract`, {
        method: "POST",
      });
      const j = (await res.json().catch(() => ({}))) as {
        data?: { items?: InventoryItem[] };
        error?: string;
      };
      if (!res.ok) {
        setError(j.error ?? `Analyse fehlgeschlagen (${res.status})`);
        return;
      }
      setItems(j.data?.items ?? []);
    } finally {
      setExtracting(false);
    }
  }

  async function analyzePhotos() {
    setAnalyzingPhotos(true);
    setError(null);
    setPhotoInfo(null);
    try {
      const res = await fetch(`/api/v1/deals/${dealRecordId}/inventory/analyze-photos`, {
        method: "POST",
      });
      const j = (await res.json().catch(() => ({}))) as {
        data?: {
          items?: InventoryItem[];
          photosAnalyzed?: number;
          photosSkipped?: number;
          matched?: number;
          added?: number;
        };
        error?: string;
      };
      if (!res.ok) {
        setError(j.error ?? `Foto-Analyse fehlgeschlagen (${res.status})`);
        return;
      }
      setItems(j.data?.items ?? []);
      const d = j.data ?? {};
      setPhotoInfo(
        `${d.photosAnalyzed ?? 0} Foto(s) analysiert · ${d.matched ?? 0} zugeordnet · ${d.added ?? 0} neu` +
          ((d.photosSkipped ?? 0) > 0
            ? ` · ${d.photosSkipped} übrig — nochmal klicken`
            : "")
      );
    } finally {
      setAnalyzingPhotos(false);
    }
  }

  const [newItemName, setNewItemName] = useState("");

  /** Manuelles Hinzufügen fehlender Items ("Option to add additional items"):
   *  legt direkt eine operator-Zeile an — überlebt jede Re-Extraktion. */
  async function addManualItem() {
    const name = newItemName.trim();
    if (!name) return;
    setNewItemName("");
    const res = await fetch(`/api/v1/deals/${dealRecordId}/inventory/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      const j = (await res.json().catch(() => ({}))) as { data?: InventoryItem };
      if (j.data) setItems((prev) => [...prev, j.data!]);
    }
  }

  async function toggleMove(item: InventoryItem) {
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, moveFlag: !i.moveFlag, source: "operator" } : i))
    );
    await fetch(`/api/v1/deals/${dealRecordId}/inventory/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moveFlag: !item.moveFlag }),
    });
  }

  async function remove(item: InventoryItem) {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    await fetch(`/api/v1/deals/${dealRecordId}/inventory/${item.id}`, { method: "DELETE" });
  }

  const moving = items.filter((i) => i.moveFlag);
  const staying = items.filter((i) => !i.moveFlag);
  const totalVolume = moving.reduce((sum, i) => {
    const v = i.volumeCbmEstimate != null ? Number(i.volumeCbmEstimate) : NaN;
    return Number.isFinite(v) ? sum + v : sum;
  }, 0);

  function renderItem(item: InventoryItem) {
    return (
      <div key={item.id} className="group flex items-start gap-2 px-4 py-1">
        <input
          type="checkbox"
          checked={item.moveFlag}
          onChange={() => void toggleMove(item)}
          title={item.moveFlag ? "Kommt mit — abwählen = bleibt" : "Bleibt — anwählen = kommt mit"}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
        />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-xs",
              !item.moveFlag && "text-muted-foreground line-through"
            )}
          >
            {item.name}
            {item.quantity > 1 && (
              <span className="ml-1 text-muted-foreground">×{item.quantity}</span>
            )}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            {(item.sizeClass === "gross" || item.sizeClass === "sperrig") && (
              <Badge>{item.sizeClass}</Badge>
            )}
            {item.heavyFlag && <Badge tone="warn">schwer</Badge>}
            {item.fragileFlag && <Badge tone="warn">zerbrechlich</Badge>}
            {item.disassemblyRequired && <Badge>zerlegen</Badge>}
            {item.needsPhoto && <Badge tone="warn">Foto fehlt</Badge>}
            {item.dimensionsEstimate && <Badge>{item.dimensionsEstimate}</Badge>}
            {item.source === "operator" && <Badge>bestätigt</Badge>}
            {item.confidence === "niedrig" && <Badge>unsicher</Badge>}
          </div>
        </div>
        <button
          onClick={() => void remove(item)}
          className="invisible mt-0.5 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-destructive group-hover:visible"
          aria-label="Zeile löschen"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="pb-2">
      <div className="flex items-center justify-between px-4 pb-1">
        <span className="text-[11px] text-muted-foreground">
          {items.length === 0
            ? "Noch kein Inventar erfasst"
            : `${moving.length} Position(en)${totalVolume > 0 ? ` · ca. ${totalVolume.toFixed(1)} m³` : ""}`}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => void extract()}
            disabled={extracting || analyzingPhotos}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3 w-3", extracting && "animate-spin")} />
            {extracting ? "Analysiere…" : items.length > 0 ? "Chat neu" : "Aus Chat"}
          </button>
          <button
            onClick={() => void analyzePhotos()}
            disabled={extracting || analyzingPhotos}
            title="Kundenfotos analysieren und den Items zuordnen"
            className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-muted disabled:opacity-50"
          >
            <Camera className={cn("h-3 w-3", analyzingPhotos && "animate-pulse")} />
            {analyzingPhotos ? "Analysiere…" : "Fotos"}
          </button>
        </div>
      </div>
      {photoInfo && (
        <p className="mx-4 mb-1 rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
          {photoInfo}
        </p>
      )}
      {error && (
        <p className="mx-4 mb-1 rounded bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
          {error}
        </p>
      )}
      {loading ? (
        <p className="px-4 py-1 text-[11px] text-muted-foreground">Lade…</p>
      ) : (
        <>
          {moving.map(renderItem)}
          {staying.length > 0 && (
            <>
              <p className="flex items-center gap-1 px-4 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Package className="h-3 w-3" />
                Bleibt / kommt nicht mit
              </p>
              {staying.map(renderItem)}
            </>
          )}
          {/* Foto-Nachfragen: wichtige Items ohne Foto — Chip fügt die fertige
              deutsche Frage in den Editor ein, gesendet wird IMMER vom Operator. */}
          {onInsert &&
            (() => {
              const missing = items.filter((i) => i.needsPhoto && i.moveFlag);
              if (missing.length === 0) return null;
              return (
                <div className="px-4 pt-2">
                  <p className="pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Foto-Nachfragen
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {missing.map((i) => (
                      <button
                        key={i.id}
                        onClick={() =>
                          onInsert(
                            `Könnten Sie uns bitte noch ein Foto von ${i.name} schicken? Dann können wir den Transport besser einplanen.`
                          )
                        }
                        title="Frage in den Antwort-Editor einfügen"
                        className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] hover:bg-muted"
                      >
                        <MessageSquarePlus className="h-3 w-3" />
                        {i.name}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}
          <div className="flex items-center gap-1 px-4 pt-2">
            <input
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addManualItem();
              }}
              placeholder="Item ergänzen (z. B. Klavier)…"
              className="h-6 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-[11px]"
            />
            <button
              onClick={() => void addManualItem()}
              disabled={!newItemName.trim()}
              className="rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-muted disabled:opacity-50"
            >
              +
            </button>
          </div>
        </>
      )}
    </div>
  );
}
