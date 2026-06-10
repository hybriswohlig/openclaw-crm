// apps/web/src/components/GenerateDocumentDialog.tsx
//
// Modal that collects pricing fields the deal doesn't contain (Stundensatz vs.
// Pauschale, helpers, hours, deposit, discount) and kicks off the
// rechnungen-und-auftragsbestaetigungen skill via the global background job
// center. The dialog closes as soon as the job is started; progress and the
// finished PDF surface as a popup in the bottom-right tray, so the user can
// keep working anywhere in the app. Attaching the PDF to the deal happens in
// the tray too (store-as-document), independent of this dialog's lifetime.
//
// Inputs come from the deal page — pass `dealData` already loaded by the
// surrounding page. The dialog does NOT re-fetch the deal.
"use client";

import { useEffect, useState } from "react";
import { useBackgroundJobs } from "@/components/background-jobs";

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
  // Double-click guard + inline error for START failures (validation etc.).
  // Once the job is started, the dialog closes and the global tray takes over.
  const [submitting, setSubmitting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const { startDocumentJob } = useBackgroundJobs();

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
    if (submitting) return;
    setSubmitting(true);
    setStartError(null);

    try {
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

      const kundeName = [deal.kunde.vorname, deal.kunde.nachname]
        .filter(Boolean)
        .join(" ");
      await startDocumentJob({
        skill: "rechnungen-und-auftragsbestaetigungen",
        params: {
          firma: deal.firma,
          document_type: documentType,
          kunde: deal.kunde,
          auftrag: deal.auftrag,
          preise: buildPreise(),
          _deal_record_id: deal.dealRecordId,
          _image_attachment_ids: imageIds,
        },
        dealRecordId: deal.dealRecordId,
        label: kundeName || "Lead",
        docType: documentType,
      });

      // Job is running in the background; the tray takes over from here.
      handleClose();
    } catch (e) {
      setStartError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    setStartError(null);
    onClose();
  }

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

          {startError && (
            <div className="rounded bg-red-50 p-3 text-sm text-red-900 dark:bg-red-900/20 dark:text-red-200">
              Start fehlgeschlagen: {startError}
            </div>
          )}

          <p className="text-xs text-gray-500">
            Das PDF wird im Hintergrund erstellt (normalerweise unter 30
            Sekunden). Sie können währenddessen weiterarbeiten; unten rechts
            erscheint eine Meldung, sobald es fertig ist und am Lead hängt.
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
              {submitting ? "Wird gestartet…" : "PDF erstellen"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── tiny field components ──────────────────────────────────────────────────

/**
 * Live mm:ss counter since mount. Honest feedback while a job runs.
 */
export function ElapsedTimer() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, "0");
  return (
    <span>
      {mm}:{ss} min
    </span>
  );
}

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
