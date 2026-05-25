"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Loader2 } from "lucide-react";

interface LineItem {
  type: "helper" | "transporter" | "other";
  description: string;
  quantity: number;
  unitRate: string;
  sortOrder: number;
}

interface Quotation {
  id: string;
  fixedPrice: string | null;
  isVariable: boolean;
  notes: string | null;
  lineItems: LineItem[];
  /** Anzahlung in cents — when set, Stage 2 gates on operator-confirmed payment ≥ this. */
  depositRequiredCents?: number | null;
  /** Per-deal payment method shown to the customer. */
  paymentMethodPreference?: "bank_transfer" | "paypal" | "cash" | "card" | null;
  /** ISO date — offer valid until. */
  validUntil?: string | null;
  /** Customer-facing free-text description of what the offer covers. */
  summary?: string | null;
  /** Whether the customer portal should render the standard move inclusions. */
  showStandardInclusions?: boolean;
  /** Selected package slug from the operating company's catalogue. */
  selectedPackageSlug?: string | null;
}

interface OperatingCompanyPackage {
  slug: string;
  displayName: string;
  shortDescription: string | null;
  priceFromCents: number | null;
  priceFixedFlag: boolean;
  isRecommended: boolean;
}

interface OperatingCompanyPackagesPayload {
  operatingCompanyName: string | null;
  selectedSlug: string | null;
  packages: OperatingCompanyPackage[];
}

interface Props {
  recordId: string;
  quotation: Quotation | null;
  onSaved: () => void;
}

const LINE_TYPES: Array<{ value: LineItem["type"]; label: string }> = [
  { value: "helper", label: "Helper" },
  { value: "transporter", label: "Transporter" },
  { value: "other", label: "Other" },
];

function emptyLine(sortOrder: number): LineItem {
  return { type: "helper", description: "", quantity: 1, unitRate: "0", sortOrder };
}

