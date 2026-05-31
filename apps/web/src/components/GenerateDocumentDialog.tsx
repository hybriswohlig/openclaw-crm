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
/**
 * How the customer pays the Anzahlung. "bar" is collected on-site by the
 * crew; "bank_transfer" / "paypal" are routed through the customer portal's
 * payment section (girocode QR for the bank case, paypal.me URL for PayPal).
 */
export type AnzahlungMethod = "bar" | "bank_transfer" | "paypal";

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

interface PauschalePosition {
  titel: string;
  betrag: number;
}

/**
 * Optional prefill from the Auftrags-Tab Kalkulator. When passed, the dialog
 * opens with these values pre-populated so the user only has to click "PDF
 * erstellen". The user can still tweak fields before generating.
 */
export interface PrefilledPreise {
  modell?: Preismodell;
  helferAnzahl?: number;
  stundenGeschaetzt?: number;
  helferRate?: number;
  transporterRate?: number;
  mindestStunden?: number;
  pauschalePositionen?: PauschalePosition[];
  pauschaleBetragCeylan?: number;
  anzahlungBar?: number;
  anzahlungMethod?: AnzahlungMethod;
  stammkundenrabatt?: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  documentType: DocumentType;
  deal: DealData;
  prefill?: PrefilledPreise;
}

