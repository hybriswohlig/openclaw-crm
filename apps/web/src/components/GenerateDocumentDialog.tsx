// apps/web/src/components/GenerateDocumentDialog.tsx
//
// Modal that collects pricing fields the deal doesn't contain (Stundensatz vs.
// Pauschale, helpers, hours, deposit, discount), kicks off the
// rechnungen-und-auftragsbestaetigungen skill via /api/tools/run, shows a
// spinner while polling, then offers "Im Deal speichern" + "PDF öffnen".
//
// Inputs come from the deal page — pass `dealData` already loaded by the
// surrounding page. The dialog does NOT re-fetch the deal.
"use client";

import { useEffect, useRef, useState } from "react";
import { useToolJob } from "@/hooks/useToolJob";

export type Firma = "kottke" | "ceylan";
export type DocumentType = "AB" | "RE";
export type Preismodell = "stundensatz" | "pauschale";

export interface DealData {
  dealRecordId: string;
  firma: Firma;
  kunde: {
    vorname?: string;
    nachname: string;
    adresse?: string;
    email?: string;
  };
  auftrag: {
    strecke_von?: string;
    strecke_nach?: string;
    datum?: string; // YYYY-MM-DD
    volumen?: string;
    besonderheiten?: string;
  };
}

interface Props {
  open: boolean;
  onClose: () => void;
  documentType: DocumentType;
  deal: DealData;
}

interface PauschalePosition {
  titel: string;
  betrag: number;
}

