"use client";

import { useRef, useState } from "react";
import { Camera, Receipt, Loader2, CheckCircle2, X } from "lucide-react";
import { uploadAndRegisterMedia } from "@/lib/portal-upload";

const CATEGORIES = [
  { value: "fuel", label: "Kraftstoff" },
  { value: "truck_rental", label: "LKW-Miete" },
  { value: "equipment", label: "Ausstattung" },
  { value: "toll", label: "Maut" },
  { value: "other", label: "Sonstiges" },
] as const;

type Status = "idle" | "uploading" | "saving" | "success" | "error";

export default function ExpenseCapture({
  workspaceId,
  dealRecordId,
}: {
  workspaceId: string;
  dealRecordId: string;
}) {
  const [openForm, setOpenForm] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<string>("fuel");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const busy = status === "uploading" || status === "saving";

  function resetForm() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    setAmount("");
    setCategory("fuel");
    setDescription("");
    setStatus("idle");
    setProgress(0);
    setError(null);
  }

  function closeForm() {
    resetForm();
    setOpenForm(false);
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (f) {
      setFile(f);
      setPreviewUrl(URL.createObjectURL(f));
    } else {
      setFile(null);
      setPreviewUrl(null);
    }
  }

  async function handleSave() {
    setError(null);
    if (!file) {
      setError("Bitte zuerst den Beleg fotografieren.");
      return;
    }
    const num = Number(amount.replace(",", "."));
    if (!num || num <= 0) {
      setError("Bitte einen gültigen Betrag eingeben.");
      return;
    }

    setStatus("uploading");
    setProgress(0);
    try {
      const { id } = await uploadAndRegisterMedia({
        file,
        fileName: file.name,
        workspaceId,
        dealRecordId,
        category: "receipt",
        caption: description || undefined,
        onProgress: (pct) => setProgress(pct),
      });

      setStatus("saving");
      const res = await fetch(`/api/v1/portal/deals/${dealRecordId}/expense`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: num,
          category,
          description: description || null,
          jobMediaId: id,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error ?? "Ausgabe konnte nicht gespeichert werden.");
      }
      setStatus("success");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    }
  }

  if (!openForm) {
    return (
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <button
          type="button"
          onClick={() => setOpenForm(true)}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 text-base font-medium text-foreground shadow-sm active:scale-[0.98]"
        >
          <Receipt className="h-5 w-5" aria-hidden="true" />
          <span>Beleg fotografieren + Ausgabe</span>
        </button>
      </section>
    );
  }

  if (status === "success") {
    return (
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <CheckCircle2 className="h-10 w-10 text-primary" aria-hidden="true" />
          <p className="text-base font-semibold">Ausgabe gespeichert</p>
          <p className="text-sm text-muted-foreground">Der Beleg wurde erfasst.</p>
          <button
            type="button"
            onClick={resetForm}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground shadow-sm active:scale-[0.98]"
          >
            <span>Weitere Ausgabe erfassen</span>
          </button>
          <button
            type="button"
            onClick={closeForm}
            className="text-sm font-medium text-muted-foreground"
          >
            Schließen
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Receipt className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 className="text-base font-semibold">Ausgabe erfassen</h2>
        </div>
        <button
          type="button"
          onClick={closeForm}
          aria-label="Abbrechen"
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground active:scale-[0.98]"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onPickFile}
            className="hidden"
          />
          {previewUrl ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="block w-full overflow-hidden rounded-xl border border-border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="Beleg-Vorschau" className="max-h-64 w-full object-contain bg-muted" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background px-4 py-6 text-base font-medium text-foreground active:scale-[0.98]"
            >
              <Camera className="h-5 w-5" aria-hidden="true" />
              <span>Beleg fotografieren</span>
            </button>
          )}
          {previewUrl && (
            <p className="mt-2 text-center text-sm text-muted-foreground">
              Zum Wechseln auf das Foto tippen
            </p>
          )}
        </div>

        <div>
          <label htmlFor="expense-amount" className="mb-1 block text-sm font-medium text-foreground">
            Betrag (EUR)
          </label>
          <input
            id="expense-amount"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0,00"
            className="min-h-12 w-full rounded-xl border border-border bg-background px-4 text-base text-foreground shadow-sm outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        <div>
          <label htmlFor="expense-category" className="mb-1 block text-sm font-medium text-foreground">
            Kategorie
          </label>
          <select
            id="expense-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="min-h-12 w-full rounded-xl border border-border bg-background px-4 text-base text-foreground shadow-sm outline-none focus:ring-2 focus:ring-primary"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="expense-description" className="mb-1 block text-sm font-medium text-foreground">
            Beschreibung (optional)
          </label>
          <textarea
            id="expense-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="z.B. Tankstelle Aral"
            className="w-full rounded-xl border border-border bg-background px-4 py-3 text-base text-foreground shadow-sm outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {status === "uploading" && (
          <div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-1 text-center text-sm text-muted-foreground">Foto wird hochgeladen {progress}%</p>
          </div>
        )}

        {error && (
          <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={handleSave}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground shadow-sm active:scale-[0.98] disabled:opacity-60"
        >
          {busy ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              <span>{status === "uploading" ? "Lädt hoch" : "Speichert"}</span>
            </>
          ) : (
            <span>Ausgabe speichern</span>
          )}
        </button>
      </div>
    </section>
  );
}