export function GenerateDocumentDialog({
  open,
  onClose,
  documentType,
  deal,
  prefill,
}: Props) {
  const isKottke = deal.firma === "kottke";
  const [modell, setModell] = useState<Preismodell>(
    prefill?.modell ?? (isKottke ? "stundensatz" : "pauschale")
  );
  const [helferAnzahl, setHelferAnzahl] = useState(prefill?.helferAnzahl ?? 3);
  const [stundenGeschaetzt, setStundenGeschaetzt] = useState(
    prefill?.stundenGeschaetzt ?? 4
  );
  const [helferRate, setHelferRate] = useState(prefill?.helferRate ?? 35);
  const [transporterRate, setTransporterRate] = useState(
    prefill?.transporterRate ?? 25
  );
  const [mindestStunden, setMindestStunden] = useState(prefill?.mindestStunden ?? 3);
  const [pauschalePositionen, setPauschalePositionen] = useState<PauschalePosition[]>(
    prefill?.pauschalePositionen && prefill.pauschalePositionen.length > 0
      ? prefill.pauschalePositionen
      : [{ titel: "Möbeltransport", betrag: 0 }]
  );
  const [pauschaleBetragCeylan, setPauschaleBetragCeylan] = useState(
    prefill?.pauschaleBetragCeylan ?? 0
  );
  // Anzahlung amount + method. Method drives both the AB PDF wording (via
  // the skill payload) and how the customer portal renders the Anzahlung
  // instructions on Stage 1 (via quotations.payment_method_preference).
  const [anzahlungBetrag, setAnzahlungBetrag] = useState(prefill?.anzahlungBar ?? 0);
  const [anzahlungMethod, setAnzahlungMethod] = useState<AnzahlungMethod>(
    prefill?.anzahlungMethod ?? "bar"
  );
  const [stammkundenrabatt, setStammkundenrabatt] = useState(
    prefill?.stammkundenrabatt ?? false
  );
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
    // Anzahlung block forwarded to every preismodell. anzahlung_bar_eur is
    // kept populated only when method=bar so the skill's existing branch
    // (which renders the cash-collection line on the AB PDF) still works.
    // anzahlung_zahlungsweg + anzahlung_betrag_eur are the new generalised
    // fields the skill can branch on for "Überweisung" / "PayPal" wording.
    const anzahlungBlock = {
      anzahlung_betrag_eur: anzahlungBetrag || 0,
      anzahlung_zahlungsweg: anzahlungMethod,
      anzahlung_bar_eur: anzahlungMethod === "bar" ? (anzahlungBetrag || 0) : 0,
    };

    if (!isKottke) {
      return {
        modell: "pauschale" as const,
        pauschale_betrag: pauschaleBetragCeylan,
        ...anzahlungBlock,
        stammkundenrabatt,
      };
    }
    if (modell === "stundensatz") {
      return {
        modell: "stundensatz" as const,
        helfer_anzahl: helferAnzahl,
        stunden_geschaetzt: stundenGeschaetzt,
        stundensatz_helfer_eur: helferRate,
        stundensatz_transporter_eur: transporterRate,
        mindest_stunden: mindestStunden,
        ...anzahlungBlock,
      };
    }
    return {
      modell: "pauschale" as const,
      pauschale_positionen: pauschalePositionen.filter((p) => p.titel && p.betrag > 0),
      ...anzahlungBlock,
    };
  }

  async function handleGenerate() {
    setStoreError(null);
    setStoredDocId(null);
    setDueDateSet(null);
    autoStoreFiredFor.current = null;

    // Persist the Anzahlung choice on the quotation BEFORE the skill runs,
    // so that as soon as the customer opens the portal Stage 1 they see the
    // right payment instructions (girocode for bank, paypal.me URL for
    // PayPal, no payment block for cash). Best-effort: failure here doesn't
    // block PDF generation.
    if (documentType === "AB" && anzahlungBetrag > 0) {
      try {
        await fetch(
          `/api/v1/deals/${deal.dealRecordId}/quotation/anzahlung`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              depositRequiredCents: Math.round(anzahlungBetrag * 100),
              paymentMethodPreference:
                anzahlungMethod === "bar" ? "cash" : anzahlungMethod,
            }),
          }
        );
      } catch {
        // Ignore — the PDF is the primary artefact, the portal sync can be
        // retried by re-opening the dialog.
      }
    }

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

            {/* ── Anzahlung block ──────────────────────────────────────── */}
            <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="Anzahlung (€)"
                  value={anzahlungBetrag}
                  onChange={setAnzahlungBetrag}
                  step={10}
                />
                {!isKottke && (
                  <label className="flex items-center gap-2 self-end pb-1 text-sm">
                    <input
                      type="checkbox"
                      checked={stammkundenrabatt}
                      onChange={(e) =>
                        setStammkundenrabatt(e.target.checked)
                      }
                    />
                    Stammkundenrabatt (3% Skonto)
                  </label>
                )}
              </div>

              {anzahlungBetrag > 0 && (
                <fieldset className="mt-3">
                  <legend className="text-xs uppercase tracking-wide text-gray-500">
                    Zahlungsweg für die Anzahlung
                  </legend>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <AnzahlungRadio
                      label="Bar"
                      hint="Crew kassiert vor Ort"
                      checked={anzahlungMethod === "bar"}
                      onChange={() => setAnzahlungMethod("bar")}
                    />
                    <AnzahlungRadio
                      label="Überweisung"
                      hint="Kunde sieht IBAN + Girocode"
                      checked={anzahlungMethod === "bank_transfer"}
                      onChange={() => setAnzahlungMethod("bank_transfer")}
                    />
                    <AnzahlungRadio
                      label="PayPal"
                      hint="paypal.me-Link"
                      checked={anzahlungMethod === "paypal"}
                      onChange={() => setAnzahlungMethod("paypal")}
                    />
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
                    {anzahlungMethod === "bar"
                      ? "Wird auf der AB als Barzahlung am Umzugstag vermerkt."
                      : anzahlungMethod === "bank_transfer"
                        ? "Der Kunde sieht im Status-Portal sofort IBAN, BIC und einen Girocode-QR zur Überweisung."
                        : "Der Kunde sieht im Status-Portal einen paypal.me-Link mit dem Betrag vorausgefüllt."}
                  </p>
                </fieldset>
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

function AnzahlungRadio({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-pressed={checked}
      className={
        "flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left text-xs transition " +
        (checked
          ? "border-blue-500 bg-blue-50 text-blue-900 dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-100"
          : "border-gray-300 bg-white text-gray-700 hover:border-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200")
      }
    >
      <span className="font-medium">{label}</span>
      <span className="text-[10px] text-gray-500 dark:text-gray-400">
        {hint}
      </span>
    </button>
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
