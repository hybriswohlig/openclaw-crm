// apps/web/src/components/inbox/status-link-wizard.tsx
//
// Guided wizard that builds the customer status link from inside the inbox
// context panel. Walks the operator through:
//
//   1. Abrechnungsart: Fixbetrag oder stündliche Abrechnung
//   2. Fixbetrag → ein Angebot (ein Preis) ODER Pakete aus dem
//      offer_packages-Katalog der Firma (Preis pro Paket, gespeichert als
//      per-Deal package options). Stündlich → Positionen wie im Kostenrechner.
//   3. Kundenfotos (nur wenn der Deal inbound-Bilder hat): Auswahl fürs
//      Portal kuratieren, optional KI-Zusammenfassung als Vorschlag für die
//      Beschreibung (der Operator prüft und speichert immer selbst)
//   4. Beschreibung (Freitext, Kunde sieht das im Portal)
//   5. Speichern (quotation PUT mintet den Link automatisch) → Link anzeigen
//
// The Standard-Umzugsleistungen toggle is intentionally NOT part of this
// wizard; the existing quotation value is passed through unchanged.
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  ChevronDown,
  ChevronRight,
  Crown,
  Euro,
  Hourglass,
  Link2,
  Loader2,
  Package,
  Plus,
  Sparkles,
  Star,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { renderSnippet } from "@/components/inbox/customer-link-composer";

// ─── Types ───────────────────────────────────────────────────────────────────

interface LineItem {
  type: "helper" | "transporter" | "other";
  description: string;
  quantity: number;
  unitRate: string;
  sortOrder: number;
}

interface CataloguePackage {
  slug: string;
  displayName: string;
  shortDescription: string | null;
  targetSegment?: string | null;
  priceFromCents: number | null;
  includedItems: string[];
  isRecommended: boolean;
}

interface QuotationPayload {
  id: string;
  fixedPrice: string | null;
  isVariable: boolean;
  notes: string | null;
  lineItems: LineItem[];
  depositRequiredCents?: number | null;
  paymentMethodPreference?: "bank_transfer" | "paypal" | "cash" | "card" | null;
  validUntil?: string | null;
  summary?: string | null;
  showStandardInclusions?: boolean;
  selectedPackageSlug?: string | null;
}

interface PackagePriceRow {
  catalogueSlug: string;
  displayName: string;
  shortDescription: string | null;
  includedItems: string[];
  /** Ausdrücklich NICHT enthaltene Leistungen — Portal zeigt sie mit ✗. */
  excludedItems: string[];
  /** "Auf Wunsch zubuchbar" — Zusatzleistungen gegen Aufpreis (Portal: +). */
  addableItems: string[];
  priceEur: string;
  isRecommended: boolean;
}

/** Kalkulationsgrundlagen — gespiegelt zu CalculationAssumptions (Schema). */
interface AssumptionsDraft {
  anfahrtMinuten: string;
  anfahrtQuelle: "berechnet" | "manuell" | null;
  etageVon: string;
  etageBis: string;
  zugangVon: string;
  zugangBis: string;
  hinweis: string;
  inventarPositionen: number | null;
  inventarVolumenCbm: number | null;
}

interface PortalPhoto {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
  selected: boolean;
}

interface ScopeResult {
  summary: string;
  inventory: string[];
  hints: string[];
}

type Step = "abrechnung" | "angebotsart" | "preis" | "pakete" | "stunden" | "fotos" | "beschreibung" | "fertig";

const LINE_TYPES: Array<{ value: LineItem["type"]; label: string }> = [
  { value: "helper", label: "Helfer" },
  { value: "transporter", label: "Transporter" },
  { value: "other", label: "Sonstiges" },
];

/** Small visual identity per catalogue slug — the DB has no icon column. */
function packageIcon(slug: string) {
  if (/premium/i.test(slug)) return Crown;
  if (/komfort|comfort/i.test(slug)) return Star;
  if (/einzel|transport/i.test(slug)) return Truck;
  return Package;
}

function parseEur(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const eur = Number(cleaned);
  if (!Number.isFinite(eur) || eur < 0) return null;
  return Math.round(eur * 100);
}

