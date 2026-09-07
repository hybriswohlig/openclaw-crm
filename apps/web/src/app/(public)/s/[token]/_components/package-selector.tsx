"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Package, Star, X, Plus, FileText } from "lucide-react";
import { WhatsAppContactLink } from "./whatsapp-contact-link";
import { formatPortalMoney } from "./portal-presentation";
import { pickDefaultDealOption } from "@openclaw-crm/customer-portal-core";
import type {
  DealPackageOffersContext,
  DealPackageOption,
  FirmaBranding,
  OfferPackage,
  OfferPackagesContext,
} from "@openclaw-crm/customer-portal-core";

/**
 * Customer-facing package picker for Stage 1.
 *
 * Renders all available packages for the deal's firma — even before the
 * operator has pre-selected one — so the customer can compare tiers and
 * pick a binding price themselves. A tap on a card writes the choice
 * server-side; if the package carries a fixed binding price (priceFixed
 * Flag), the customer's price card refreshes to that number on the next
 * render cycle.
 *
 * Locking:
 *   - `locked` is true once the customer has already accepted an offer.
 *     Cards still render so the customer sees what they picked, but
 *     can no longer switch tiers (the price they signed is fixed).
 *
 * Visual hierarchy: each card shows price first ("Festpreis 890 €" or
 * "ab 890 €" depending on priceFixedFlag), then name, then 3 included
 * lines + segment caption. Selected card gets a 2 px brand border and a
 * check chip. Recommended card gets a "Beliebteste Wahl" pill.
 *
 * Layout: vertical stack on mobile, 3-up grid from `sm` so all three
 * tiers fit side-by-side on phones-in-landscape and desktops alike.
 */
export function PackageSelector({
  token,
  packages,
  dealOffers,
  branding,
  locked,
  onPicked,
}: {
  token: string;
  packages: OfferPackagesContext;
  dealOffers: DealPackageOffersContext;
  branding: FirmaBranding;
  locked: boolean;
  onPicked: () => void | Promise<void>;
}) {
  // Per-deal options always win when present — that's the operator's
  // intentional "here are exactly these prices for THIS Auftrag" gesture.
  // Catalogue rendering only kicks in when no per-deal options are set.
  if (dealOffers.options.length > 0) {
    return (
      <DealOptionPicker
        token={token}
        offers={dealOffers}
        branding={branding}
        locked={locked}
        onPicked={onPicked}
      />
    );
  }
  return (
    <CataloguePicker
      token={token}
      packages={packages}
      branding={branding}
      locked={locked}
      onPicked={onPicked}
    />
  );
}

function DealOptionPicker({
  token,
  offers,
  branding,
  locked,
  onPicked,
}: {
  token: string;
  offers: DealPackageOffersContext;
  branding: FirmaBranding;
  locked: boolean;
  onPicked: () => void | Promise<void>;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accent = `#${branding.primaryColor}`;
  const defaulted = pickDefaultDealOption(offers.options, offers.selectedOptionId);
  const currentId = defaulted?.id ?? offers.selectedOptionId;

  // Persist the visual default so a first visit never leaves the price card
  // at 0 € with nothing clicked. Skip when already bound or locked.
  useEffect(() => {
    if (locked) return;
    if (!defaulted) return;
    if (defaulted.id === offers.selectedOptionId) return;
    void pick(defaulted.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, defaulted?.id, offers.selectedOptionId]);

  async function pick(optionId: string) {
    if (locked || pendingId) return;
    if (optionId === offers.selectedOptionId) return;
    setPendingId(optionId);
    setError(null);
    try {
      const res = await fetch(`/api/public/${token}/select-package-option`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { code?: string };
        };
        setError(germanError(body.error?.code));
        return;
      }
      await onPicked();
    } catch {
      setError("Verbindungsfehler. Bitte versuchen Sie es erneut.");
    } finally {
      setPendingId(null);
    }
  }

  const selected = offers.options.find((o) => o.id === currentId);
  const visibleOptions =
    locked && selected
      ? offers.options.filter((o) => o.id === selected.id)
      : offers.options;

  return (
    <section data-portal-section="packages" className="space-y-3">
      <div className="flex items-end justify-between gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {locked && selected
            ? "Ihr angenommenes Angebot"
            : visibleOptions.length === 1
              ? "Ihr Angebot"
              : `Wählen Sie aus ${visibleOptions.length} Optionen`}
        </h2>
        {!locked && visibleOptions.length > 1 && (
          <span className="text-[10px] text-muted-foreground">
            Antippen zum Auswählen
          </span>
        )}
      </div>

      <ul className={`portal-package-list ${visibleOptions.length === 1 ? "portal-single-offer" : ""}`}>
        {visibleOptions.map((o) => (
          <DealOptionCard
            key={o.id}
            option={o}
            accent={accent}
            isSelected={o.id === currentId}
            isPending={pendingId === o.id}
            disabled={locked || pendingId != null}
            onTap={() => pick(o.id)}
          />
        ))}
      </ul>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {selected ? (
        <p className="text-[11px] text-muted-foreground">
          Ihre Wahl:{" "}
          <strong className="text-foreground">{selected.displayName}</strong> ·{" "}
          <span className="tabular-nums">
            {formatEurCents(selected.priceCents)}
          </span>
          {locked ? " (verbindlich angenommen)" : visibleOptions.length > 1 ? ". Sie können Ihre Auswahl jederzeit ändern." : "."}
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Wählen Sie eine der Optionen. Der angezeigte Gesamtpreis übernimmt
          Ihre Auswahl automatisch.
        </p>
      )}
    </section>
  );
}

