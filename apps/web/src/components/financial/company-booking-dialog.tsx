"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { prepareReceiptDataUrl } from "@/lib/receipt-image";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_TAX_TREATMENT_LABELS,
  INCOME_TAX_TREATMENT_LABELS,
} from "@/lib/expense-categories";

async function saveErrorDescription(res: Response): Promise<string> {
  const data = await res.json().catch(() => null);
  const err = (data as { error?: unknown } | null)?.error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message?: unknown }).message);
  }
  return "Bitte erneut versuchen.";
}

type ExpenseTreatment = "voll" | "teilweise" | "nicht";
type IncomeTreatment = "betriebseinnahme" | "nicht_steuerbar";

const EXPENSE_TREATMENTS: ExpenseTreatment[] = ["voll", "teilweise", "nicht"];

function isExpenseTreatment(v: unknown): v is ExpenseTreatment {
  return v === "voll" || v === "teilweise" || v === "nicht";
}

function categoryDef(value: string) {
  return EXPENSE_CATEGORIES.find((c) => c.value === value);
}

const DEFAULT_CATEGORY =
  EXPENSE_CATEGORIES.find((c) => c.value === "other")?.value ??
  EXPENSE_CATEGORIES[0]?.value ??
  "other";

interface OperatingCompany {
  id: string;
  name: string;
}

interface DealHit {
  id: string;
  displayName: string;
  subtitle: string;
}

/** A booking row to edit (deal-less bookings from the Buchungen list). */
export interface BookingEditTarget {
  id: string;
  type: "income" | "expense";
  date: string;
  amount: number;
  operatingCompanyId: string;
  category?: string | null;
  taxTreatment: string;
  deductiblePercent?: number | null;
  description?: string | null;
  payer?: string | null;
  recipient?: string | null;
}

function emptyForm(defaultCompanyId: string) {
  const def = categoryDef(DEFAULT_CATEGORY);
  return {
    date: new Date().toISOString().slice(0, 10),
    amount: "",
    operatingCompanyId: defaultCompanyId,
    category: DEFAULT_CATEGORY,
    taxTreatment: (def?.defaultTreatment ?? "voll") as ExpenseTreatment,
    deductiblePercent: String(def?.defaultPercent ?? 70),
    incomeTaxTreatment: "betriebseinnahme" as IncomeTreatment,
    recipient: "",
    payer: "",
    paymentMethod: "",
    description: "",
    receiptFile: null as string | null,
    receiptName: "" as string,
  };
}

