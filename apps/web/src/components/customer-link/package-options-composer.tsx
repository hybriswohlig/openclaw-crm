"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, X, Star, Package } from "lucide-react";

/**
 * Operator-side composer for per-deal package options.
 *
 * Workflow:
 *   1. Operator clicks "Aus Katalog vorbefüllen" → seeds rows from the
 *      firma's offer_packages catalogue with empty prices.
 *   2. Operator types a price per row, marks one as "Empfohlen", saves.
 *   3. Customer sees those exact rows in Stage 1 of the portal.
 *
 * Each option holds: displayName + priceCents (required), shortDescription,
 * included items list, recommended flag, optional note. catalogueSlug is
 * tracked silently so the operator's analytics can still answer "how often
 * does Komfort win" across deals.
 */
interface OptionInput {
  id: string; // client-side row id
  catalogueSlug: string | null;
  displayName: string;
  shortDescription: string;
  priceEur: string;
  includedItems: string;
  note: string;
  isRecommended: boolean;
}

interface ApiOption {
  id: string;
  catalogueSlug: string | null;
  displayName: string;
  shortDescription: string | null;
  priceCents: number;
  includedItems: string[];
  note: string | null;
  isRecommended: boolean;
  sortOrder: number;
}

interface ApiCataloguePackage {
  slug: string;
  displayName: string;
  shortDescription: string | null;
  priceFromCents: number | null;
  includedItems: string[];
}

