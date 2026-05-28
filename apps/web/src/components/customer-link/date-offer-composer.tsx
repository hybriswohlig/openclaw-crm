"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, X, Calendar, Star } from "lucide-react";

/**
 * Operator-side composer for the multi-date offer.
 *
 * One row per candidate date. Each row holds a YYYY-MM-DD picker, a list of
 * slot pills (label + optional start/end time), a "Empfohlen" star, and a
 * remove button. Bulk-save on "Speichern" — server replaces the full set.
 */
interface SlotInput {
  label: string;
  startTime: string;
  endTime: string;
}

interface OfferInput {
  id: string; // client-side row id for keying
  date: string;
  slots: SlotInput[];
  note: string;
  isRecommended: boolean;
}

interface ApiOffer {
  id: string;
  date: string;
  slots: Array<{ label: string; startTime: string | null; endTime: string | null }>;
  note: string | null;
  isRecommended: boolean;
  sortOrder: number;
}

interface ApiSelection {
  dateOfferId: string;
  selectedDate: string;
  slotLabel: string | null;
  startTime: string | null;
  endTime: string | null;
  selectedAt: string;
}

const QUICK_SLOTS: Array<{ label: string; startTime: string; endTime: string }> = [
  { label: "vormittags", startTime: "08:00", endTime: "12:00" },
  { label: "nachmittags", startTime: "13:00", endTime: "17:00" },
  { label: "ganztags", startTime: "08:00", endTime: "17:00" },
];