export function GenerateDocumentDialog({
  open,
  onClose,
  documentType,
  deal,
}: Props) {
  const isKottke = deal.firma === "kottke";
  const [modell, setModell] = useState<Preismodell>(
    isKottke ? "stundensatz" : "pauschale"
  );
  const [helferAnzahl, setHelferAnzahl] = useState(3);
  const [stundenGeschaetzt, setStundenGeschaetzt] = useState(4);
  const [pauschalePositionen, setPauschalePositionen] = useState<PauschalePosition[]>([
    { titel: "Möbeltransport", betrag: 0 },
  ]);
  const [pauschaleBetragCeylan, setPauschaleBetragCeylan] = useState(0);
  const [anzahlungBar, setAnzahlungBar] = useState(0);
  const [stammkundenrabatt, setStammkundenrabatt] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [storedDocId, setStoredDocId] = useState<string | null>(null);
  const [storing, setStoring] = useState(false);
  const [dueDateSet, setDueDateSet] = useState<string | null>(null);
  // Guard so the auto-store effect only fires once per generated PDF, even
  // if React re-renders while the store request is in flight.
  const autoStoreFiredFor = useRef<string | null>(null);

  const { start, status, jobId, error, result, reset } = useToolJob();

  if (!open) return null;

  function buildPreise() {
    if (!isKottke) {
      return {
        modell: "pauschale" as const,
        pauschale_betrag: pauschaleBetragCeylan,
        anzahlung_bar_eur: anzahlungBar || 0,
        stammkundenrabatt,
      };
    }
    if (modell === "stundensatz") {
      return {
        modell: "stundensatz" as const,
        helfer_anzahl: helferAnzahl,
        stunden_geschaetzt: stundenGeschaetzt,
        stundensatz_helfer_eur: 35,
        stundensatz_transporter_eur: 25,
        mindest_stunden: 3,
        anzahlung_bar_eur: anzahlungBar || 0,
      };
    }
    return {
      modell: "pauschale" as const,
      pauschale_positionen: pauschalePositionen.filter((p) => p.titel && p.betrag > 0),
      anzahlung_bar_eur: anzahlungBar || 0,
    };
  }

  async function handleGenerate() {
    setStoreError(null);
    setStoredDocId(null);
    setDueDateSet(null);
    autoStoreFiredFor.current = null;

    // Forward image attachments from the Lead (apartment photos etc.) so the
    // headless skill can use them as visual context for volume / floors /
    // besonderheiten. Failures are non-fatal — generation still proceeds
    // without images.
    let imageIds: string[] = [];
    try {
      const res = await fetch(`/api/v1/deals/${deal.dealRecordId}/attachments`);
      if (res.ok) {
        const json = (await res.json()) as {
          data?: { id: string; mimeType: string }[];
        };
        imageIds = (json.data ?? [])
          .filter((a) => a.mimeType.startsWith("image/"))
          .slice(0, 8)
          .map((a) => a.id);
      }
    } catch {
      // ignore — skill runs without images
    }

    await start("rechnungen-und-auftragsbestaetigungen", {
      firma: deal.firma,
      document_type: documentType,
      kunde: deal.kunde,
      auftrag: deal.auftrag,
      preise: buildPreise(),
      _deal_record_id: deal.dealRecordId,
      _image_attachment_ids: imageIds,
    });
  }

  async function handleStore() {
    if (!jobId) return;
    setStoring(true);
    setStoreError(null);
    try {
      const resp = await fetch(`/api/tools/jobs/${jobId}/store-as-document`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealRecordId: deal.dealRecordId }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || `upload ${resp.status}`);
      setStoredDocId(data.document?.id ?? null);
      if (typeof data.rechnungFaelligAm === "string") {
        setDueDateSet(data.rechnungFaelligAm);
      }
    } catch (e) {
      setStoreError((e as Error).message);
    } finally {
      setStoring(false);
    }
  }

  // Auto-attach the PDF to the Lead's Finance tab as soon as the job is done.
  // The ref guards against duplicate POSTs on re-renders.
  useEffect(() => {
    if (status !== "done" || !jobId) return;
    if (autoStoreFiredFor.current === jobId) return;
    autoStoreFiredFor.current = jobId;
    handleStore();
    // handleStore is intentionally not in deps — we want exactly one call per
    // completed jobId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, jobId]);

  function handleClose() {
    reset();
    setStoredDocId(null);
    setStoreError(null);
    setDueDateSet(null);
    autoStoreFiredFor.current = null;
    onClose();
  }

  const isRunning = status === "starting" || status === "queued" || status === "running";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">
              {documentType === "AB" ? "Auftragsbestätigung" : "Rechnung"} erstellen
            </h2>
            <p className="text-sm text-gray-500">
              {deal.firma === "kottke" ? "Kottke Dienstleistungen" : "Ceylan Umzüge"} ·{" "}
              {deal.kunde.vorname} {deal.kunde.nachname}
            </p>
          </div>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        {/* Preise-Form (only shown until job starts) */}
        {status === "idle" && (
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Preise</h3>

            {isKottke && (
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={modell === "stundensatz"}
                    onChange={() => setModell("stundensatz")}
                  />
                  Stundensatz
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={modell === "pauschale"}
                    onChange={() => setModell("pauschale")}
                  />
                  Pauschale
                </label>
              </div>
            )}

            {isKottke && modell === "stundensatz" && (
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="Helfer-Anzahl"
                  value={helferAnzahl}
                  onChange={setHelferAnzahl}
                />
                <NumberField
                  label="Stunden (geschätzt)"
                  value={stundenGeschaetzt}
                  onChange={setStundenGeschaetzt}
                  step={0.5}
                />
              </div>
            )}

            {isKottke && modell === "pauschale" && (
              <PauschalePositionsEditor
                value={pauschalePositionen}
                onChange={setPauschalePositionen}
              />
            )}

            {!isKottke && (
              <NumberField
                label="Pauschalbetrag (€)"
                value={pauschaleBetragCeylan}
                onChange={setPauschaleBetragCeylan}
                step={50}
              />
            )}

            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Anzahlung in bar (€)"
                value={anzahlungBar}
                onChange={setAnzahlungBar}
                step={10}
              />
              {!isKottke && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={stammkundenrabatt}
                    onChange={(e) => setStammkundenrabatt(e.target.checked)}
                  />
                  Stammkundenrabatt (3% Skonto)
                </label>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <button onClick={handleClose} className="rounded border px-4 py-2 text-sm">
                Abbrechen
              </button>
              <button
                onClick={handleGenerate}
                className="rounded bg-blue-600 px-4 py-2 text-sm text-white"
              >
                PDF erstellen
              </button>
            </div>
          </div>
        )}

        {/* Running */}
        {isRunning && (
          <div className="py-8 text-center text-sm text-gray-600">
            <div className="mb-2">⏳ Erstelle Dokument… (typisch ca. 90 Sekunden)</div>
            <div className="text-xs text-gray-400">Status: {status}</div>
          </div>
        )}

        {/* Done */}
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
              {storing && (
                <span className="text-sm text-gray-500">Speichere im Lead…</span>
              )}
              {!storing && storedDocId && (
                <span className="rounded bg-green-100 px-4 py-2 text-sm text-green-900">
                  ✓ Im Finanzen-Tab angehängt
                </span>
              )}
              {!storing && !storedDocId && storeError && (
                <button
                  onClick={handleStore}
                  className="rounded bg-blue-600 px-4 py-2 text-sm text-white"
                >
                  Erneut anhängen
                </button>
              )}
            </div>
            {dueDateSet && (
              <p className="text-sm text-gray-600">
                Fälligkeitsdatum gesetzt: <strong>{dueDateSet}</strong>
              </p>
            )}
            {storeError && <p className="text-sm text-red-600">{storeError}</p>}
            <div className="flex justify-end pt-2">
              <button onClick={handleClose} className="rounded border px-4 py-2 text-sm">
                Schließen
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div className="space-y-3">
            <div className="rounded bg-red-50 p-3 text-sm text-red-900 dark:bg-red-900/20 dark:text-red-200">
              Fehler: {error}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={handleClose} className="rounded border px-4 py-2 text-sm">
                Schließen
              </button>
              <button
                onClick={() => reset()}
                className="rounded bg-blue-600 px-4 py-2 text-sm text-white"
              >
                Nochmal
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── tiny field components ──────────────────────────────────────────────────

function NumberField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <label className="text-sm">
      <span className="block text-gray-600">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        step={step}
        className="mt-1 w-full rounded border px-2 py-1"
      />
    </label>
  );
}

function PauschalePositionsEditor({
  value,
  onChange,
}: {
  value: PauschalePosition[];
  onChange: (v: PauschalePosition[]) => void;
}) {
  function update(i: number, patch: Partial<PauschalePosition>) {
    onChange(value.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function add() {
    onChange([...value, { titel: "", betrag: 0 }]);
  }
  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }
  return (
    <div className="space-y-2">
      <div className="text-sm text-gray-600">Pauschale Positionen</div>
      {value.map((p, i) => (
        <div key={i} className="flex gap-2">
          <input
            type="text"
            value={p.titel}
            onChange={(e) => update(i, { titel: e.target.value })}
            placeholder="Titel"
            className="flex-1 rounded border px-2 py-1 text-sm"
          />
          <input
            type="number"
            value={p.betrag}
            onChange={(e) => update(i, { betrag: Number(e.target.value) })}
            placeholder="€"
            className="w-28 rounded border px-2 py-1 text-sm"
          />
          <button
            onClick={() => remove(i)}
            className="rounded border px-2 text-sm text-gray-500 hover:bg-gray-50"
            type="button"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className="text-sm text-blue-600 hover:underline"
        type="button"
      >
        + Position hinzufügen
      </button>
    </div>
  );
}