export function PackageOptionsComposer({
  dealRecordId,
}: {
  dealRecordId: string;
}) {
  const [options, setOptions] = useState<OptionInput[]>([]);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [catalogue, setCatalogue] = useState<ApiCataloguePackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [optsRes, catRes] = await Promise.all([
        fetch(`/api/v1/deals/${dealRecordId}/package-options`),
        fetch(`/api/v1/deals/${dealRecordId}/offer-packages`).catch(() => null),
      ]);
      if (optsRes.ok) {
        const json = (await optsRes.json()) as {
          data: { options: ApiOption[]; selectedOptionId: string | null };
        };
        setOptions(
          json.data.options.map((o) => ({
            id: o.id,
            catalogueSlug: o.catalogueSlug,
            displayName: o.displayName,
            shortDescription: o.shortDescription ?? "",
            priceEur: (o.priceCents / 100).toFixed(2).replace(".", ","),
            includedItems: (o.includedItems ?? []).join("\n"),
            note: o.note ?? "",
            isRecommended: o.isRecommended,
          }))
        );
        setSelectedOptionId(json.data.selectedOptionId);
      }
      // Catalogue load is best-effort; without it the "Aus Katalog vorbefüllen"
      // button stays hidden but the composer still works for ad-hoc options.
      if (catRes?.ok) {
        const json = (await catRes.json()) as {
          data: { available: ApiCataloguePackage[] };
        };
        setCatalogue(json.data?.available ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [dealRecordId]);

  useEffect(() => {
    load();
  }, [load]);

  function addBlank() {
    setOptions((prev) => [
      ...prev,
      {
        id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        catalogueSlug: null,
        displayName: "",
        shortDescription: "",
        priceEur: "",
        includedItems: "",
        note: "",
        isRecommended: prev.length === 0,
      },
    ]);
  }

  function seedFromCatalogue() {
    if (catalogue.length === 0) return;
    setOptions(
      catalogue.map((c, i) => ({
        id: `tmp-${Date.now()}-${i}`,
        catalogueSlug: c.slug,
        displayName: c.displayName,
        shortDescription: c.shortDescription ?? "",
        priceEur:
          c.priceFromCents != null
            ? (c.priceFromCents / 100).toFixed(2).replace(".", ",")
            : "",
        includedItems: (c.includedItems ?? []).join("\n"),
        note: "",
        isRecommended: i === 1, // middle tier as default
      }))
    );
  }

  function patch(id: string, p: Partial<OptionInput>) {
    setOptions((prev) => prev.map((o) => (o.id === id ? { ...o, ...p } : o)));
  }

  function remove(id: string) {
    setOptions((prev) => prev.filter((o) => o.id !== id));
  }

  function setRecommended(id: string) {
    setOptions((prev) =>
      prev.map((o) => ({ ...o, isRecommended: o.id === id }))
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body = {
        options: options
          .map((o) => {
            const cents = parseEur(o.priceEur);
            return {
              catalogueSlug: o.catalogueSlug,
              displayName: o.displayName.trim(),
              shortDescription: o.shortDescription.trim() || null,
              priceCents: cents,
              includedItems: o.includedItems
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
              note: o.note.trim() || null,
              isRecommended: o.isRecommended,
            };
          })
          .filter(
            (o) =>
              o.displayName.length > 0 &&
              o.priceCents != null &&
              o.priceCents >= 0
          ),
      };
      const res = await fetch(`/api/v1/deals/${dealRecordId}/package-options`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j?.error?.message ?? "Speichern fehlgeschlagen.");
        return;
      }
      setSavedAt(Date.now());
      await load();
    } catch {
      setError("Verbindungsfehler beim Speichern.");
    } finally {
      setSaving(false);
    }
  }

  async function clearAll() {
    if (!confirm("Alle Paket-Optionen für diesen Auftrag entfernen?")) return;
    await fetch(`/api/v1/deals/${dealRecordId}/package-options`, {
      method: "DELETE",
    });
    setOptions([]);
    setSelectedOptionId(null);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-card px-4 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Pakete werden geladen…
      </div>
    );
  }

  const selectedDisplay = options.find((o) => o.id === selectedOptionId);

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Package className="h-4 w-4" />
          Paket-Optionen
        </div>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {options.length === 0
            ? "Keine Optionen"
            : `${options.length} ${options.length === 1 ? "Option" : "Optionen"}`}
        </span>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        Schlage dem Kunden bis zu 6 individuelle Pakete vor, mit Preisen, die
        du speziell für diesen Auftrag kalkulierst. Der Kunde wählt im Portal
        eine Option — sein verbindlicher Preis ist dann genau diese Zahl.
      </p>

      {selectedDisplay && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
          Kunde hat{" "}
          <strong className="font-semibold">{selectedDisplay.displayName}</strong>{" "}
          gewählt.
        </div>
      )}

      <ul className="mt-4 space-y-3">
        {options.map((o) => (
          <li
            key={o.id}
            className="rounded-xl border border-border/60 bg-background/60 p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder="Paketname (z.B. Komfort)"
                value={o.displayName}
                onChange={(e) => patch(o.id, { displayName: e.target.value })}
                className="h-8 flex-1 min-w-[140px] rounded-md border border-border bg-background px-2 text-xs"
              />
              <div className="flex items-center gap-1 rounded-md border border-border bg-background px-2">
                <span className="text-xs text-muted-foreground">€</span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={o.priceEur}
                  onChange={(e) =>
                    patch(o.id, { priceEur: e.target.value.replace(".", ",") })
                  }
                  className="h-7 w-20 border-none bg-transparent px-1 text-right text-xs outline-none tabular-nums"
                />
              </div>
              <button
                type="button"
                onClick={() => setRecommended(o.id)}
                className={
                  "inline-flex h-8 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition " +
                  (o.isRecommended
                    ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200"
                    : "border-border text-muted-foreground hover:bg-accent")
                }
              >
                <Star
                  className={
                    "h-3 w-3 " + (o.isRecommended ? "fill-current" : "")
                  }
                />
                {o.isRecommended ? "Empfohlen" : "Empfehlen"}
              </button>
              <button
                type="button"
                onClick={() => remove(o.id)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label="Option entfernen"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <input
              type="text"
              placeholder="Kurzbeschreibung (optional)"
              value={o.shortDescription}
              maxLength={200}
              onChange={(e) =>
                patch(o.id, { shortDescription: e.target.value })
              }
              className="mt-2 h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
            />

            <textarea
              placeholder={`Enthaltene Leistungen (eine pro Zeile)\nz.B.\n2 Helfer\nTransporter inkl. Diesel\nBe- und Entladen`}
              value={o.includedItems}
              onChange={(e) => patch(o.id, { includedItems: e.target.value })}
              rows={4}
              className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs leading-relaxed"
            />

            <input
              type="text"
              placeholder="Hinweis unter der Option (optional)"
              value={o.note}
              maxLength={200}
              onChange={(e) => patch(o.id, { note: e.target.value })}
              className="mt-2 h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
            />
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={addBlank}
          disabled={options.length >= 6}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-border bg-background px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          Option hinzufügen
        </button>
        {catalogue.length > 0 && options.length === 0 && (
          <button
            type="button"
            onClick={seedFromCatalogue}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-border bg-background px-3 text-xs font-medium hover:bg-accent"
          >
            Aus Katalog vorbefüllen
          </button>
        )}
        {options.length > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-destructive hover:bg-destructive/10"
          >
            Alle entfernen
          </button>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {options.length > 0 && (
        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground">
            {savedAt
              ? `Gespeichert um ${new Date(savedAt).toLocaleTimeString("de-DE")}`
              : "Wirksam erst nach Speichern."}
          </span>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-foreground px-3 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Speichern
          </button>
        </div>
      )}
    </div>
  );
}

/** Parse "1.234,56" / "1234.56" / "990" → cents. Returns null on garbage. */
function parseEur(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const eur = Number(cleaned);
  if (!Number.isFinite(eur) || eur < 0) return null;
  return Math.round(eur * 100);
}