export function DateOfferComposer({ dealRecordId }: { dealRecordId: string }) {
  const [offers, setOffers] = useState<OfferInput[]>([]);
  const [selection, setSelection] = useState<ApiSelection | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/deals/${dealRecordId}/date-offers`);
      if (!res.ok) return;
      const json = (await res.json()) as {
        data: { offers: ApiOffer[]; selection: ApiSelection | null };
      };
      setOffers(
        json.data.offers.map((o) => ({
          id: o.id,
          date: o.date,
          slots: o.slots.map((s) => ({
            label: s.label,
            startTime: s.startTime ?? "",
            endTime: s.endTime ?? "",
          })),
          note: o.note ?? "",
          isRecommended: o.isRecommended,
        }))
      );
      setSelection(json.data.selection);
    } finally {
      setLoading(false);
    }
  }, [dealRecordId]);

  useEffect(() => {
    load();
  }, [load]);

  function addOffer() {
    setOffers((prev) => [
      ...prev,
      {
        id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        date: "",
        slots: [{ label: "vormittags", startTime: "08:00", endTime: "12:00" }],
        note: "",
        isRecommended: prev.length === 0,
      },
    ]);
  }

  function patchOffer(id: string, patch: Partial<OfferInput>) {
    setOffers((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }

  function removeOffer(id: string) {
    setOffers((prev) => prev.filter((o) => o.id !== id));
  }

  function addSlot(offerId: string, quick?: SlotInput) {
    setOffers((prev) =>
      prev.map((o) =>
        o.id === offerId
          ? {
              ...o,
              slots: [...o.slots, quick ?? { label: "", startTime: "", endTime: "" }],
            }
          : o
      )
    );
  }

  function patchSlot(offerId: string, idx: number, patch: Partial<SlotInput>) {
    setOffers((prev) =>
      prev.map((o) =>
        o.id === offerId
          ? {
              ...o,
              slots: o.slots.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
            }
          : o
      )
    );
  }

  function removeSlot(offerId: string, idx: number) {
    setOffers((prev) =>
      prev.map((o) =>
        o.id === offerId
          ? { ...o, slots: o.slots.filter((_, i) => i !== idx) }
          : o
      )
    );
  }

  function setRecommended(id: string) {
    setOffers((prev) =>
      prev.map((o) => ({ ...o, isRecommended: o.id === id }))
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body = {
        offers: offers
          .filter((o) => /^\d{4}-\d{2}-\d{2}$/.test(o.date))
          .map((o) => ({
            date: o.date,
            slots: o.slots
              .map((s) => ({
                label: s.label.trim(),
                startTime: s.startTime || null,
                endTime: s.endTime || null,
              }))
              .filter((s) => s.label),
            note: o.note.trim() || null,
            isRecommended: o.isRecommended,
          }))
          .filter((o) => o.slots.length > 0),
      };
      const res = await fetch(`/api/v1/deals/${dealRecordId}/date-offers`, {
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

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-card px-4 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Termine werden geladen…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Calendar className="h-4 w-4" />
          Termin-Vorschläge
        </div>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {offers.length === 0
            ? "Kein Vorschlag"
            : `${offers.length} ${offers.length === 1 ? "Termin" : "Termine"}`}
        </span>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        Schlage dem Kunden bis zu 10 mögliche Termine vor, jeweils mit ein
        oder mehreren Zeitfenstern. Der Kunde wählt im Portal eine Option;
        das Umzugsdatum wird automatisch übernommen.
      </p>

      {selection && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
          Kunde hat{" "}
          <strong className="font-semibold">
            {formatDateLong(selection.selectedDate)}
          </strong>
          {selection.slotLabel ? ` (${selection.slotLabel})` : ""} gewählt
          {" — "}
          {new Date(selection.selectedAt).toLocaleString("de-DE", {
            dateStyle: "short",
            timeStyle: "short",
          })}
          .
        </div>
      )}

      <ul className="mt-4 space-y-3">
        {offers.map((o) => (
          <li
            key={o.id}
            className="rounded-xl border border-border/60 bg-background/60 p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={o.date}
                onChange={(e) => patchOffer(o.id, { date: e.target.value })}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs"
              />
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
              <input
                type="text"
                placeholder="Notiz (optional)"
                value={o.note}
                maxLength={200}
                onChange={(e) => patchOffer(o.id, { note: e.target.value })}
                className="h-8 flex-1 min-w-[160px] rounded-md border border-border bg-background px-2 text-xs"
              />
              <button
                type="button"
                onClick={() => removeOffer(o.id)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label="Termin entfernen"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <ul className="mt-3 space-y-1.5">
              {o.slots.map((s, idx) => (
                <li key={idx} className="flex flex-wrap items-center gap-1.5">
                  <input
                    type="text"
                    placeholder="Bezeichnung"
                    value={s.label}
                    onChange={(e) =>
                      patchSlot(o.id, idx, { label: e.target.value })
                    }
                    className="h-7 w-28 rounded-md border border-border bg-background px-2 text-[11px]"
                  />
                  <input
                    type="time"
                    value={s.startTime}
                    onChange={(e) =>
                      patchSlot(o.id, idx, { startTime: e.target.value })
                    }
                    className="h-7 rounded-md border border-border bg-background px-2 text-[11px]"
                  />
                  <span className="text-[11px] text-muted-foreground">–</span>
                  <input
                    type="time"
                    value={s.endTime}
                    onChange={(e) =>
                      patchSlot(o.id, idx, { endTime: e.target.value })
                    }
                    className="h-7 rounded-md border border-border bg-background px-2 text-[11px]"
                  />
                  <button
                    type="button"
                    onClick={() => removeSlot(o.id, idx)}
                    className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label="Slot entfernen"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-2 flex flex-wrap gap-1">
              {QUICK_SLOTS.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => addSlot(o.id, q)}
                  className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-border px-2 text-[10px] text-muted-foreground hover:bg-accent"
                >
                  <Plus className="h-2.5 w-2.5" />
                  {q.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => addSlot(o.id)}
                className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-border px-2 text-[10px] text-muted-foreground hover:bg-accent"
              >
                <Plus className="h-2.5 w-2.5" /> eigenes Fenster
              </button>
            </div>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={addOffer}
        disabled={offers.length >= 10}
        className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-border bg-background px-3 text-xs font-medium hover:bg-accent disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" />
        Termin hinzufügen
      </button>

      {error && (
        <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">
          {savedAt
            ? `Gespeichert um ${new Date(savedAt).toLocaleTimeString("de-DE")}`
            : `Änderungen werden erst nach "Speichern" für den Kunden sichtbar.`}
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
    </div>
  );
}

function formatDateLong(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00`);
  return d.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
