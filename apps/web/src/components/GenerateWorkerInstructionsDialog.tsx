// apps/web/src/components/GenerateWorkerInstructionsDialog.tsx
//
// Modal that fires the "auftragsanweisung" skill (worker-facing PDF, no
// prices) via the global background job center. The dialog closes as soon as
// the job is started; progress and the finished PDF surface as a popup in
// the bottom-right tray, and the PDF is attached to the Lead from there.
//
// Flow:
//   1) On open: user optionally adds a one-line note for the crew
//   2) "Anweisung erstellen" → fetch Street View images (best-effort) →
//      start background job → dialog closes, tray takes over
"use client";

import { useState } from "react";
import { useBackgroundJobs } from "@/components/background-jobs";
import type { Firma } from "@/components/GenerateDocumentDialog";

export interface AnweisungContext {
  dealRecordId: string;
  firma: Firma;
  kunde: { vorname?: string; nachname: string; telefon?: string; email?: string };
  auftrag: {
    datum?: string;
    zeit_von?: string;
    zeit_bis?: string;
    strecke_von?: string;
    strecke_nach?: string;
    adresse_von?: string;
    adresse_nach?: string;
    stockwerk_von?: number | null;
    zugang_von?: string | null;
    laufweg_von_m?: number | null;
    stockwerk_nach?: number | null;
    zugang_nach?: string | null;
    laufweg_nach_m?: number | null;
    halteverbot?: boolean | null;
    volumen?: string | null;
    transporter?: string | null;
    helfer_anzahl?: number | null;
    klavier_transport?: boolean | null;
    demontage?: boolean | null;
    einpackservice?: boolean | null;
    entsorgung?: boolean | null;
    einlagerung?: boolean | null;
    ausstattung?: string[];
    kontakte?: {
      abholung_name?: string | null;
      abholung_telefon?: string | null;
      ziel_name?: string | null;
      ziel_telefon?: string | null;
    };
    checkliste?: { label: string; done: boolean }[];
    sonderwuensche?: string | null;
    notizen?: string | null;
  };
}

interface Props {
  open: boolean;
  onClose: () => void;
  ctx: AnweisungContext;
}

export function GenerateWorkerInstructionsDialog({ open, onClose, ctx }: Props) {
  const [crewNote, setCrewNote] = useState("");
  // Double-click guard + inline error for START failures. Once running, the
  // global tray owns progress, completion popup, and the auto-attach.
  const [submitting, setSubmitting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const { startDocumentJob } = useBackgroundJobs();

  if (!open) return null;

  async function fetchStreetView(address: string, filename: string) {
    try {
      const resp = await fetch(
        `/api/v1/maps/streetview?address=${encodeURIComponent(address)}&width=640&height=400`
      );
      if (resp.status === 204 || !resp.ok) return null;
      const blob = await resp.blob();
      const base64 = await blobToBase64(blob);
      return { filename, mime: blob.type || "image/jpeg", base64 };
    } catch {
      return null;
    }
  }

  async function handleGenerate() {
    if (submitting) return;
    setSubmitting(true);
    setStartError(null);
    try {
      // Fetch Street View images for both endpoints in parallel.
      const [imgVon, imgNach] = await Promise.all([
        ctx.auftrag.adresse_von
          ? fetchStreetView(ctx.auftrag.adresse_von, "streetview-von.jpg")
          : Promise.resolve(null),
        ctx.auftrag.adresse_nach
          ? fetchStreetView(ctx.auftrag.adresse_nach, "streetview-nach.jpg")
          : Promise.resolve(null),
      ]);
      const images = [imgVon, imgNach].filter(
        (i): i is { filename: string; mime: string; base64: string } => !!i
      );

      const merged = {
        firma: ctx.firma,
        kunde: ctx.kunde,
        auftrag: {
          ...ctx.auftrag,
          notizen: [ctx.auftrag.notizen, crewNote].filter(Boolean).join("\n\n") || undefined,
        },
        _deal_record_id: ctx.dealRecordId,
      } as Record<string, unknown>;
      if (images.length > 0) merged._images = images;

      const kundeName = [ctx.kunde.vorname, ctx.kunde.nachname]
        .filter(Boolean)
        .join(" ");
      await startDocumentJob({
        skill: "auftragsanweisung",
        params: merged,
        dealRecordId: ctx.dealRecordId,
        label: kundeName || "Lead",
        docType: "AW",
      });

      handleClose();
    } catch (e) {
      setStartError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    setStartError(null);
    setCrewNote("");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xl rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">Auftragsanweisung erstellen</h2>
            <p className="text-sm text-gray-500">
              Interne Crew-Unterlage · {ctx.firma === "kottke" ? "Kottke Dienstleistungen" : "Ceylan Umzüge"} ·{" "}
              {ctx.kunde.vorname} {ctx.kunde.nachname}
            </p>
          </div>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded bg-blue-50 p-3 text-xs text-blue-900 dark:bg-blue-900/20 dark:text-blue-200">
            Die Anweisung wird automatisch aus dem Lead + Auftrag zusammengestellt. Street-View-Bilder
            der Adressen werden mit angehängt, sofern verfügbar. Keine Preise im Dokument.
          </div>

          <label className="block text-sm">
            <span className="block text-gray-600 mb-1">Notiz für die Crew (optional)</span>
            <textarea
              value={crewNote}
              onChange={(e) => setCrewNote(e.target.value)}
              placeholder="z. B. „Schlüssel beim Nachbarn 2. OG, Schmidt"
              rows={3}
              className="w-full rounded border px-2 py-1.5 text-sm"
            />
          </label>

          {startError && (
            <div className="rounded bg-red-50 p-3 text-sm text-red-900 dark:bg-red-900/20 dark:text-red-200">
              Start fehlgeschlagen: {startError}
            </div>
          )}

          <p className="text-xs text-gray-500">
            Das PDF wird im Hintergrund erstellt. Sie können weiterarbeiten;
            unten rechts erscheint eine Meldung, sobald es fertig ist.
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={handleClose} className="rounded border px-4 py-2 text-sm">
              Abbrechen
            </button>
            <button
              onClick={handleGenerate}
              disabled={submitting}
              className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Wird gestartet…" : "Anweisung erstellen"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") return reject(new Error("FileReader returned non-string"));
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.readAsDataURL(blob);
  });
}
