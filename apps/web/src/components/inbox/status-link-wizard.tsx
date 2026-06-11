// apps/web/src/components/inbox/status-link-wizard.tsx
//
// Guided wizard that builds the customer status link from inside the inbox
// context panel. Walks the operator through:
//
//   1. Abrechnungsart: Fixbetrag oder stündliche Abrechnung
//   2. Fixbetrag → ein Angebot (ein Preis) ODER Pakete aus dem
//      offer_packages-Katalog der Firma (Preis pro Paket, gespeichert als
//      per-Deal package options). Stündlich → Positionen wie im Kostenrechner.
//   3. Beschreibung (Freitext, Kunde sieht das im Portal)
//   4. Speichern (quotation PUT mintet den Link automatisch) → Link anzeigen
//
// The Standard-Umzugsleistungen toggle is intentionally NOT part of this
// wizard; the existing quotation value is passed through unchanged.
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
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
  priceEur: string;
  isRecommended: boolean;
}

type Step = "abrechnung" | "angebotsart" | "preis" | "pakete" | "stunden" | "beschreibung" | "fertig";

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

  // Stündlich path
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { type: "helper", description: "Helfer", quantity: 2, unitRate: "35", sortOrder: 0 },
    { type: "transporter", description: "Transporter inkl. Fahrer", quantity: 1, unitRate: "25", sortOrder: 1 },
  ]);

  // Beschreibung
  const [summary, setSummary] = useState("");

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
        const [qRes, pRes] = await Promise.all([
          fetch(`/api/v1/deals/${dealRecordId}/quotation`),
          fetch(`/api/v1/deals/${dealRecordId}/offer-packages`),
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

  const stepBack: Partial<Record<Step, Step>> = {
    angebotsart: "abrechnung",
    preis: "angebotsart",
    pakete: "angebotsart",
    stunden: "abrechnung",
    beschreibung:
      mode === "stundensatz" ? "stunden" : offerKind === "packages" ? "pakete" : "preis",
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

  async function handleFinish() {
    setSaving(true);
    setSaveError(null);
    try {
      const depositCents = depositEur.trim() ? parseEur(depositEur) : null;
      const isVariable = mode === "stundensatz";

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
                        {row.includedItems.length > 0 && (
                          <ul className="mt-2 space-y-0.5 pl-10 text-[11px] text-muted-foreground">
                            {row.includedItems.slice(0, 4).map((it, i) => (
                              <li key={i} className="flex items-center gap-1.5">
                                <Check className="h-3 w-3 shrink-0 text-emerald-600" />
                                <span className="truncate">{it}</span>
                              </li>
                            ))}
                            {row.includedItems.length > 4 && (
                              <li className="text-muted-foreground/60">
                                + {row.includedItems.length - 4} weitere
                              </li>
                            )}
                          </ul>
                        )}
                      </div>
                    );
                  })}
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

              {/* ── Step 4: Beschreibung ── */}
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

              {/* ── Step 5: done ── */}
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
                onClick={() => next("beschreibung")}
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
