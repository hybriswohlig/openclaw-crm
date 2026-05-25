"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  Plus,
  Trash2,
  Star,
  Pencil,
  Check,
  X,
  GripVertical,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface OfferPackageRow {
  id: string;
  slug: string;
  displayName: string;
  shortDescription: string | null;
  targetSegment: string | null;
  priceFromCents: number | null;
  priceFixedFlag: boolean;
  includedItems: string[];
  isRecommended: boolean;
  sortOrder: number;
  active: boolean;
}

/**
 * Per-operating-company package CRUD dialog. Opens from a "Pakete verwalten"
 * button on the operating-company card. Renders the existing packages in a
 * compact list with inline edit/active toggle/delete, plus a "Neues Paket"
 * row that expands an inline form. No nested dialog — everything happens
 * inside this one sheet.
 */
export function ManagePackagesDialog({
  open,
  onOpenChange,
  operatingCompanyRecordId,
  operatingCompanyName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  operatingCompanyRecordId: string;
  operatingCompanyName: string;
}) {
  const [rows, setRows] = useState<OfferPackageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/v1/customer-portal-settings/${operatingCompanyRecordId}/packages`
      );
      if (res.ok) {
        const j = (await res.json()) as { data: OfferPackageRow[] };
        setRows(j.data);
      }
    } finally {
      setLoading(false);
    }
  }, [operatingCompanyRecordId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function togglePackage(p: OfferPackageRow, patch: Partial<OfferPackageRow>) {
    const res = await fetch(
      `/api/v1/customer-portal-settings/${operatingCompanyRecordId}/packages/${p.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }
    );
    if (res.ok) await load();
  }

  async function deletePackage(p: OfferPackageRow) {
    if (
      !confirm(
        `Paket "${p.displayName}" wirklich löschen? Bestehende Angebote, die darauf verweisen, bleiben funktionsfähig.`
      )
    )
      return;
    const res = await fetch(
      `/api/v1/customer-portal-settings/${operatingCompanyRecordId}/packages/${p.id}`,
      { method: "DELETE" }
    );
    if (res.ok) await load();
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div className="max-h-[92svh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-background p-6 shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium">Pakete: {operatingCompanyName}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Diese Pakete erscheinen im Kunden-Portal und im Quotation-Calculator
              auf dem Lead. Sortierung steuert die Reihenfolge im Portal.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <div className="mt-5 space-y-2">
          {loading && rows.length === 0 && (
            <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          )}

          {!loading && rows.length === 0 && !creating && (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-xs text-muted-foreground">
              Noch keine Pakete. Klicke unten auf „Neues Paket".
            </div>
          )}

          {rows.map((p) =>
            editingId === p.id ? (
              <PackageEditor
                key={p.id}
                initial={p}
                onCancel={() => setEditingId(null)}
                onSave={async (patch) => {
                  await togglePackage(p, patch);
                  setEditingId(null);
                }}
              />
            ) : (
              <PackageRow
                key={p.id}
                row={p}
                onEdit={() => setEditingId(p.id)}
                onToggleActive={() => togglePackage(p, { active: !p.active })}
                onToggleRecommended={() =>
                  togglePackage(p, { isRecommended: !p.isRecommended })
                }
                onDelete={() => deletePackage(p)}
              />
            )
          )}

          {creating && (
            <PackageEditor
              initial={emptyDraft(rows.length)}
              isNew
              onCancel={() => setCreating(false)}
              onSave={async (data) => {
                const res = await fetch(
                  `/api/v1/customer-portal-settings/${operatingCompanyRecordId}/packages`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(data),
                  }
                );
                if (res.ok) {
                  setCreating(false);
                  await load();
                }
              }}
            />
          )}

          {!creating && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-transparent py-3 text-xs font-medium text-muted-foreground hover:bg-accent"
            >
              <Plus className="h-3.5 w-3.5" />
              Neues Paket
            </button>
          )}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-9 rounded-lg border border-border bg-background px-4 text-xs font-medium hover:bg-accent"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Row + Editor ─────────────────────────────────────────────────────────────

function PackageRow({
  row,
  onEdit,
  onToggleActive,
  onToggleRecommended,
  onDelete,
}: {
  row: OfferPackageRow;
  onEdit: () => void;
  onToggleActive: () => void;
  onToggleRecommended: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border bg-card px-3 py-3",
        !row.active && "opacity-60"
      )}
    >
      <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-medium">{row.displayName}</span>
          <span className="font-mono text-[10px] uppercase text-muted-foreground">
            {row.slug}
          </span>
          {row.isRecommended && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              Beliebt
            </span>
          )}
          {!row.active && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Inaktiv
            </span>
          )}
          {row.priceFromCents != null && (
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {row.priceFixedFlag ? "Festpreis " : "ab "}
              {formatEur(row.priceFromCents)}
            </span>
          )}
        </div>
        {row.shortDescription && (
          <p className="mt-0.5 text-xs text-muted-foreground">{row.shortDescription}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-[11px] hover:bg-accent"
          >
            <Pencil className="h-3 w-3" />
            Bearbeiten
          </button>
          <button
            type="button"
            onClick={onToggleRecommended}
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px]",
              row.isRecommended
                ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200"
                : "border-border bg-background hover:bg-accent"
            )}
          >
            <Star className="h-3 w-3" />
            {row.isRecommended ? "Empfohlen" : "Als empfohlen"}
          </button>
          <button
            type="button"
            onClick={onToggleActive}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-[11px] hover:bg-accent"
          >
            {row.active ? <X className="h-3 w-3" /> : <Check className="h-3 w-3" />}
            {row.active ? "Deaktivieren" : "Aktivieren"}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-[11px] text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3 w-3" />
            Löschen
          </button>
        </div>
      </div>
    </div>
  );
}