export function QuotationCalculator({ recordId, quotation, onSaved }: Props) {
  const [isVariable, setIsVariable] = useState(quotation?.isVariable ?? false);
  const [fixedPrice, setFixedPrice] = useState(quotation?.fixedPrice ?? "");
  const [notes, setNotes] = useState(quotation?.notes ?? "");
  const [lineItems, setLineItems] = useState<LineItem[]>(
    quotation?.lineItems?.length ? quotation.lineItems : [emptyLine(0)]
  );
  const [depositEur, setDepositEur] = useState<string>(
    quotation?.depositRequiredCents != null ? (quotation.depositRequiredCents / 100).toFixed(2) : ""
  );
  const [paymentMethod, setPaymentMethod] = useState<NonNullable<Quotation["paymentMethodPreference"]>>(
    quotation?.paymentMethodPreference ?? "bank_transfer"
  );
  const [validUntil, setValidUntil] = useState<string>(quotation?.validUntil ?? "");
  const [summary, setSummary] = useState<string>(quotation?.summary ?? "");
  const [showStandardInclusions, setShowStandardInclusions] = useState<boolean>(
    quotation?.showStandardInclusions ?? true
  );
  const [selectedPackageSlug, setSelectedPackageSlug] = useState<string>(
    quotation?.selectedPackageSlug ?? ""
  );
  const [packagesPayload, setPackagesPayload] =
    useState<OperatingCompanyPackagesPayload | null>(null);
  const [saving, setSaving] = useState(false);

  // Load the operating company's packages once. The picker shows nothing
  // when the OC has no catalogue (or no OC is linked yet).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/deals/${recordId}/offer-packages`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.data) return;
        setPackagesPayload(j.data as OperatingCompanyPackagesPayload);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [recordId]);

  useEffect(() => {
    if (quotation) {
      setIsVariable(quotation.isVariable);
      setFixedPrice(quotation.fixedPrice ?? "");
      setNotes(quotation.notes ?? "");
      setLineItems(quotation.lineItems?.length ? quotation.lineItems : [emptyLine(0)]);
      setDepositEur(
        quotation.depositRequiredCents != null
          ? (quotation.depositRequiredCents / 100).toFixed(2)
          : ""
      );
      setPaymentMethod(quotation.paymentMethodPreference ?? "bank_transfer");
      setValidUntil(quotation.validUntil ?? "");
      setSummary(quotation.summary ?? "");
      setShowStandardInclusions(quotation.showStandardInclusions ?? true);
      setSelectedPackageSlug(quotation.selectedPackageSlug ?? "");
    }
  }, [quotation]);

  function onPackageSlugChange(slug: string) {
    // Packages are scope templates only; the price for every move is
    // entered separately on this calculator. Picking a package just stamps
    // the slug onto the quotation so the customer portal can highlight it.
    setSelectedPackageSlug(slug);
  }

  function addLine() {
    setLineItems([...lineItems, emptyLine(lineItems.length)]);
  }

  function removeLine(idx: number) {
    setLineItems(lineItems.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, field: string, value: unknown) {
    setLineItems(
      lineItems.map((li, i) => (i === idx ? { ...li, [field]: value } : li))
    );
  }

  const lineTotal = lineItems.reduce(
    (sum, li) => sum + li.quantity * Number(li.unitRate || 0),
    0
  );

  const grandTotal = isVariable ? lineTotal : Number(fixedPrice || 0);

  async function handleSave() {
    setSaving(true);
    try {
      const depositCents = depositEur.trim()
        ? Math.round(Number(depositEur) * 100)
        : null;
      await fetch(`/api/v1/deals/${recordId}/quotation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isVariable,
          fixedPrice: isVariable ? null : fixedPrice || null,
          notes: notes || null,
          lineItems: isVariable
            ? lineItems.map((li, i) => ({ ...li, sortOrder: i }))
            : [],
          depositRequiredCents:
            depositCents != null && Number.isFinite(depositCents) && depositCents > 0
              ? depositCents
              : null,
          paymentMethodPreference: paymentMethod,
          validUntil: validUntil || null,
          summary: summary.trim() || null,
          showStandardInclusions,
          selectedPackageSlug: selectedPackageSlug || null,
        }),
      });

      await fetch(`/api/v1/objects/deals/records/${recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          values: { value: { amount: grandTotal, currency: "EUR" } },
        }),
      });

      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h3 className="text-lg font-semibold mb-4">Quotation</h3>

      {/* Package picker — only appears when the operating company has packages
          defined. Picking a package writes the slug on the quotation and, if
          the price field is empty + the offer is fixed-price, auto-fills the
          starting price from the package. */}
      {packagesPayload && packagesPayload.packages.length > 0 && (
        <div className="mb-4 rounded-lg border border-dashed border-border bg-muted/30 p-3">
          <div className="flex items-baseline justify-between gap-3">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Paket
            </label>
            {packagesPayload.operatingCompanyName && (
              <span className="text-[10px] text-muted-foreground">
                {packagesPayload.operatingCompanyName}
              </span>
            )}
          </div>
          <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            <label
              className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                !selectedPackageSlug ? "border-foreground bg-background" : "border-input bg-background hover:bg-accent"
              }`}
            >
              <input
                type="radio"
                name="package"
                checked={!selectedPackageSlug}
                onChange={() => onPackageSlugChange("")}
                className="h-3.5 w-3.5"
              />
              <span className="text-xs text-muted-foreground">Kein Paket</span>
            </label>
            {packagesPayload.packages.map((p) => {
              const selected = selectedPackageSlug === p.slug;
              return (
                <label
                  key={p.slug}
                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${
                    selected
                      ? "border-foreground bg-background"
                      : "border-input bg-background hover:bg-accent"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="package"
                      checked={selected}
                      onChange={() => onPackageSlugChange(p.slug)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="font-medium">{p.displayName}</span>
                    {p.isRecommended && (
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                        Beliebt
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Sichtbar im Kunden-Portal. Preis wird unten pro Auftrag eingegeben.
          </p>
        </div>
      )}

      {/* Mode toggle */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setIsVariable(false)}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            !isVariable
              ? "bg-foreground text-background"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          Fixed Price
        </button>
        <button
          onClick={() => setIsVariable(true)}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            isVariable
              ? "bg-foreground text-background"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          Variable (Calculator)
        </button>
      </div>

      {!isVariable ? (
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Fixed Price (EUR)</label>
            <input
              type="number"
              step="0.01"
              value={fixedPrice}
              onChange={(e) => setFixedPrice(e.target.value)}
              className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder="0.00"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Line items header */}
          <div className="grid grid-cols-[140px_1fr_80px_120px_80px_32px] gap-2 text-xs font-medium text-muted-foreground">
            <span>Type</span>
            <span>Description</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Rate (EUR)</span>
            <span className="text-right">Subtotal</span>
            <span />
          </div>

          {lineItems.map((li, idx) => (
            <div key={idx} className="grid grid-cols-[140px_1fr_80px_120px_80px_32px] gap-2 items-center">
              <select
                value={li.type}
                onChange={(e) => updateLine(idx, "type", e.target.value)}
                className="rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none"
              >
                {LINE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={li.description}
                onChange={(e) => updateLine(idx, "description", e.target.value)}
                placeholder="Description"
                className="rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none"
              />
              <input
                type="number"
                min={1}
                value={li.quantity}
                onChange={(e) => updateLine(idx, "quantity", parseInt(e.target.value) || 1)}
                className="rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none text-right"
              />
              <input
                type="number"
                step="0.01"
                value={li.unitRate}
                onChange={(e) => updateLine(idx, "unitRate", e.target.value)}
                className="rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none text-right"
              />
              <span className="text-sm text-right font-medium">
                {(li.quantity * Number(li.unitRate || 0)).toLocaleString("de-DE", {
                  style: "currency",
                  currency: "EUR",
                })}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => removeLine(idx)}
                disabled={lineItems.length === 1}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}

          <Button variant="outline" size="sm" onClick={addLine}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add Line
          </Button>
        </div>
      )}

      {/* Beschreibung — what the customer sees as the offer summary */}
      <div className="mt-4">
        <label className="text-sm font-medium">Beschreibung des Angebots (Kunde sieht das)</label>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={3}
          className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring resize-none"
          placeholder="z. B. Transport einer Waschmaschine von Wildberg nach Stuttgart, inkl. einem Helfer und Transporter."
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Wird oben im Kunden-Portal als „Was umfasst der Auftrag" angezeigt.
          Leer lassen, wenn die Eckdaten und Leistungsumfang ausreichen.
        </p>
      </div>

      {/* Standard-Umzugsleistungen toggle */}
      <div className="mt-3">
        <label className="flex cursor-pointer items-start gap-2 rounded-md border border-input bg-background p-3 text-sm">
          <input
            type="checkbox"
            checked={showStandardInclusions}
            onChange={(e) => setShowStandardInclusions(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            Standard-Umzugsleistungen im Kunden-Portal anzeigen
            <span className="ml-1 text-[11px] text-muted-foreground">
              (Transportversicherung, Decken, Werkzeug, An- und Abladen + Auftrags-Checkboxen)
            </span>
            <span className="mt-1 block text-[11px] text-muted-foreground">
              Für Komplettumzüge aktiviert lassen. Für Einzeltransporte (Waschmaschine, Klavier-only, …) deaktivieren.
            </span>
          </span>
        </label>
      </div>

      {/* Notes */}
      <div className="mt-4">
        <label className="text-sm font-medium">Interne Notizen</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring resize-none"
          placeholder="Nur intern sichtbar..."
        />
      </div>

      {/* Kunden-Portal: Anzahlung, Zahlungsweg, Gültigkeit */}
      <div className="mt-5 grid grid-cols-1 gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-4 sm:grid-cols-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Anzahlung (EUR, optional)
          </label>
          <input
            type="number"
            step="0.01"
            value={depositEur}
            onChange={(e) => setDepositEur(e.target.value)}
            placeholder="z. B. 500"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Wenn gesetzt: Auftragsbestätigung wird im Kunden-Portal erst nach
            Zahlungseingang freigeschaltet.
          </p>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Zahlungsweg
          </label>
          <select
            value={paymentMethod}
            onChange={(e) =>
              setPaymentMethod(
                e.target.value as NonNullable<Quotation["paymentMethodPreference"]>
              )
            }
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="bank_transfer">Überweisung (Girocode QR)</option>
            <option value="paypal">PayPal</option>
            <option value="cash">Bar bei Übergabe</option>
            <option value="card">Karte</option>
          </select>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Wird dem Kunden im Status-Link entsprechend angezeigt.
          </p>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Angebot gültig bis
          </label>
          <input
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Total + Save */}
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
        <div className="text-lg font-semibold">
          Total:{" "}
          {grandTotal.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Save Quotation
        </Button>
      </div>
    </div>
  );
}