function emptyLine(sortOrder: number): LineItem {
  return { type: "helper", description: "", quantity: 1, unitRate: "0", sortOrder };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function StatusLinkWizard({
  dealRecordId,
  firmaDisplayName,
  customerFirstName,
  onClose,
  onInsert,
  onFinished,
}: {
  dealRecordId: string;
  firmaDisplayName: string | null;
  customerFirstName: string | null;
  onClose: () => void;
  /** Insert the rendered customer message into the chat composer. */
  onInsert: (text: string) => void;
  /** Called after the quotation was saved so the panel can refresh. */
  onFinished: () => void;
}) {
  const [step, setStep] = useState<Step>("abrechnung");
  const [mode, setMode] = useState<"fix" | "stundensatz" | null>(null);
  const [offerKind, setOfferKind] = useState<"single" | "packages" | null>(null);

  // Loaded context
  const [quotation, setQuotation] = useState<QuotationPayload | null>(null);
  const [catalogue, setCatalogue] = useState<CataloguePackage[]>([]);
  const [loading, setLoading] = useState(true);

  // Fixbetrag single offer
  const [fixedPrice, setFixedPrice] = useState("");
  // Anzahlung (optional, drives the portal payment block)
  const [depositEur, setDepositEur] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"bank_transfer" | "paypal" | "cash" | "card">("bank_transfer");

  // Packages path
  const [packageRows, setPackageRows] = useState<PackagePriceRow[]>([]);
  const [assumptions, setAssumptions] = useState<AssumptionsDraft>({
    anfahrtMinuten: "",
    anfahrtQuelle: null,
    etageVon: "",
    etageBis: "",
    zugangVon: "",
    zugangBis: "",
    hinweis: "",
    inventarPositionen: null,
    inventarVolumenCbm: null,
  });
  const [assumptionsLoaded, setAssumptionsLoaded] = useState(false);

  // Annahmen lazy befüllen, wenn der Paket-Schritt erreicht wird: Anfahrt aus
  // der Zeitschätzung (falls berechnet), Inventarbasis aus der Item-Liste.
  useEffect(() => {
    if (step !== "pakete" || assumptionsLoaded) return;
    setAssumptionsLoaded(true);
    void (async () => {
      try {
        const [auftragRes, invRes] = await Promise.all([
          fetch(`/api/v1/deals/${dealRecordId}/auftrag`),
          fetch(`/api/v1/deals/${dealRecordId}/inventory`),
        ]);
        const patch: Partial<AssumptionsDraft> = {};
        if (auftragRes.ok) {
          const j = (await auftragRes.json()) as {
            data?: { auftrag?: { values?: Record<string, unknown> } | null };
          };
          const drive = Number(j.data?.auftrag?.values?.drive_minutes_total);
          if (Number.isFinite(drive) && drive > 0) {
            patch.anfahrtMinuten = String(Math.round(drive));
            patch.anfahrtQuelle = "berechnet";
          }
        }
        if (invRes.ok) {
          const j = (await invRes.json()) as {
            data?: Array<{ moveFlag: boolean; volumeCbmEstimate: string | null }>;
          };
          const moving = (j.data ?? []).filter((i) => i.moveFlag);
          if (moving.length > 0) {
            patch.inventarPositionen = moving.length;
            const vol = moving.reduce((s, i) => {
              const v = Number(i.volumeCbmEstimate);
              return Number.isFinite(v) ? s + v : s;
            }, 0);
            if (vol > 0) patch.inventarVolumenCbm = Math.round(vol * 10) / 10;
          }
        }
        if (Object.keys(patch).length > 0) {
          setAssumptions((prev) => ({ ...prev, ...patch }));
        }
      } catch {
        /* Annahmen bleiben manuell befüllbar */
      }
    })();
  }, [step, assumptionsLoaded, dealRecordId]);

  // Stündlich path
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { type: "helper", description: "Helfer", quantity: 2, unitRate: "35", sortOrder: 0 },
    { type: "transporter", description: "Transporter inkl. Fahrer", quantity: 1, unitRate: "25", sortOrder: 1 },
  ]);

  // Beschreibung
  const [summary, setSummary] = useState("");
  const [summaryFromAi, setSummaryFromAi] = useState(false);

  // Kundenfotos (Portal-Auswahl + KI-Zusammenfassung)
  const [photos, setPhotos] = useState<PortalPhoto[]>([]);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [aiPending, setAiPending] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<ScopeResult | null>(null);
  const [aiConfirm, setAiConfirm] = useState(false);

  // Finish
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Preload quotation + catalogue so every step opens prefilled.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [qRes, pRes, fRes] = await Promise.all([
          fetch(`/api/v1/deals/${dealRecordId}/quotation`),
          fetch(`/api/v1/deals/${dealRecordId}/offer-packages`),
          fetch(`/api/v1/deals/${dealRecordId}/portal-photos`).catch(() => null),
        ]);
        if (cancelled) return;
        if (qRes.ok) {
          const q = (await qRes.json())?.data as QuotationPayload | null;
          if (q) {
            setQuotation(q);
            setFixedPrice(q.fixedPrice ?? "");
            setSummary(q.summary ?? "");
            if (q.depositRequiredCents != null) {
              setDepositEur((q.depositRequiredCents / 100).toFixed(2).replace(".", ","));
            }
            if (q.paymentMethodPreference) setPaymentMethod(q.paymentMethodPreference);
            if (q.isVariable && q.lineItems?.length) setLineItems(q.lineItems);
          }
        }
        if (pRes.ok) {
          const data = (await pRes.json())?.data as
            | { packages?: CataloguePackage[] }
            | undefined;
          if (data?.packages) setCatalogue(data.packages);
        }
        if (fRes?.ok) {
          const data = (await fRes.json().catch(() => null))?.data as
            | { photos?: PortalPhoto[] }
            | undefined;
          if (data?.photos) {
            setPhotos(data.photos);
            setSelectedPhotoIds(
              data.photos.filter((p) => p.selected).map((p) => p.id)
            );
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dealRecordId]);

  // Seed package rows from the catalogue once it arrives.
  useEffect(() => {
    if (catalogue.length === 0) return;
    setPackageRows((prev) =>
      prev.length > 0
        ? prev
        : catalogue.map((c) => ({
            catalogueSlug: c.slug,
            displayName: c.displayName,
            shortDescription: c.shortDescription,
            includedItems: c.includedItems ?? [],
            excludedItems: [],
            addableItems: [],
            priceEur:
              c.priceFromCents != null
                ? (c.priceFromCents / 100).toFixed(2).replace(".", ",")
                : "",
            isRecommended: c.isRecommended,
          }))
    );
  }, [catalogue]);

  const lineTotal = useMemo(
    () => lineItems.reduce((s, li) => s + li.quantity * Number(li.unitRate || 0), 0),
    [lineItems]
  );

  const priceStep: Step =
    mode === "stundensatz" ? "stunden" : offerKind === "packages" ? "pakete" : "preis";

  const stepBack: Partial<Record<Step, Step>> = {
    angebotsart: "abrechnung",
    preis: "angebotsart",
    pakete: "angebotsart",
    stunden: "abrechnung",
    fotos: priceStep,
    beschreibung: photos.length > 0 ? "fotos" : priceStep,
  };

  function next(s: Step) {
    setSaveError(null);
    setStep(s);
  }

  const priceValid =
    mode === "stundensatz"
      ? lineItems.some((li) => Number(li.unitRate) > 0)
      : offerKind === "packages"
        ? packageRows.some((r) => parseEur(r.priceEur) != null && parseEur(r.priceEur)! > 0)
        : Number(fixedPrice) > 0;

  function togglePhoto(id: string) {
    setSelectedPhotoIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleAiAnalyze() {
    if (selectedPhotoIds.length === 0 || selectedPhotoIds.length > 6) return;
    setAiPending(true);
    setAiError(null);
    try {
      const res = await fetch(`/api/v1/deals/${dealRecordId}/scope-from-photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attachmentIds: selectedPhotoIds }),
      });
      const j = (await res.json().catch(() => null)) as
        | { data?: ScopeResult; error?: { code?: string } }
        | null;
      if (!res.ok || !j?.data) throw new Error(j?.error?.code ?? "AI_FAILED");
      setAiResult(j.data);
      if (summary.trim()) {
        // Vorhandene Beschreibung nie stillschweigend überschreiben.
        setAiConfirm(true);
      } else {
        setSummary(j.data.summary);
        setSummaryFromAi(true);
      }
    } catch {
      setAiError(
        "Die Analyse hat nicht geklappt. Bitte erneut versuchen oder die Beschreibung manuell verfassen."
      );
    } finally {
      setAiPending(false);
    }
  }

  function applyAiSummary(how: "replace" | "append") {
    if (!aiResult) return;
    setSummary((prev) =>
      how === "append" && prev.trim()
        ? `${prev.trimEnd()}\n\n${aiResult.summary}`
        : aiResult.summary
    );
    setSummaryFromAi(true);
    setAiConfirm(false);
  }

  async function handleFinish() {
    setSaving(true);
    setSaveError(null);
    try {
      const depositCents = depositEur.trim() ? parseEur(depositEur) : null;
      const isVariable = mode === "stundensatz";

      // Kuratierte Foto-Auswahl fürs Portal sichern. Fire-and-forget, damit
      // das Quotation-Save-Verhalten unverändert bleibt.
      if (photos.length > 0) {
        fetch(`/api/v1/deals/${dealRecordId}/portal-photos`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attachmentIds: selectedPhotoIds }),
        })
          .then((res) => {
            if (!res.ok) {
              toast.error("Foto-Auswahl konnte nicht gespeichert werden.");
            }
          })
          .catch(() => {
            toast.error("Foto-Auswahl konnte nicht gespeichert werden.");
          });
      }

      // Packages path: persist the per-deal options first so the portal
      // renders exactly these rows with the operator's prices.
      if (mode === "fix" && offerKind === "packages") {
        const options = packageRows
          .map((r) => ({
            catalogueSlug: r.catalogueSlug,
            displayName: r.displayName,
            shortDescription: r.shortDescription,
            priceCents: parseEur(r.priceEur),
            includedItems: r.includedItems,
            excludedItems: r.excludedItems,
            addableItems: r.addableItems,
            note: null,
            isRecommended: r.isRecommended,
          }))
          .filter((o) => o.priceCents != null && o.priceCents > 0);
        const optRes = await fetch(`/api/v1/deals/${dealRecordId}/package-options`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ options }),
        });
        if (!optRes.ok) {
          const j = await optRes.json().catch(() => ({}));
          throw new Error(j?.error?.message ?? "Pakete konnten nicht gespeichert werden.");
        }
      }

      // Quotation save — this also auto-mints the status link on the backend.
      const recommendedCents =
        offerKind === "packages"
          ? packageRows
              .filter((r) => parseEur(r.priceEur) != null)
              .sort((a, b) => Number(b.isRecommended) - Number(a.isRecommended))
              .map((r) => parseEur(r.priceEur)!)[0] ?? null
          : null;

      const qRes = await fetch(`/api/v1/deals/${dealRecordId}/quotation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isVariable,
          fixedPrice: isVariable
            ? null
            : offerKind === "packages"
              ? recommendedCents != null
                ? (recommendedCents / 100).toFixed(2)
                : null
              : fixedPrice || null,
          notes: quotation?.notes ?? null,
          lineItems: isVariable ? lineItems.map((li, i) => ({ ...li, sortOrder: i })) : [],
          depositRequiredCents:
            depositCents != null && depositCents > 0 ? depositCents : null,
          paymentMethodPreference: paymentMethod,
          validUntil: quotation?.validUntil ?? null,
          summary: summary.trim() || null,
          // Pass-through: this wizard never touches the inclusions toggle.
          showStandardInclusions: quotation?.showStandardInclusions ?? true,
          selectedPackageSlug: quotation?.selectedPackageSlug ?? null,
          // Kalkulationsgrundlagen — werden über loadKvaSnapshot in die
          // KVA-Bestätigung eingefroren (rechtlich dokumentierte Annahmen).
          calculationAssumptions: buildAssumptionsPayload(assumptions),
        }),
      });
      if (!qRes.ok) throw new Error("Kostenvoranschlag konnte nicht gespeichert werden.");

      // Mirror the calculator: keep the deal amount in sync.
      const amount =
        mode === "stundensatz"
          ? lineTotal
          : offerKind === "packages"
            ? recommendedCents != null
              ? recommendedCents / 100
              : 0
            : Number(fixedPrice || 0);
      if (amount > 0) {
        await fetch(`/api/v1/objects/deals/records/${dealRecordId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ values: { value: { amount, currency: "EUR" } } }),
        }).catch(() => {});
      }

      const linkRes = await fetch(`/api/v1/customer-link/${dealRecordId}`, {
        method: "POST",
      });
      if (linkRes.ok) {
        const j = (await linkRes.json()) as { data?: { url?: string | null } };
        setLinkUrl(j.data?.url ?? null);
      }
      onFinished();
      setStep("fertig");
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const insertMessage = linkUrl
    ? renderSnippet("kva_available", {
        url: linkUrl,
        firmaName: firmaDisplayName ?? "wir",
        customerFirstName,
        dealNumber: null,
      })
    : "";

  async function copyLink() {
    if (!linkUrl) return;
    try {
      await navigator.clipboard.writeText(linkUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border border-border bg-background shadow-xl">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          {stepBack[step] && step !== "fertig" && (
            <button
              onClick={() => next(stepBack[step]!)}
              className="-ml-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Zurück"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Link2 className="h-4 w-4" />
            Status-Link erstellen
          </div>
          <button
            onClick={onClose}
            className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Schließen"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Daten werden geladen…
            </div>
          ) : (
            <>
              {/* ── Step 1: Abrechnungsart ── */}
              {step === "abrechnung" && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Wie wird dieser Auftrag abgerechnet?
                  </p>
                  <ChoiceCard
                    icon={<Euro className="h-5 w-5" />}
                    title="Fixbetrag"
                    hint="Fester Preis, als ein Angebot oder als Paket-Auswahl (Basic / Komfort / Premium)."
                    selected={mode === "fix"}
                    onClick={() => {
                      setMode("fix");
                      next("angebotsart");
                    }}
                  />
                  <ChoiceCard
                    icon={<Hourglass className="h-5 w-5" />}
                    title="Stündliche Abrechnung"
                    hint="Helfer und Transporter nach Stundensatz, wie im Kostenrechner."
                    selected={mode === "stundensatz"}
                    onClick={() => {
                      setMode("stundensatz");
                      next("stunden");
                    }}
                  />
                </div>
              )}

              {/* ── Step 2a: ein Angebot vs. Pakete ── */}
              {step === "angebotsart" && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Bietest du einen Preis an oder die Pakete?
                  </p>
                  <ChoiceCard
                    icon={<Euro className="h-5 w-5" />}
                    title="Ein Angebot"
                    hint="Der Kunde sieht genau einen Festpreis."
                    selected={offerKind === "single"}
                    onClick={() => {
                      setOfferKind("single");
                      next("preis");
                    }}
                  />
                  <ChoiceCard
                    icon={<Package className="h-5 w-5" />}
                    title="Pakete anbieten"
                    hint={
                      catalogue.length > 0
                        ? `${catalogue.map((c) => c.displayName).join(" · ")}. Preis pro Paket eingeben, der Kunde wählt im Portal.`
                        : "Für diese Firma sind keine Pakete hinterlegt (Einstellungen → Kunden-Portal)."
                    }
                    disabled={catalogue.length === 0}
                    selected={offerKind === "packages"}
                    onClick={() => {
                      setOfferKind("packages");
                      next("pakete");
                    }}
                  />
                </div>
              )}

              {/* ── Step 3a: single price ── */}
              {step === "preis" && (
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">Festpreis (EUR)</label>
                    <input
                      type="number"
                      step="0.01"
                      autoFocus
                      value={fixedPrice}
                      onChange={(e) => setFixedPrice(e.target.value)}
                      placeholder="z. B. 890"
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <DepositBlock
                    depositEur={depositEur}
                    setDepositEur={setDepositEur}
                    paymentMethod={paymentMethod}
                    setPaymentMethod={setPaymentMethod}
                  />
                </div>
              )}

              {/* ── Step 3b: packages with prices ── */}
              {step === "pakete" && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Preis pro Paket für diesen Auftrag. Pakete ohne Preis werden
                    nicht angeboten.
                  </p>
                  {packageRows.map((row, idx) => {
                    const Icon = packageIcon(row.catalogueSlug);
                    return (
                      <div
                        key={row.catalogueSlug}
                        className="rounded-xl border border-border bg-card p-3"
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                            <Icon className="h-4 w-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium">
                                {row.displayName}
                              </span>
                              {row.isRecommended && (
                                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
                                  Empfohlen
                                </span>
                              )}
                            </div>
                            {row.shortDescription && (
                              <p className="truncate text-[11px] text-muted-foreground">
                                {row.shortDescription}
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2">
                            <span className="text-xs text-muted-foreground">€</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="0,00"
                              value={row.priceEur}
                              onChange={(e) =>
                                setPackageRows((prev) =>
                                  prev.map((r, i) =>
                                    i === idx
                                      ? { ...r, priceEur: e.target.value.replace(".", ",") }
                                      : r
                                  )
                                )
                              }
                              className="h-8 w-20 border-none bg-transparent px-1 text-right text-sm outline-none tabular-nums"
                            />
                          </div>
                        </div>
                        <PackageListsEditor
                          row={row}
                          onChange={(patch) =>
                            setPackageRows((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, ...patch } : r))
                            )
                          }
                        />
                      </div>
                    );
                  })}
                  <PackageAdvisorChat
                    dealRecordId={dealRecordId}
                    packageRows={packageRows}
                    assumptions={assumptions}
                    onApply={(rows) => setPackageRows(rows)}
                  />
                  <AssumptionsCard draft={assumptions} setDraft={setAssumptions} />
                  <DepositBlock
                    depositEur={depositEur}
                    setDepositEur={setDepositEur}
                    paymentMethod={paymentMethod}
                    setPaymentMethod={setPaymentMethod}
                  />
                </div>
              )}

              {/* ── Step 3c: hourly line items ── */}
              {step === "stunden" && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Positionen wie im Kostenrechner: Anzahl × Stundensatz.
                  </p>
                  {lineItems.map((li, idx) => (
                    <div key={idx} className="rounded-lg border border-border bg-card p-2.5">
                      <div className="flex items-center gap-2">
                        <select
                          value={li.type}
                          onChange={(e) =>
                            setLineItems((prev) =>
                              prev.map((l, i) =>
                                i === idx ? { ...l, type: e.target.value as LineItem["type"] } : l
                              )
                            )
                          }
                          className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none"
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
                          placeholder="Beschreibung"
                          onChange={(e) =>
                            setLineItems((prev) =>
                              prev.map((l, i) =>
                                i === idx ? { ...l, description: e.target.value } : l
                              )
                            )
                          }
                          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none"
                        />
                        <button
                          onClick={() =>
                            setLineItems((prev) => prev.filter((_, i) => i !== idx))
                          }
                          disabled={lineItems.length === 1}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-destructive disabled:opacity-40"
                          aria-label="Position entfernen"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        <label className="flex items-center gap-1.5">
                          <span className="text-muted-foreground">Anzahl</span>
                          <input
                            type="number"
                            min={1}
                            value={li.quantity}
                            onChange={(e) =>
                              setLineItems((prev) =>
                                prev.map((l, i) =>
                                  i === idx
                                    ? { ...l, quantity: parseInt(e.target.value) || 1 }
                                    : l
                                )
                              )
                            }
                            className="h-8 w-16 rounded-md border border-input bg-background px-2 text-right outline-none"
                          />
                        </label>
                        <label className="flex items-center gap-1.5">
                          <span className="text-muted-foreground">€/Std.</span>
                          <input
                            type="number"
                            step="0.01"
                            value={li.unitRate}
                            onChange={(e) =>
                              setLineItems((prev) =>
                                prev.map((l, i) =>
                                  i === idx ? { ...l, unitRate: e.target.value } : l
                                )
                              )
                            }
                            className="h-8 w-20 rounded-md border border-input bg-background px-2 text-right outline-none"
                          />
                        </label>
                        <span className="ml-auto font-medium tabular-nums">
                          {(li.quantity * Number(li.unitRate || 0)).toLocaleString("de-DE", {
                            style: "currency",
                            currency: "EUR",
                          })}
                          <span className="text-muted-foreground"> /Std.</span>
                        </span>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() =>
                        setLineItems((prev) => [...prev, emptyLine(prev.length)])
                      }
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-border px-3 text-xs font-medium hover:bg-accent"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Position
                    </button>
                    <span className="text-sm font-semibold tabular-nums">
                      {lineTotal.toLocaleString("de-DE", {
                        style: "currency",
                        currency: "EUR",
                      })}
                      <span className="text-xs font-normal text-muted-foreground"> /Std.</span>
                    </span>
                  </div>
                  <DepositBlock
                    depositEur={depositEur}
                    setDepositEur={setDepositEur}
                    paymentMethod={paymentMethod}
                    setPaymentMethod={setPaymentMethod}
                  />
                </div>
              )}

              {/* ── Step 4: Kundenfotos kuratieren + KI-Zusammenfassung ── */}
              {step === "fotos" && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Fotos, die der Kunde geschickt hat. Ausgewählte Fotos sieht
                    der Kunde im Angebot unter „Ihre Fotos".
                  </p>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {photos.map((photo) => {
                      const selected = selectedPhotoIds.includes(photo.id);
                      return (
                        <button
                          key={photo.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => togglePhoto(photo.id)}
                          className={cn(
                            "relative aspect-square overflow-hidden rounded-lg border-2 transition-colors",
                            selected
                              ? "border-foreground"
                              : "border-border hover:border-foreground/40"
                          )}
                        >
                          <img
                            src={`/api/v1/deals/${dealRecordId}/portal-photos/${photo.id}`}
                            alt={photo.fileName}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                          {selected && (
                            <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background shadow">
                              <Check className="h-3 w-3" />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={handleAiAnalyze}
                    disabled={
                      aiPending ||
                      selectedPhotoIds.length === 0 ||
                      selectedPhotoIds.length > 6
                    }
                    className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
                  >
                    {aiPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    KI-Zusammenfassung aus {selectedPhotoIds.length}{" "}
                    {selectedPhotoIds.length === 1 ? "Foto" : "Fotos"} erstellen
                  </button>
                  {selectedPhotoIds.length > 6 && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Für die KI-Zusammenfassung bitte maximal 6 Fotos
                      auswählen.
                    </p>
                  )}
                  {aiPending && (
                    <p className="text-xs text-muted-foreground">
                      Die KI analysiert die Fotos, das dauert bis zu zwei
                      Minuten.
                    </p>
                  )}
                  {aiError && (
                    <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      {aiError}
                    </p>
                  )}
                  {aiConfirm && aiResult && (
                    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                      <p className="text-sm font-medium">
                        Vorhandene Beschreibung ersetzen?
                      </p>
                      <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                        {aiResult.summary}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => applyAiSummary("replace")}
                          className="inline-flex h-8 items-center rounded-md bg-foreground px-3 text-xs font-medium text-background hover:opacity-90"
                        >
                          Ersetzen
                        </button>
                        <button
                          type="button"
                          onClick={() => applyAiSummary("append")}
                          className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-accent"
                        >
                          Anhängen
                        </button>
                        <button
                          type="button"
                          onClick={() => setAiConfirm(false)}
                          className="inline-flex h-8 items-center rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-muted"
                        >
                          Abbrechen
                        </button>
                      </div>
                    </div>
                  )}
                  {aiResult && !aiConfirm && (
                    <div className="space-y-2 rounded-lg border border-border bg-card p-3">
                      {aiResult.inventory.length > 0 && (
                        <div>
                          <p className="text-[11px] font-medium text-muted-foreground">
                            Erkanntes Umzugsgut
                          </p>
                          <ul className="mt-1 space-y-0.5 text-xs">
                            {aiResult.inventory.map((item, i) => (
                              <li key={i} className="flex items-start gap-1.5">
                                <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {aiResult.hints.length > 0 && (
                        <div>
                          <p className="text-[11px] font-medium text-muted-foreground">
                            Interne Hinweise, nicht für den Kunden sichtbar
                          </p>
                          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                            {aiResult.hints.map((hint, i) => (
                              <li key={i}>{hint}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Step 5: Beschreibung ── */}
              {step === "beschreibung" && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Beschreibung des Angebots
                  </label>
                  <textarea
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    rows={5}
                    autoFocus
                    placeholder="z. B. Transport einer Waschmaschine von Wildberg nach Stuttgart, inkl. einem Helfer und Transporter."
                    className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                  {summaryFromAi && (
                    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Sparkles className="h-3 w-3 shrink-0" />
                      Von der KI aus den Kundenfotos erstellt. Bitte prüfen und
                      anpassen.
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    Der Kunde sieht diesen Text oben im Portal als „Was umfasst
                    der Auftrag". Optional.
                  </p>
                  {saveError && (
                    <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      {saveError}
                    </p>
                  )}
                </div>
              )}

              {/* ── Step 6: done ── */}
              {step === "fertig" && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
                    <Sparkles className="h-4 w-4 shrink-0" />
                    Status-Link ist bereit.
                  </div>
                  {linkUrl ? (
                    <>
                      <div className="flex items-center gap-2">
                        <input
                          readOnly
                          value={linkUrl}
                          onClick={(e) => e.currentTarget.select()}
                          className="h-9 flex-1 truncate rounded-md border border-border bg-background px-2 text-xs text-muted-foreground"
                        />
                        <button
                          onClick={copyLink}
                          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium hover:bg-accent"
                        >
                          {copied ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                          {copied ? "Kopiert" : "Kopieren"}
                        </button>
                      </div>
                      <button
                        onClick={() => {
                          onInsert(insertMessage);
                          onClose();
                        }}
                        className="inline-flex h-9 w-full items-center justify-center rounded-md bg-foreground text-xs font-medium text-background hover:opacity-90"
                      >
                        Nachricht mit Link in Chat einfügen
                      </button>
                    </>
                  ) : (
                    <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                      Angebot gespeichert, aber das Status-Portal ist für diese
                      Firma deaktiviert (Einstellungen → Kunden-Portal).
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && step !== "abrechnung" && step !== "angebotsart" && step !== "fertig" && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
            {step === "beschreibung" ? (
              <button
                onClick={handleFinish}
                disabled={saving}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-foreground px-4 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Fertigstellen
              </button>
            ) : (
              <button
                onClick={() =>
                  next(
                    step !== "fotos" && photos.length > 0 ? "fotos" : "beschreibung"
                  )
                }
                disabled={!priceValid}
                className="inline-flex h-9 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
              >
                Weiter
              </button>
            )}
          </div>
        )}
        {step === "fertig" && (
          <div className="flex items-center justify-end border-t border-border px-4 py-3">
            <button
              onClick={onClose}
              className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-accent"
            >
              Schließen
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Small pieces ────────────────────────────────────────────────────────────

function ChoiceCard({
  icon,
  title,
  hint,
  selected,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition-colors",
        selected
          ? "border-foreground bg-muted/40"
          : "border-border hover:border-foreground/40 hover:bg-muted/30",
        disabled && "cursor-not-allowed opacity-50 hover:border-border hover:bg-transparent"
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
          {hint}
        </span>
      </span>
    </button>
  );
}

function DepositBlock({
  depositEur,
  setDepositEur,
  paymentMethod,
  setPaymentMethod,
}: {
  depositEur: string;
  setDepositEur: (v: string) => void;
  paymentMethod: "bank_transfer" | "paypal" | "cash" | "card";
  setPaymentMethod: (v: "bank_transfer" | "paypal" | "cash" | "card") => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-3">
      <div>
        <label className="text-xs font-medium text-muted-foreground">
          Anzahlung (EUR, optional)
        </label>
        <input
          type="text"
          inputMode="decimal"
          value={depositEur}
          onChange={(e) => setDepositEur(e.target.value)}
          placeholder="z. B. 200"
          className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground">Zahlungsweg</label>
        <select
          value={paymentMethod}
          onChange={(e) =>
            setPaymentMethod(e.target.value as "bank_transfer" | "paypal" | "cash" | "card")
          }
          className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="bank_transfer">Überweisung (Girocode QR)</option>
          <option value="paypal">PayPal</option>
          <option value="cash">Bar bei Übergabe</option>
          <option value="card">Karte</option>
        </select>
      </div>
    </div>
  );
}

// ─── Paket-Editor-Erweiterungen (Enthalten/Nicht-enthalten, Annahmen, KI) ────

/** Draft → jsonb-Payload; null wenn komplett leer (kein Rausch-Speichern). */
function buildAssumptionsPayload(a: AssumptionsDraft): Record<string, unknown> | null {
  const anfahrt = a.anfahrtMinuten.trim() ? Number(a.anfahrtMinuten) : null;
  const payload = {
    anfahrtMinuten: Number.isFinite(anfahrt) ? anfahrt : null,
    anfahrtQuelle: a.anfahrtMinuten.trim() ? (a.anfahrtQuelle ?? "manuell") : null,
    etageVon: a.etageVon.trim() || null,
    etageBis: a.etageBis.trim() || null,
    zugangVon: a.zugangVon.trim() || null,
    zugangBis: a.zugangBis.trim() || null,
    inventarPositionen: a.inventarPositionen,
    inventarVolumenCbm: a.inventarVolumenCbm,
    hinweis: a.hinweis.trim() || null,
  };
  return Object.values(payload).some((v) => v != null) ? payload : null;
}

function PackageListsEditor({
  row,
  onChange,
}: {
  row: PackagePriceRow;
  onChange: (patch: Partial<PackagePriceRow>) => void;
}) {
  const [open, setOpen] = useState(false);
  const lines = (v: string) =>
    v.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 10);
  return (
    <div className="mt-2 pl-10">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className="h-3 w-3" />
          {row.includedItems.length} enthalten
          {row.addableItems.length > 0 && ` · ${row.addableItems.length} zubuchbar`}
          {row.excludedItems.length > 0 && ` · ${row.excludedItems.length} ausgeschlossen`}
          {" — bearbeiten"}
        </button>
      ) : (
        <div className="space-y-2">
          <button
            onClick={() => setOpen(false)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className="h-3 w-3" />
            Listen einklappen
          </button>
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                Enthalten (pro Zeile)
              </label>
              <textarea
                rows={4}
                value={row.includedItems.join("\n")}
                onChange={(e) => onChange({ includedItems: lines(e.target.value) })}
                className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-[11px]"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-sky-700 dark:text-sky-400">
                Auf Wunsch zubuchbar
              </label>
              <textarea
                rows={4}
                value={row.addableItems.join("\n")}
                onChange={(e) => onChange({ addableItems: lines(e.target.value) })}
                placeholder={"z. B. Malerarbeiten\nUmzugskartons"}
                className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-[11px]"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-rose-700 dark:text-rose-400">
                Nicht enthalten
              </label>
              <textarea
                rows={4}
                value={row.excludedItems.join("\n")}
                onChange={(e) => onChange({ excludedItems: lines(e.target.value) })}
                placeholder={"z. B. Klaviertransport"}
                className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-[11px]"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AssumptionsCard({
  draft,
  setDraft,
}: {
  draft: AssumptionsDraft;
  setDraft: React.Dispatch<React.SetStateAction<AssumptionsDraft>>;
}) {
  const set = (k: keyof AssumptionsDraft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((p) => ({
      ...p,
      [k]: e.target.value,
      // Handeingabe der Anfahrt macht aus "berechnet" eine Operator-Annahme.
      ...(k === "anfahrtMinuten" ? { anfahrtQuelle: "manuell" as const } : {}),
    }));
  const field =
    "h-7 w-full rounded-md border border-input bg-transparent px-2 text-[11px]";
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-xs font-semibold">Kalkulationsgrundlagen</p>
      <p className="mb-2 text-[10px] text-muted-foreground">
        Wird dem Kunden angezeigt und bei Annahme rechtsverbindlich eingefroren —
        Abweichungen am Umzugstag sind damit dokumentierte Abweichungen.
        {draft.inventarPositionen != null &&
          ` Basis: ${draft.inventarPositionen} Positionen${draft.inventarVolumenCbm != null ? ` · ca. ${draft.inventarVolumenCbm} m³` : ""}.`}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="mb-0.5 block text-[10px] text-muted-foreground">
            Anfahrt gesamt (Minuten){" "}
            {draft.anfahrtQuelle === "berechnet" ? "— berechnet" : "— Annahme"}
          </label>
          <input value={draft.anfahrtMinuten} onChange={set("anfahrtMinuten")} inputMode="numeric" placeholder="z. B. 90" className={field} />
        </div>
        <div>
          <label className="mb-0.5 block text-[10px] text-muted-foreground">Hinweis (optional)</label>
          <input value={draft.hinweis} onChange={set("hinweis")} placeholder="z. B. Preis gilt bei Zugang wie angenommen" className={field} />
        </div>
        <div>
          <label className="mb-0.5 block text-[10px] text-muted-foreground">Etage Beladestelle</label>
          <input value={draft.etageVon} onChange={set("etageVon")} placeholder="z. B. 3. OG" className={field} />
        </div>
        <div>
          <label className="mb-0.5 block text-[10px] text-muted-foreground">Etage Entladestelle</label>
          <input value={draft.etageBis} onChange={set("etageBis")} placeholder="z. B. EG" className={field} />
        </div>
        <div>
          <label className="mb-0.5 block text-[10px] text-muted-foreground">Zugang Beladestelle</label>
          <input value={draft.zugangVon} onChange={set("zugangVon")} placeholder="z. B. kein Aufzug, normales Treppenhaus" className={field} />
        </div>
        <div>
          <label className="mb-0.5 block text-[10px] text-muted-foreground">Zugang Entladestelle</label>
          <input value={draft.zugangBis} onChange={set("zugangBis")} placeholder="z. B. Aufzug vorhanden" className={field} />
        </div>
      </div>
    </div>
  );
}

function PackageAdvisorChat({
  dealRecordId,
  packageRows,
  assumptions,
  onApply,
}: {
  dealRecordId: string;
  packageRows: PackagePriceRow[];
  assumptions: AssumptionsDraft;
  onApply: (rows: PackagePriceRow[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<PackagePriceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const content = input.trim();
    if (!content || busy) return;
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/deals/${dealRecordId}/package-advisor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          options: packageRows.map((r) => ({
            catalogueSlug: r.catalogueSlug,
            displayName: r.displayName,
            shortDescription: r.shortDescription,
            priceEur: r.priceEur ? Number(r.priceEur.replace(",", ".")) : null,
            includedItems: r.includedItems,
            excludedItems: r.excludedItems,
            addableItems: r.addableItems,
            isRecommended: r.isRecommended,
          })),
          assumptions: buildAssumptionsPayload(assumptions),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        data?: {
          reply?: string;
          proposal?: {
            options?: Array<{
              catalogueSlug?: string | null;
              displayName: string;
              shortDescription?: string | null;
              priceEur: number;
              includedItems: string[];
              excludedItems: string[];
              addableItems?: string[];
              isRecommended?: boolean;
            }>;
          } | null;
        };
        error?: string;
      };
      if (!res.ok || !j.data?.reply) {
        setError(j.error ?? `Berater nicht erreichbar (${res.status})`);
        setMessages(messages);
        return;
      }
      setMessages([...next, { role: "assistant", content: j.data.reply }]);
      const opts = j.data.proposal?.options;
      setProposal(
        opts && opts.length > 0
          ? opts.map((o) => ({
              catalogueSlug: o.catalogueSlug ?? "",
              displayName: o.displayName,
              shortDescription: o.shortDescription ?? null,
              includedItems: o.includedItems ?? [],
              excludedItems: o.excludedItems ?? [],
              addableItems: o.addableItems ?? [],
              priceEur: o.priceEur.toFixed(2).replace(".", ","),
              isRecommended: !!o.isRecommended,
            }))
          : null
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-1.5 text-xs font-semibold">
        <Sparkles className="h-3.5 w-3.5" />
        Mit KI anpassen (Grok)
        {open ? <ChevronDown className="ml-auto h-3 w-3" /> : <ChevronRight className="ml-auto h-3 w-3" />}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="max-h-48 space-y-1.5 overflow-y-auto">
            {messages.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                z. B. „Klaviertransport nur in Premium, Komfort 50 € günstiger" — die KI
                schlägt vor, übernommen wird nur per Klick.
              </p>
            )}
            {messages.map((m, i) => (
              <p
                key={i}
                className={m.role === "user" ? "rounded-md bg-muted px-2 py-1 text-[11px]" : "px-2 py-1 text-[11px] text-muted-foreground"}
              >
                {m.content}
              </p>
            ))}
            {busy && <p className="px-2 text-[11px] text-muted-foreground">Grok denkt nach…</p>}
          </div>
          {error && (
            <p className="rounded bg-destructive/10 px-2 py-1 text-[11px] text-destructive">{error}</p>
          )}
          {proposal && (
            <div className="rounded-md border border-emerald-600/30 bg-emerald-500/5 p-2">
              <p className="mb-1 text-[11px] font-medium">Vorschlag:</p>
              {proposal.map((p, i) => (
                <p key={i} className="text-[11px] text-muted-foreground">
                  {p.displayName}: {p.priceEur} € · {p.includedItems.length} enthalten
                  {p.addableItems.length > 0 && ` · ${p.addableItems.length} zubuchbar`}
                  {p.excludedItems.length > 0 && ` · ${p.excludedItems.length} ausgeschlossen`}
                </p>
              ))}
              <div className="mt-1.5 flex gap-1.5">
                <button
                  onClick={() => {
                    onApply(proposal);
                    setProposal(null);
                  }}
                  className="rounded-md bg-primary px-2 py-0.5 text-[11px] text-primary-foreground"
                >
                  Übernehmen
                </button>
                <button onClick={() => setProposal(null)} className="rounded-md border border-border px-2 py-0.5 text-[11px]">
                  Verwerfen
                </button>
              </div>
            </div>
          )}
          <div className="flex gap-1">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void send();
              }}
              placeholder="Anweisung an den Paket-Berater…"
              className="h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-[11px]"
            />
            <button
              onClick={() => void send()}
              disabled={busy || !input.trim()}
              className="rounded-md border border-border px-2 text-[11px] disabled:opacity-50"
            >
              Senden
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