export function CompanyBookingDialog({
  open,
  onClose,
  operatingCompanies,
  onSaved,
  editing = null,
}: {
  open: boolean;
  onClose: () => void;
  operatingCompanies: OperatingCompany[];
  onSaved: () => void;
  /** When set, the dialog edits this booking via PATCH instead of creating. */
  editing?: BookingEditTarget | null;
}) {
  const [type, setType] = useState<"income" | "expense">("expense");
  const [form, setForm] = useState(() => emptyForm(""));
  const [saving, setSaving] = useState(false);

  // Optional deal link (debounced search, same pattern as the inbox context panel).
  const [selectedDeal, setSelectedDeal] = useState<DealHit | null>(null);
  const [dealQuery, setDealQuery] = useState("");
  const [dealResults, setDealResults] = useState<DealHit[]>([]);
  const [dealSearchLoading, setDealSearchLoading] = useState(false);
  const searchTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      const def = editing.category ? categoryDef(editing.category) : undefined;
      setType(editing.type);
      setForm({
        date: editing.date.slice(0, 10),
        amount: editing.amount.toFixed(2),
        operatingCompanyId: editing.operatingCompanyId,
        category: editing.category ?? DEFAULT_CATEGORY,
        taxTreatment: isExpenseTreatment(editing.taxTreatment)
          ? editing.taxTreatment
          : (def?.defaultTreatment ?? "voll"),
        deductiblePercent: String(
          editing.deductiblePercent ?? def?.defaultPercent ?? 70
        ),
        incomeTaxTreatment:
          editing.taxTreatment === "nicht_steuerbar"
            ? "nicht_steuerbar"
            : "betriebseinnahme",
        recipient: editing.recipient ?? "",
        payer: editing.payer ?? "",
        paymentMethod: "",
        description: editing.description ?? "",
        receiptFile: null,
        receiptName: "",
      });
    } else {
      setType("expense");
      setForm(emptyForm(operatingCompanies[0]?.id ?? ""));
    }
    setSelectedDeal(null);
    setDealQuery("");
    setDealResults([]);
  }, [open, operatingCompanies, editing]);

  // Clear a pending debounce on unmount.
  useEffect(
    () => () => {
      if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
    },
    []
  );

  function searchDeals(q: string) {
    setDealQuery(q);
    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
    if (!q.trim()) {
      setDealResults([]);
      setDealSearchLoading(false);
      return;
    }
    setDealSearchLoading(true);
    searchTimerRef.current = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/search?q=${encodeURIComponent(q)}&limit=10`);
        if (res.ok) {
          const data = (await res.json()) as {
            data?: Array<{
              type: string;
              id: string;
              title: string;
              subtitle?: string;
              objectSlug?: string;
            }>;
          };
          setDealResults(
            (data.data ?? [])
              .filter((r) => r.type === "record" && r.objectSlug === "deals")
              .map((r) => ({
                id: r.id,
                displayName: r.title,
                subtitle: r.subtitle ?? "",
              }))
          );
        }
      } catch {
        // ignore
      } finally {
        setDealSearchLoading(false);
      }
    }, 300);
  }

  async function handleReceiptPick(file: File) {
    try {
      const dataUrl = await prepareReceiptDataUrl(file);
      setForm((f) => ({ ...f, receiptFile: dataUrl, receiptName: file.name }));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  function handleCategoryChange(value: string) {
    const def = categoryDef(value);
    setForm((f) => ({
      ...f,
      category: value,
      taxTreatment: (def?.defaultTreatment ?? f.taxTreatment) as ExpenseTreatment,
      deductiblePercent:
        def?.defaultTreatment === "teilweise"
          ? String(def.defaultPercent ?? 70)
          : f.deductiblePercent,
    }));
  }

  const activeDef = categoryDef(form.category);
  const treatmentLocked = activeDef?.locked === true;
  const effectiveTreatment: ExpenseTreatment = treatmentLocked
    ? ((activeDef?.defaultTreatment ?? form.taxTreatment) as ExpenseTreatment)
    : form.taxTreatment;

  const percentNum = Number(form.deductiblePercent);
  const percentValid =
    Number.isFinite(percentNum) && percentNum >= 1 && percentNum <= 99;

  const canSave =
    !!form.date &&
    !!form.amount &&
    !!form.operatingCompanyId &&
    (type !== "expense" || effectiveTreatment !== "teilweise" || percentValid);

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        operatingCompanyId: form.operatingCompanyId,
        date: form.date,
        amount: form.amount,
        description: form.description || null,
      };
      if (!editing) {
        body.type = type;
        body.paymentMethod = form.paymentMethod || null;
        if (selectedDeal) body.dealRecordId = selectedDeal.id;
      }
      if (type === "expense") {
        body.category = form.category;
        body.taxTreatment = effectiveTreatment;
        if (effectiveTreatment === "teilweise") {
          body.deductiblePercent = Math.min(
            99,
            Math.max(1, Math.round(percentNum || 70))
          );
        }
        body.recipient = form.recipient || null;
      } else {
        body.taxTreatment = form.incomeTaxTreatment;
        body.payer = form.payer || null;
      }
      if (form.receiptFile !== null) {
        body.receiptFile = form.receiptFile;
        body.receiptName = form.receiptName || null;
      }
      const res = editing
        ? await fetch(
            `/api/v1/financial/bookings/${editing.id}?type=${editing.type}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          )
        : await fetch("/api/v1/financial/bookings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
      if (!res.ok) {
        toast.error("Buchung konnte nicht gespeichert werden", {
          description: await saveErrorDescription(res),
        });
        return;
      }
      toast.success(editing ? "Buchung aktualisiert" : "Buchung gespeichert");
      onClose();
      onSaved();
    } catch {
      toast.error("Buchung konnte nicht gespeichert werden", {
        description: "Netzwerkfehler. Bitte erneut versuchen.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editing
              ? editing.type === "income"
                ? "Einnahme bearbeiten"
                : "Ausgabe bearbeiten"
              : "Buchung erfassen"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {!editing && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setType("expense")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  type === "expense"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                Ausgabe
              </button>
              <button
                type="button"
                onClick={() => setType("income")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  type === "income"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                Einnahme
              </button>
            </div>
          )}

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Gesellschaft *</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.operatingCompanyId}
              onChange={(e) => setForm((f) => ({ ...f, operatingCompanyId: e.target.value }))}
            >
              {operatingCompanies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Datum *</label>
              <input
                type="date"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Betrag (€) *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="0,00"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
          </div>

          {type === "expense" ? (
            <>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Kategorie</label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.category}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
                {activeDef?.hint && (
                  <p className="text-[11px] text-muted-foreground mt-1">{activeDef.hint}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Steuerliche Behandlung
                  </label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
                    value={effectiveTreatment}
                    disabled={treatmentLocked}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        taxTreatment: e.target.value as ExpenseTreatment,
                      }))
                    }
                  >
                    {EXPENSE_TREATMENTS.map((t) => (
                      <option key={t} value={t}>
                        {EXPENSE_TAX_TREATMENT_LABELS[t] ?? t}
                      </option>
                    ))}
                  </select>
                  {treatmentLocked && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Durch die Kategorie festgelegt
                    </p>
                  )}
                </div>
                {effectiveTreatment === "teilweise" && (
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">
                      Absetzbarer Anteil (%)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      step={1}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={form.deductiblePercent}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, deductiblePercent: e.target.value }))
                      }
                    />
                    {!percentValid && (
                      <p className="text-[11px] text-destructive mt-1">
                        Bitte 1 bis 99 Prozent angeben
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Empfänger</label>
                  <input
                    type="text"
                    placeholder="Tankstelle, Vermieter…"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.recipient}
                    onChange={(e) => setForm((f) => ({ ...f, recipient: e.target.value }))}
                  />
                </div>
                {!editing && (
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Zahlungsart</label>
                    <select
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={form.paymentMethod}
                      onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                    >
                      <option value="">(keine Angabe)</option>
                      <option value="cash">Bar</option>
                      <option value="bank_transfer">Überweisung</option>
                      <option value="other">Sonstiges</option>
                    </select>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Steuerliche Behandlung
                </label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.incomeTaxTreatment}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      incomeTaxTreatment: e.target.value as IncomeTreatment,
                    }))
                  }
                >
                  {(["betriebseinnahme", "nicht_steuerbar"] as const).map((t) => (
                    <option key={t} value={t}>
                      {INCOME_TAX_TREATMENT_LABELS[t] ?? t}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Nicht steuerbar: z.B. Kaution, durchlaufender Posten, Erstattung
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Zahler</label>
                  <input
                    type="text"
                    placeholder="Wer hat gezahlt?"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.payer}
                    onChange={(e) => setForm((f) => ({ ...f, payer: e.target.value }))}
                  />
                </div>
                {!editing && (
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Zahlungsart</label>
                    <select
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={form.paymentMethod}
                      onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                    >
                      <option value="">(keine Angabe)</option>
                      <option value="cash">Bar</option>
                      <option value="bank_transfer">Überweisung</option>
                      <option value="other">Sonstiges</option>
                    </select>
                  </div>
                )}
              </div>
            </>
          )}

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Beschreibung</label>
            <input
              type="text"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          {!editing && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Auftrag (optional, leer = Buchung ohne Auftrag)
              </label>
              {selectedDeal ? (
                <div className="flex items-center gap-2 rounded-md border border-input bg-muted/40 px-3 py-2 text-sm">
                  <span className="truncate font-medium">{selectedDeal.displayName}</span>
                  {selectedDeal.subtitle && (
                    <span className="text-xs text-muted-foreground truncate">{selectedDeal.subtitle}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelectedDeal(null)}
                    className="ml-auto p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive shrink-0"
                    title="Auftrag entfernen"
                    aria-label="Auftrag entfernen"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Auftrag suchen…"
                      className="w-full rounded-md border border-input bg-background pl-8 pr-8 py-2 text-sm"
                      value={dealQuery}
                      onChange={(e) => searchDeals(e.target.value)}
                    />
                    {dealQuery && (
                      <button
                        type="button"
                        onClick={() => searchDeals("")}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        title="Suche leeren"
                        aria-label="Suche leeren"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {dealSearchLoading && (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Suche läuft…
                    </p>
                  )}
                  {!dealSearchLoading && dealQuery.trim() !== "" && dealResults.length === 0 && (
                    <p className="text-xs text-muted-foreground">Keine Aufträge gefunden</p>
                  )}
                  {dealResults.length > 0 && (
                    <div className="rounded-md border border-border max-h-40 overflow-y-auto divide-y divide-border">
                      {dealResults.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => {
                            setSelectedDeal(d);
                            setDealQuery("");
                            setDealResults([]);
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-muted/40 transition-colors"
                        >
                          <span className="font-medium">{d.displayName}</span>
                          {d.subtitle && (
                            <span className="ml-2 text-xs text-muted-foreground">{d.subtitle}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              {editing
                ? "Beleg nachreichen oder ersetzen (Bild oder PDF)"
                : "Beleg / Rechnung (Bild oder PDF)"}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept="image/*,application/pdf"
                className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-input file:bg-background file:text-sm file:cursor-pointer hover:file:bg-muted"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleReceiptPick(f);
                }}
              />
              {form.receiptFile && (
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, receiptFile: null, receiptName: "" }))}
                  className="text-xs text-muted-foreground hover:text-destructive shrink-0"
                >
                  Entfernen
                </button>
              )}
            </div>
            {form.receiptName && (
              <p className="text-[11px] text-muted-foreground mt-1 truncate">{form.receiptName}</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button onClick={handleSave} disabled={saving || !canSave}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
