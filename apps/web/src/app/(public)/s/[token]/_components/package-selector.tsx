"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { WhatsAppContactLink } from "./whatsapp-contact-link";
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
  onPicked: () => void;
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
  onPicked: () => void;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accent = `#${branding.primaryColor}`;
  const currentId = offers.selectedOptionId;

  async function pick(optionId: string) {
    if (locked) return;
    if (optionId === currentId) return;
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
      onPicked();
    } catch {
      setError("Verbindungsfehler. Bitte versuchen Sie es erneut.");
    } finally {
      setPendingId(null);
    }
  }

  const selected = offers.options.find((o) => o.id === currentId);

  return (
    <section data-portal-section="packages" className="space-y-3">
      <div className="flex items-end justify-between gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {offers.options.length === 1
            ? "Ihr Angebot"
            : `Wählen Sie aus ${offers.options.length} Optionen`}
        </h2>
        {!locked && offers.options.length > 1 && (
          <span className="text-[10px] text-muted-foreground">
            Antippen zum Auswählen
          </span>
        )}
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {offers.options.map((o) => (
          <DealOptionCard
            key={o.id}
            option={o}
            accent={accent}
            isSelected={o.id === currentId}
            isPending={pendingId === o.id}
            disabled={locked || (pendingId != null && pendingId !== o.id)}
            onTap={() => pick(o.id)}
          />
        ))}
      </ul>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
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
          {locked ? " (verbindlich)" : ". Sie können oben jederzeit umwählen."}
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
  onPicked: () => void;
}) {
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (packages.available.length === 0) return null;

  const accent = `#${branding.primaryColor}`;
  const currentSlug = packages.selectedSlug;

  async function pick(slug: string) {
    if (locked) return;
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
      onPicked();
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

      <ul className="grid gap-3 sm:grid-cols-3">
        {packages.available.map((p) => (
          <PackageCard
            key={p.slug}
            pkg={p}
            accent={accent}
            branding={branding}
            isSelected={p.slug === currentSlug}
            isPending={pendingSlug === p.slug}
            disabled={locked || (pendingSlug != null && pendingSlug !== p.slug)}
            onTap={() => pick(p.slug)}
          />
        ))}
      </ul>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
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

function DealOptionCard({
  option,
  accent,
  isSelected,
  isPending,
  disabled,
  onTap,
}: {
  option: DealPackageOption;
  accent: string;
  isSelected: boolean;
  isPending: boolean;
  disabled: boolean;
  onTap: () => void;
}) {
  return (
    <li className="relative">
      <button
        type="button"
        onClick={onTap}
        disabled={disabled}
        aria-pressed={isSelected}
        className="group relative flex h-full w-full flex-col rounded-2xl border bg-card p-4 text-left transition-all hover:border-foreground/30 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-70"
        style={
          isSelected
            ? {
                borderColor: accent,
                borderWidth: 2,
                padding: 15,
                boxShadow: `0 0 0 3px ${accent}1a`,
              }
            : undefined
        }
      >
        {option.isRecommended && (
          <span
            className="absolute -top-2.5 right-4 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white shadow-sm"
            style={{ background: accent }}
          >
            Empfohlen
          </span>
        )}

        {/* Price first, large and tabular. */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Festpreis
            </div>
            <div className="display mt-0.5 text-2xl font-medium tabular-nums leading-none">
              {formatEurCents(option.priceCents)}
            </div>
          </div>
          {isSelected ? (
            <span
              className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
              style={{ background: accent }}
              aria-hidden
            >
              <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
            </span>
          ) : isPending ? (
            <span
              className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border"
              style={{ borderColor: accent, color: accent }}
              aria-hidden
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            </span>
          ) : null}
        </div>

        <div className="mt-3">
          <div className="text-sm font-medium">{option.displayName}</div>
          {option.shortDescription && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {option.shortDescription}
            </p>
          )}
        </div>

        {option.includedItems.length > 0 && (
          <ul className="mt-3 space-y-1.5 text-xs">
            {option.includedItems.slice(0, 5).map((item, i) => (
              <li key={i} className="flex items-start gap-2 leading-snug">
                <Check
                  className="mt-0.5 h-3 w-3 shrink-0"
                  strokeWidth={2.5}
                  style={{ color: accent }}
                  aria-hidden
                />
                <span>{item}</span>
              </li>
            ))}
            {option.includedItems.length > 5 && (
              <li className="text-muted-foreground">
                und {option.includedItems.length - 5} weitere
              </li>
            )}
          </ul>
        )}

        {/* Ausdrücklich nicht enthaltene Leistungen — schwarz auf weiß,
            damit der Leistungsumfang rechtlich eindeutig ist. */}
        {(option.excludedItems ?? []).length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {(option.excludedItems ?? []).slice(0, 5).map((item, i) => (
              <li key={i} className="flex items-start gap-2 leading-snug">
                <span aria-hidden className="mt-0.5 shrink-0 text-[11px] leading-none">✗</span>
                <span className="line-through decoration-muted-foreground/50">{item}</span>
              </li>
            ))}
          </ul>
        )}

        {option.note && (
          <p className="mt-3 border-t pt-2 text-[11px] text-muted-foreground">
            {option.note}
          </p>
        )}

        {!isSelected && (
          <div
            className="mt-3 inline-flex items-center justify-center self-stretch rounded-lg border border-dashed px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition group-hover:border-solid group-hover:text-foreground"
            style={{ borderColor: "var(--border)" }}
          >
            {isPending ? "Wird gespeichert…" : "Diese Option wählen"}
          </div>
        )}
      </button>
    </li>
  );
}

function PackageCard({
  pkg,
  accent,
  branding,
  isSelected,
  isPending,
  disabled,
  onTap,
}: {
  pkg: OfferPackage;
  accent: string;
  branding: FirmaBranding;
  isSelected: boolean;
  isPending: boolean;
  disabled: boolean;
  onTap: () => void;
}) {
  const hasPrice = pkg.priceFromCents != null;
  const onRequest = !hasPrice;
  const isFixed = pkg.priceFixedFlag && hasPrice;

  const cardBody = (
    <>
      {pkg.isRecommended && (
        <span
          className="absolute -top-2.5 right-4 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white shadow-sm"
          style={{ background: accent }}
        >
          Beliebteste Wahl
        </span>
      )}

      {/* Price block — calmest, biggest. Reads first. */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {onRequest ? "Auf Anfrage" : isFixed ? "Festpreis" : "ab"}
          </div>
          <div className="display mt-0.5 text-2xl font-medium tabular-nums leading-none">
            {hasPrice ? formatEurCents(pkg.priceFromCents!) : "Individuell"}
          </div>
        </div>
        {isSelected ? (
          <span
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
            style={{ background: accent }}
            aria-hidden
          >
            <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
          </span>
        ) : isPending ? (
          <span
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border"
            style={{ borderColor: accent, color: accent }}
            aria-hidden
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          </span>
        ) : null}
      </div>

      {/* Name + short description */}
      <div className="mt-3">
        <div className="text-sm font-medium">{pkg.displayName}</div>
        {pkg.shortDescription && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {pkg.shortDescription}
          </p>
        )}
      </div>

      {/* Included lines */}
      {pkg.includedItems.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-xs">
          {pkg.includedItems.slice(0, 4).map((item, i) => (
            <li key={i} className="flex items-start gap-2 leading-snug">
              <Check
                className="mt-0.5 h-3 w-3 shrink-0"
                strokeWidth={2.5}
                style={{ color: accent }}
                aria-hidden
              />
              <span>{item}</span>
            </li>
          ))}
          {pkg.includedItems.length > 4 && (
            <li className="text-muted-foreground">
              und {pkg.includedItems.length - 4} weitere
            </li>
          )}
        </ul>
      )}

      {pkg.targetSegment && (
        <p className="mt-3 border-t pt-2 text-[11px] text-muted-foreground">
          {pkg.targetSegment}
        </p>
      )}

      {/* Bottom-anchored CTA hint */}
      {!isSelected && !onRequest && (
        <div
          className="mt-3 inline-flex items-center justify-center self-stretch rounded-lg border border-dashed px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition group-hover:border-solid group-hover:text-foreground"
          style={{ borderColor: "var(--border)" }}
        >
          {isPending ? "Wird gespeichert…" : "Dieses Paket wählen"}
        </div>
      )}
      {onRequest &&
        (branding.whatsappNumberE164 ? (
          <span
            className="mt-3 block self-stretch rounded-xl"
            style={{ background: accent }}
          >
            <WhatsAppContactLink
              phoneE164={branding.whatsappNumberE164}
              label="Per WhatsApp anfragen"
              message={`Hallo ${branding.displayName}, ich interessiere mich für das Paket ${pkg.displayName}. Können Sie mir dazu ein Angebot machen?`}
              className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl text-sm font-medium text-white"
            />
          </span>
        ) : (
          <div className="mt-3 inline-flex items-center justify-center self-stretch rounded-lg bg-muted px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
            Auf Anfrage. Antworten Sie uns einfach im Chat.
          </div>
        ))}
    </>
  );

  return (
    <li className="relative">
      {onRequest ? (
        // On-request cards are never selectable. Render a plain container,
        // because a link inside a disabled button would not be tappable.
        <div className="relative flex h-full w-full flex-col rounded-2xl border bg-card p-4 text-left">
          {cardBody}
        </div>
      ) : (
        <button
          type="button"
          onClick={onTap}
          disabled={disabled}
          aria-pressed={isSelected}
          className="group relative flex h-full w-full flex-col rounded-2xl border bg-card p-4 text-left transition-all hover:border-foreground/30 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-70"
          style={
            isSelected
              ? {
                  borderColor: accent,
                  borderWidth: 2,
                  padding: 15,
                  boxShadow: `0 0 0 3px ${accent}1a`,
                }
              : undefined
          }
        >
          {cardBody}
        </button>
      )}
    </li>
  );
}

function formatEurCents(cents: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

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
