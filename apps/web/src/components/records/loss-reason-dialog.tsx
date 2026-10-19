"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LOSS_REASON_OPTIONS } from "@/lib/deal-source";

export function LossReasonDialog({
  open,
  options,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  options: { id: string; title: string }[];
  onCancel: () => void;
  onConfirm: (reasonId: string, note: string) => Promise<void>;
}) {
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const reasonTitle = options.find((option) => option.id === reasonId)?.title ?? "";
  const sonstiges = reasonTitle.toLowerCase() === "sonstiges";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!reasonId) {
      setError("Bitte einen Verlustgrund wählen.");
      return;
    }
    if (sonstiges && !note.trim()) {
      setError("Bei Sonstiges ist ein Freitext Pflicht.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onConfirm(reasonId, note.trim());
      setReasonId("");
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Verlustgrund</DialogTitle>
          <DialogDescription>
            Ein Lead auf Verloren braucht einen Grund
            {options.length === 0 ? ` (${LOSS_REASON_OPTIONS.join(", ")})` : ""}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="space-y-3">
          <select
            aria-label="Verlustgrund"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            value={reasonId}
            onChange={(event) => setReasonId(event.target.value)}
            required
          >
            <option value="">Auswählen...</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.title}
              </option>
            ))}
          </select>
          <textarea
            aria-label="Verlustgrund Freitext"
            className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
            placeholder={sonstiges ? "Freitext (Pflicht bei Sonstiges)" : "Freitext (optional)"}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            required={sonstiges}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Speichert..." : "Als verloren markieren"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
