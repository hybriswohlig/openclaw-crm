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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (quotation) {
      setIsVariable(quotation.isVariable);
      setFixedPrice(quotation.fixedPrice ?? "");
      setNotes(quotation.notes ?? "");
      setLineItems(quotation.lineItems?.length ? quotation.lineItems : [emptyLine(0)]);
    }
  }, [quotation]);

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

      {/* Notes */}
      <div className="mt-4">
        <label className="text-sm font-medium">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring resize-none"
          placeholder="Internal notes about this quotation..."
        />
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