function CataloguePicker({
  token,
  packages,
  branding,
  locked,
  onPicked,
}: {
  token: string;
  packages: OfferPackagesContext;
  branding: FirmaBranding;
  locked: boolean;
  onPicked: () => void | Promise<void>;
}) {
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (packages.available.length === 0) return null;

  const accent = `#${branding.primaryColor}`;
  const currentSlug = packages.selectedSlug;

  async function pick(slug: string) {
    if (locked || pendingSlug) return;
    if (slug === currentSlug) return;
    setPendingSlug(slug);
    setError(null);
    try {
      const res = await fetch(`/api/public/${token}/select-package`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { code?: string };
        };
        setError(germanError(body.error?.code));
        return;
      }
      await onPicked();
    } catch {
      setError("Verbindungsfehler. Bitte versuchen Sie es erneut.");
    } finally {
      setPendingSlug(null);
    }
  }

  return (
    <section data-portal-section="packages" className="space-y-3">
      <div className="flex items-end justify-between gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Paket wählen
        </h2>
        {!locked && (
          <span className="text-[10px] text-muted-foreground">
            Antippen zum Auswählen
          </span>
        )}
      </div>

      <ul className={`portal-package-list ${packages.available.length === 1 ? "portal-single-offer" : ""}`}>
        {packages.available.map((p) => (
          <PackageCard
            key={p.slug}
            pkg={p}
            accent={accent}
            branding={branding}
            isSelected={p.slug === currentSlug}
            isPending={pendingSlug === p.slug}
            disabled={locked || pendingSlug != null}
            onTap={() => pick(p.slug)}
          />
        ))}
      </ul>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {currentSlug ? (
        <p className="text-[11px] text-muted-foreground">
          Ihr Angebot basiert auf dem Paket{" "}
          <strong className="text-foreground">
            {packages.available.find((p) => p.slug === currentSlug)
              ?.displayName ?? currentSlug}
          </strong>
          {locked
            ? " (verbindlich)"
            : ". Sie können oben jederzeit ein anderes Paket wählen"}
          .
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Wählen Sie das Paket, das am besten zu Ihrem Umzug passt. Der
          angezeigte Gesamtpreis übernimmt Ihre Auswahl automatisch.
        </p>
      )}
    </section>
  );
}

