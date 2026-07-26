"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { WhatsAppContactLink } from "./whatsapp-contact-link";
import {
  formatEurCentsRounded,
  portalErrorKey,
  type DealPackageOffersContext,
  type DealPackageOption,
  type FirmaBranding,
  type OfferPackage,
  type OfferPackagesContext,
} from "@openclaw-crm/customer-portal-core";
import { useLocale, useT } from "./portal-i18n";

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
  const t = useT();
  const locale = useLocale();
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
        setError(t(portalErrorKey(body.error?.code)));
        return;
      }
      onPicked();
    } catch {
      setError(t("errors.connection"));
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
            ? t("packages.yourOffer")
            : t("packages.chooseFrom", { count: offers.options.length })}
        </h2>
        {!locked && offers.options.length > 1 && (
          <span className="text-[10px] text-muted-foreground">
            {t("packages.tapToSelect")}
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
          {t("packages.yourChoice")}{" "}
          <strong className="text-foreground">{selected.displayName}</strong> ·{" "}
          <span className="tabular-nums">
            {formatEurCentsRounded(selected.priceCents, locale)}
          </span>
          {locked
            ? t("packages.bindingSuffix")
            : t("packages.canSwitchOption")}
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {t("packages.pickOneHint")}
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
  const t = useT();
  const locale = useLocale();
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
        setError(t(portalErrorKey(body.error?.code)));
        return;
      }
      onPicked();
    } catch {
      setError(t("errors.connection"));
    } finally {
      setPendingSlug(null);
    }
  }

  return (
    <section data-portal-section="packages" className="space-y-3">
      <div className="flex items-end justify-between gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("packages.choosePackage")}
        </h2>
        {!locked && (
          <span className="text-[10px] text-muted-foreground">
            {t("packages.tapToSelect")}
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
          {t("packages.basedOnPackage")}{" "}
          <strong className="text-foreground">
            {packages.available.find((p) => p.slug === currentSlug)
              ?.displayName ?? currentSlug}
          </strong>
          {locked
            ? t("packages.bindingSuffix")
            : t("packages.canSwitchPackage")}
          .
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {t("packages.pickPackageHint")}
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
  const t = useT();
  const locale = useLocale();
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
            {t("packages.recommended")}
          </span>
        )}

        {/* Price first, large and tabular. */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("packages.fixedPrice")}
            </div>
            <div className="display mt-0.5 text-2xl font-medium tabular-nums leading-none">
              {formatEurCentsRounded(option.priceCents, locale)}
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

        {/* Leistungsumfang pro Paket in drei Stufen: enthalten ✓, auf Wunsch
            zubuchbar +, ausdrücklich nicht enthalten ✗ (durchgestrichen).
            Vollständig statt gekappt — DIE Karte ist der Leistungsumfang. */}
        {option.includedItems.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("packages.included")}
            </p>
            <ul className="space-y-1.5 text-xs">
              {option.includedItems.map((item, i) => (
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
            </ul>
          </div>
        )}

        {(option.addableItems ?? []).length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("packages.addable")}
            </p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {(option.addableItems ?? []).map((item, i) => (
                <li key={i} className="flex items-start gap-2 leading-snug">
                  <span
                    aria-hidden
                    className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border text-[10px] leading-none"
                  >
                    +
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(option.excludedItems ?? []).length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("packages.excluded")}
            </p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {(option.excludedItems ?? []).map((item, i) => (
                <li key={i} className="flex items-start gap-2 leading-snug">
                  <span aria-hidden className="mt-0.5 shrink-0 text-[11px] leading-none">✗</span>
                  <span className="line-through decoration-muted-foreground/50">{item}</span>
                </li>
              ))}
            </ul>
          </div>
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
            {isPending ? t("packages.saving") : t("packages.selectOption")}
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
  const t = useT();
  const locale = useLocale();
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
          {t("packages.mostPopular")}
        </span>
      )}

      {/* Price block — calmest, biggest. Reads first. */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {onRequest
              ? t("packages.onRequest")
              : isFixed
                ? t("packages.fixedPrice")
                : t("packages.priceFrom")}
          </div>
          <div className="display mt-0.5 text-2xl font-medium tabular-nums leading-none">
            {hasPrice
              ? formatEurCentsRounded(pkg.priceFromCents!, locale)
              : t("packages.individual")}
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
              {t("packages.andMore", { count: pkg.includedItems.length - 4 })}
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
          {isPending ? t("packages.saving") : t("packages.selectPackage")}
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
              label={t("packages.waAskLabel")}
              message={t("packages.waAskMessage", {
                firma: branding.displayName,
                package: pkg.displayName,
              })}
              className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl text-sm font-medium text-white"
            />
          </span>
        ) : (
          <div className="mt-3 inline-flex items-center justify-center self-stretch rounded-lg bg-muted px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
            {t("packages.onRequestFallback")}
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

