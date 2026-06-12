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

async function saveErrorDescription(res: Response): Promise<string> {
  const data = await res.json().catch(() => null);
  const err = (data as { error?: unknown } | null)?.error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message?: unknown }).message);
  }
  return "Bitte erneut versuchen.";
}

const CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "fuel", label: "Kraftstoff" },
  { value: "truck_rental", label: "LKW-Miete" },
  { value: "equipment", label: "Ausstattung" },
  { value: "subcontractor", label: "Subunternehmer" },
  { value: "toll", label: "Maut" },
  { value: "other", label: "Sonstiges" },
];

interface OperatingCompany {
  id: string;
  name: string;
}

interface DealHit {
  id: string;
  displayName: string;
  subtitle: string;
}

function emptyForm(defaultCompanyId: string) {
  return {
    date: new Date().toISOString().slice(0, 10),
    amount: "",
    operatingCompanyId: defaultCompanyId,
    category: "other",
    isTaxDeductible: true,
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
}: {
  open: boolean;
  onClose: () => void;
  operatingCompanies: OperatingCompany[];
  onSaved: () => void;
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
    setType("expense");
    setForm(emptyForm(operatingCompanies[0]?.id ?? ""));
    setSelectedDeal(null);
    setDealQuery("");
    setDealResults([]);
  }, [open, operatingCompanies]);

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

  const canSave = !!form.date && !!form.amount && !!form.operatingCompanyId;

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        type,
        operatingCompanyId: form.operatingCompanyId,
        date: form.date,
        amount: form.amount,
        description: form.description || null,
        paymentMethod: form.paymentMethod || null,
      };
      if (selectedDeal) body.dealRecordId = selectedDeal.id;
      if (type === "expense") {
        body.category = form.category;
        body.isTaxDeductible = form.isTaxDeductible;
        body.recipient = form.recipient || null;
      } else {
        body.payer = form.payer || null;
      }
      if (form.receiptFile !== null) {
        body.receiptFile = form.receiptFile;
        body.receiptName = form.receiptName || null;
      }
      const res = await fetch("/api/v1/financial/bookings", {
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
      toast.success("Buchung gespeichert");
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
          <DialogTitle>Buchung erfassen</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Kategorie</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  >
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
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
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none pb-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-input"
                      checked={form.isTaxDeductible}
                      onChange={(e) => setForm((f) => ({ ...f, isTaxDeductible: e.target.checked }))}
                    />
                    Steuerlich absetzbar
                  </label>
                </div>
              </div>
            </>
          ) : (
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
            </div>
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

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Beleg / Rechnung (Bild oder PDF)</label>
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