function PackageEditor({
  initial,
  isNew,
  onCancel,
  onSave,
}: {
  initial: OfferPackageRow;
  isNew?: boolean;
  onCancel: () => void;
  onSave: (data: Omit<OfferPackageRow, "id">) => Promise<void> | void;
}) {
  const [form, setForm] = useState<OfferPackageRow>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof OfferPackageRow>(k: K, v: OfferPackageRow[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function commit() {
    if (!form.slug.trim() || !form.displayName.trim()) {
      setError("Slug und Name sind Pflicht.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { id: _id, ...payload } = form;
      void _id;
      await onSave(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler beim Speichern.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-foreground/30 bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {isNew ? "Neues Paket" : "Paket bearbeiten"}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label="Anzeigename"
          value={form.displayName}
          onChange={(v) => set("displayName", v)}
          placeholder="Komfort"
        />
        <Field
          label="Slug"
          value={form.slug}
          onChange={(v) => set("slug", v)}
          placeholder="komfort"
          mono
        />
      </div>

      <Field
        label="Kurzbeschreibung"
        value={form.shortDescription ?? ""}
        onChange={(v) => set("shortDescription", v || null)}
        placeholder="Beliebteste Wahl. Der stressfreie Standardumzug."
      />

      <Field
        label="Zielgruppe"
        value={form.targetSegment ?? ""}
        onChange={(v) => set("targetSegment", v || null)}
        placeholder="2 bis 4 Zimmer, Familien, Berufsumzüge"
      />

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
        <Field
          label="Preis ab (EUR)"
          value={
            form.priceFromCents != null
              ? (form.priceFromCents / 100).toFixed(2)
              : ""
          }
          onChange={(v) => {
            const n = Number(v);
            set("priceFromCents", v && Number.isFinite(n) ? Math.round(n * 100) : null);
          }}
          placeholder="890.00"
        />
        <Checkbox
          label="Festpreis"
          checked={form.priceFixedFlag}
          onChange={(v) => set("priceFixedFlag", v)}
        />
        <Checkbox
          label="Empfohlen"
          checked={form.isRecommended}
          onChange={(v) => set("isRecommended", v)}
        />
        <Checkbox
          label="Aktiv"
          checked={form.active}
          onChange={(v) => set("active", v)}
        />
      </div>

      <div className="mt-3">
        <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">
          Im Paket enthalten (eine Zeile = ein Punkt)
        </label>
        <textarea
          value={form.includedItems.join("\n")}
          onChange={(e) =>
            set(
              "includedItems",
              e.target.value
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean)
            )
          }
          rows={Math.max(4, form.includedItems.length + 1)}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder={
            "2 bis 3 Helfer plus Transporter\nMöbeldemontage und Montage\nSichere Beladung\nRoutenplanung\nKartonageberatung"
          }
        />
      </div>

      <Field
        label="Sortierung"
        value={String(form.sortOrder)}
        onChange={(v) => set("sortOrder", Math.max(0, Number(v) || 0))}
        placeholder="20"
        small
      />

      {error && (
        <p className="mt-3 rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="h-9 flex-1 rounded-lg border border-border bg-transparent text-xs font-medium hover:bg-accent"
        >
          Abbrechen
        </button>
        <button
          type="button"
          onClick={commit}
          disabled={saving}
          className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-foreground text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Speichern
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono,
  small,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  small?: boolean;
}) {
  return (
    <label className="mt-3 block">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring",
          mono && "font-mono",
          small && "sm:w-24"
        )}
      />
    </label>
  );
}

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="mt-3 flex cursor-pointer items-center gap-2 self-end rounded-md border border-input bg-background px-3 py-1.5 text-xs">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5"
      />
      {label}
    </label>
  );
}

function emptyDraft(existing: number): OfferPackageRow {
  return {
    id: "",
    slug: "",
    displayName: "",
    shortDescription: null,
    targetSegment: null,
    priceFromCents: null,
    priceFixedFlag: false,
    includedItems: [],
    isRecommended: false,
    sortOrder: (existing + 1) * 10,
    active: true,
  };
}

function formatEur(cents: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
