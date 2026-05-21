// apps/web/src/components/GenerateWorkerInstructionsDialog.tsx
//
// Modal that fires the "auftragsanweisung" skill (worker-facing PDF, no
// prices). Pulls everything from the Lead + Auftrag context — the only thing
// the user can edit is a free-text note that gets appended to the PDF.
//
// Flow:
//   1) On open: fetch Street View images for Abhol/Ziel address (best-effort)
//   2) Optionally: user adds a one-line note for the crew
//   3) "Anweisung erstellen" → /api/tools/run + poll + auto-store as
//      worker_instructions document on the Lead
"use client";

import { useEffect, useRef, useState } from "react";
import { useToolJob } from "@/hooks/useToolJob";
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
  const [storeError, setStoreError] = useState<string | null>(null);
  const [storedDocId, setStoredDocId] = useState<string | null>(null);
  const [storing, setStoring] = useState(false);
  const autoStoreFiredFor = useRef<string | null>(null);

  const { start, status, jobId, error, result, reset } = useToolJob();

  // Auto-store the PDF on the Lead as soon as the job is done.
  useEffect(() => {
    if (status !== "done" || !jobId) return;
    if (autoStoreFiredFor.current === jobId) return;
    autoStoreFiredFor.current = jobId;
    (async () => {
      setStoring(true);
      setStoreError(null);
      try {
        const resp = await fetch(`/api/tools/jobs/${jobId}/store-as-document`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dealRecordId: ctx.dealRecordId,
            documentType: "worker_instructions",
          }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data?.error || `upload ${resp.status}`);
        setStoredDocId(data.document?.id ?? null);
      } catch (e) {
        setStoreError((e as Error).message);
      } finally {
        setStoring(false);
      }
    })();
  }, [status, jobId, ctx.dealRecordId]);

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
    setStoreError(null);
    setStoredDocId(null);
    autoStoreFiredFor.current = null;

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

    await start("auftragsanweisung", merged);
  }

  function handleClose() {
    reset();
    setStoredDocId(null);
    setStoreError(null);
    setCrewNote("");
    autoStoreFiredFor.current = null;
    onClose();
  }

  const isRunning = status === "starting" || status === "queued" || status === "running";

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

        {status === "idle" && (
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

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={handleClose} className="rounded border px-4 py-2 text-sm">
                Abbrechen
              </button>
              <button
                onClick={handleGenerate}
                className="rounded bg-blue-600 px-4 py-2 text-sm text-white"
              >
                Anweisung erstellen
              </button>
            </div>
          </div>
        )}

        {isRunning && (
          <div className="py-8 text-center text-sm text-gray-600">
            <div className="mb-2">⏳ Erstelle Auftragsanweisung… (typisch ca. 60 Sekunden)</div>
            <div className="text-xs text-gray-400">Status: {status}</div>
          </div>
        )}

        {status === "done" && jobId && (
          <div className="space-y-4">
            <div className="rounded bg-green-50 p-3 text-sm text-green-900 dark:bg-green-900/20 dark:text-green-200">
              ✓ {result?.result_filename} erstellt
            </div>
            <div className="flex items-center gap-2">
              <a
                href={`/api/tools/jobs/${jobId}/result`}
                target="_blank"
                rel="noreferrer"
                className="rounded border px-4 py-2 text-sm"
              >
                PDF öffnen
              </a>
              {storing && <span className="text-sm text-gray-500">Speichere im Lead…</span>}
              {!storing && storedDocId && (
                <span className="rounded bg-green-100 px-4 py-2 text-sm text-green-900">
                  ✓ Im Finanzen-Tab angehängt
                </span>
              )}
            </div>
            {storeError && <p className="text-sm text-red-600">{storeError}</p>}
            <div className="flex justify-end pt-2">
              <button onClick={handleClose} className="rounded border px-4 py-2 text-sm">
                Schließen
              </button>
            </div>
          </div>
        )}

        {status === "error" && (
          <div className="space-y-3">
            <div className="rounded bg-red-50 p-3 text-sm text-red-900 dark:bg-red-900/20 dark:text-red-200">
              Fehler: {error}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={handleClose} className="rounded border px-4 py-2 text-sm">
                Schließen
              </button>
              <button onClick={() => reset()} className="rounded bg-blue-600 px-4 py-2 text-sm text-white">
                Nochmal
              </button>
            </div>
          </div>
        )}
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