function DealOptionCard({ option, isSelected, isPending, disabled, onTap }: {
  option: DealPackageOption; accent: string; isSelected: boolean; isPending: boolean; disabled: boolean; onTap: () => void;
}) {
  const Icon = option.isRecommended ? Star : Package;
  return <li>
    <button type="button" onClick={onTap} disabled={disabled} aria-pressed={isSelected} aria-busy={isPending} className="portal-package-card">
      {option.isRecommended && <span className="portal-package-badge">Empfohlen</span>}
      <div className="portal-package-title"><span className="portal-package-icon"><Icon size={28} aria-hidden /></span><div><strong>{option.displayName}</strong>{option.shortDescription && <p>{option.shortDescription}</p>}</div></div>
      <div className="portal-package-price-wrap"><div className="portal-price portal-package-price">{formatPortalMoney(option.priceCents)}</div><p className="portal-package-price-label">Festpreis</p></div>
      <ul className="portal-package-features">
        {option.includedItems.map((item, i) => <li key={`in-${i}`}><Check aria-hidden /><span>{item}</span></li>)}
        {(option.excludedItems ?? []).map((item, i) => <li className="excluded" key={`out-${i}`}><X aria-hidden /><span><span className="sr-only">Nicht enthalten: </span>{item}</span></li>)}
        {(option.addableItems ?? []).map((item, i) => <li key={`add-${i}`}><Plus aria-hidden /><span>{item} <span className="text-muted-foreground">(zubuchbar)</span></span></li>)}
      </ul>
      {option.note && <p className="mb-3 text-xs text-muted-foreground">{option.note}</p>}
      <div className="portal-package-cta"><span className={`portal-button ${isSelected ? "" : "portal-button-secondary"}`}>
        {isPending ? <Loader2 size={17} className="animate-spin" aria-hidden /> : isSelected ? <Check size={17} aria-hidden /> : <FileText size={17} aria-hidden />}
        {isPending ? "Wird gespeichert…" : isSelected ? "Aktuell ausgewählt" : "Angebot auswählen"}
      </span></div>
    </button>
  </li>;
}

function PackageCard({ pkg, branding, isSelected, isPending, disabled, onTap }: {
  pkg: OfferPackage; accent: string; branding: FirmaBranding; isSelected: boolean; isPending: boolean; disabled: boolean; onTap: () => void;
}) {
  const hasPrice = pkg.priceFromCents != null;
  const Icon = pkg.isRecommended ? Star : Package;
  const body = <>
    {pkg.isRecommended && <span className="portal-package-badge">Empfohlen</span>}
    <div className="portal-package-title"><span className="portal-package-icon"><Icon size={28} aria-hidden /></span><div><strong>{pkg.displayName}</strong>{pkg.shortDescription && <p>{pkg.shortDescription}</p>}</div></div>
    <div className="portal-package-price-wrap"><div className="portal-price portal-package-price">{hasPrice ? formatPortalMoney(pkg.priceFromCents!) : "Auf Anfrage"}</div><p className="portal-package-price-label">{hasPrice ? pkg.priceFixedFlag ? "Festpreis" : "Ab-Preis, individuelles Angebot folgt" : "Individuelles Angebot"}</p></div>
    <ul className="portal-package-features">{pkg.includedItems.map((item, i) => <li key={i}><Check aria-hidden /><span>{item}</span></li>)}</ul>
    {pkg.targetSegment && <p className="mb-3 text-xs text-muted-foreground">{pkg.targetSegment}</p>}
    <div className="portal-package-cta">{hasPrice ? <span className={`portal-button ${isSelected ? "" : "portal-button-secondary"}`}>{isPending ? <Loader2 size={17} className="animate-spin" aria-hidden /> : isSelected ? <Check size={17} aria-hidden /> : <FileText size={17} aria-hidden />}{isPending ? "Wird gespeichert…" : isSelected ? "Aktuell ausgewählt" : "Paket auswählen"}</span> : <WhatsAppContactLink phoneE164={branding.whatsappNumberE164} label="Angebot anfragen" message={`Hallo ${branding.displayName}, ich interessiere mich für das Paket ${pkg.displayName}.`} className="portal-button portal-button-secondary" fallback={<span className="text-xs text-muted-foreground">Antworten Sie uns für ein Angebot im bestehenden Chat.</span>} />}</div>
  </>;
  return <li>{hasPrice ? <button type="button" className="portal-package-card" onClick={onTap} disabled={disabled} aria-pressed={isSelected} aria-busy={isPending}>{body}</button> : <div className="portal-package-card">{body}</div>}</li>;
}

function formatEurCents(cents: number): string { return formatPortalMoney(cents); }

function germanError(code: string | undefined): string {
  switch (code) {
    case "PACKAGE_NOT_FOUND":
    case "OPTION_NOT_FOUND":
      return "Diese Option ist nicht mehr verfügbar. Bitte Seite neu laden.";
    case "ALREADY_ACCEPTED":
      return "Das Angebot wurde bereits verbindlich angenommen. Bitte kontaktieren Sie uns für eine Änderung.";
    case "NO_OPERATING_COMPANY":
      return "Auftrag noch nicht vollständig zugeordnet.";
    case "REVOKED":
      return "Dieser Link ist nicht mehr aktiv.";
    case "NOT_FOUND":
      return "Link nicht gefunden.";
    default:
      return "Es ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut.";
  }
}
