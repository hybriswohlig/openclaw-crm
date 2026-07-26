"use client";

import { useMemo, useState } from "react";
import {
  formatDateLong,
  formatDateShort,
  formatWeekday,
  portalErrorKey,
  type CustomerPortalContext,
  type DateOfferOption,
  type DateOfferSlot,
  type PortalLocale,
} from "@openclaw-crm/customer-portal-core";
import { WhatsAppContactLink } from "./whatsapp-contact-link";
import { useLocale, useT } from "./portal-i18n";

/**
 * Customer-facing multi-date picker rendered on Stage 1.
 *
 * - Renders a card per candidate date with slot pills. Tapping a slot
 *   confirms (mobile-friendly two-tap) so the customer never picks blind.
 * - Once a selection exists we collapse to a calm "Sie haben ... gewählt"
 *   summary with an "Ändern" button that re-opens the picker.
 * - Layout: stack on mobile, 2-column grid from `md`, 3-column from `xl`.
 *   Card height matches with `flex-col` so a recommendation badge does not
 *   misalign neighbours.
 */
export function DateOfferPicker({
  token,
  ctx,
  onPicked,
}: {
  token: string;
  ctx: CustomerPortalContext;
  onPicked: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const { options, selection } = ctx.dateOffers;
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingSlot, setPendingSlot] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const accent = `#${ctx.branding.primaryColor}`;

  const selectedOption = useMemo(
    () =>
      selection
        ? (options.find((o) => o.id === selection.dateOfferId) ?? null)
        : null,
    [options, selection],
  );

  if (options.length === 0) return null;

  // Already picked, not editing — show the calm confirmation card.
  if (selection && !editing) {
    return (
      <section
        data-portal-section="date-picker"
        className="overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/40"
      >
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-wider text-emerald-900/70 dark:text-emerald-300/80">
              {t("dates.yourDate")}
            </div>
            <div className="display mt-1 text-xl font-medium text-emerald-950 dark:text-emerald-100 sm:text-2xl">
              {formatDateLong(selection.selectedDate, locale)}
            </div>
            {selection.slotLabel && (
              <div className="mt-0.5 text-sm text-emerald-900/90 dark:text-emerald-200/90">
                {selection.slotLabel}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="self-start rounded-full border border-emerald-300/80 bg-white/70 px-4 py-1.5 text-xs font-medium text-emerald-900 backdrop-blur transition hover:bg-white dark:border-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100"
          >
            {t("dates.change")}
          </button>
        </div>
      </section>
    );
  }

  async function submit(optionId: string, slotIndex: number) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/${token}/select-date`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateOfferId: optionId, slotIndex }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { code?: string };
        };
        setError(t(portalErrorKey(body.error?.code)));
        return;
      }
      setEditing(false);
      setPendingId(null);
      setPendingSlot(null);
      onPicked();
    } catch {
      setError(t("errors.connection"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      data-portal-section="date-picker"
      className="overflow-hidden rounded-2xl border bg-card"
      style={{
        borderColor: "var(--border)",
      }}
    >
      <div
        className="flex items-center justify-between border-b px-6 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {selection ? t("dates.changeTitle") : t("dates.pickTitle")}
        </div>
        {options.length > 1 && (
          <div className="text-[10px] text-muted-foreground">
            {t("dates.proposals", { count: options.length })}
          </div>
        )}
      </div>

      <div className="p-4 sm:p-6">
        <p className="mb-4 text-sm leading-relaxed text-muted-foreground sm:mb-5">
          {t("dates.intro")}
        </p>

        <div className="grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
          {options.map((opt) => (
            <DateCard
              key={opt.id}
              opt={opt}
              accent={accent}
              locale={locale}
              pendingSlot={pendingId === opt.id ? pendingSlot : null}
              isSubmittingFor={submitting && pendingId === opt.id}
              currentSelectionDate={
                selectedOption?.id === opt.id
                  ? (selection?.selectedDate ?? null)
                  : null
              }
              onSlotTap={(idx) => {
                setPendingId(opt.id);
                setPendingSlot(idx);
                setError(null);
              }}
              onConfirm={() => {
                if (pendingId && pendingSlot != null) {
                  void submit(pendingId, pendingSlot);
                }
              }}
            />
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground sm:mt-5">
          <span>{t("dates.noneFit")}</span>
          <WhatsAppContactLink
            phoneE164={ctx.branding.whatsappNumberE164}
            label={t("dates.waLabel")}
            message={t("dates.waMessage", {
              firma: ctx.branding.displayName,
            })}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-foreground underline underline-offset-4"
            fallback={<span>{t("dates.waFallback")}</span>}
          />
        </div>

        {error && (
          <p className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        {selection && (
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setPendingId(null);
              setPendingSlot(null);
            }}
            className="mt-4 text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
          >
            {t("dates.keepCurrent", {
              date: formatDateLong(selection.selectedDate, locale),
            })}
          </button>
        )}
      </div>
    </section>
  );
}

function DateCard({
  opt,
  accent,
  locale,
  pendingSlot,
  isSubmittingFor,
  currentSelectionDate,
  onSlotTap,
  onConfirm,
}: {
  opt: DateOfferOption;
  accent: string;
  locale: PortalLocale;
  pendingSlot: number | null;
  isSubmittingFor: boolean;
  currentSelectionDate: string | null;
  onSlotTap: (slotIndex: number) => void;
  onConfirm: () => void;
}) {
  const t = useT();
  const isPreviouslyPicked = currentSelectionDate === opt.date;
  return (
    <article
      className="group relative flex flex-col gap-3 rounded-xl border border-border/70 bg-background p-4 transition hover:border-foreground/30 hover:shadow-sm"
      style={
        pendingSlot != null
          ? { borderColor: accent, boxShadow: `0 0 0 3px ${accent}1a` }
          : undefined
      }
    >
      {opt.isRecommended && (
        <span
          className="absolute -top-2 left-3 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white"
          style={{ background: accent }}
        >
          {t("dates.recommended")}
        </span>
      )}
      {isPreviouslyPicked && (
        <span className="absolute -top-2 right-3 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white">
          {t("dates.currentlySelected")}
        </span>
      )}

      <header>
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {formatWeekday(opt.date, locale)}
        </div>
        <h3 className="display mt-0.5 text-xl font-medium leading-none">
          {formatDateShort(opt.date, locale)}
        </h3>
      </header>

      <ul className="-m-1 flex flex-wrap">
        {opt.slots.map((s, idx) => (
          <li key={idx} className="p-1">
            <button
              type="button"
              onClick={() => onSlotTap(idx)}
              disabled={isSubmittingFor}
              className="inline-flex min-h-11 items-center rounded-full border px-4 py-2 text-sm font-medium transition active:scale-[0.97] disabled:opacity-50"
              style={
                pendingSlot === idx
                  ? {
                      borderColor: accent,
                      background: accent,
                      color: "#fff",
                    }
                  : { borderColor: "var(--border)" }
              }
            >
              {formatSlot(s)}
            </button>
          </li>
        ))}
      </ul>

      {opt.note && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {opt.note}
        </p>
      )}

      {pendingSlot != null && (
        <button
          type="button"
          onClick={onConfirm}
          disabled={isSubmittingFor}
          className="mt-auto inline-flex h-11 items-center justify-center rounded-xl text-sm font-medium text-white transition-opacity disabled:opacity-50"
          style={{ background: accent }}
        >
          {isSubmittingFor ? t("dates.saving") : t("dates.pickThis")}
        </button>
      )}
    </article>
  );
}

function formatSlot(s: DateOfferSlot): string {
  if (s.startTime && s.endTime) {
    return `${s.label} · ${s.startTime}–${s.endTime}`;
  }
  return s.label;
}

