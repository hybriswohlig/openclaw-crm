"use client";

import { useMemo } from "react";
import { MessageCircle } from "lucide-react";
import {
  formatIsoTimeShort,
  type CustomerPortalContext,
  type Translator,
} from "@openclaw-crm/customer-portal-core";
import { LiveMediaFeed } from "./live-media-feed";
import { HourlyClock } from "./hourly-clock";
import { useLocale, useT } from "./portal-i18n";

/**
 * Stage 3 — during the move. Composition:
 *   1. Live status panel: headline, planned arrival window, reliability note
 *      and a milestone timeline (timeline only for fixed-price moves, the
 *      hourly clock already shows it)
 *   2. Hourly billing clock (only when the offer is variable / hourly)
 *   3. Live media feed of crew-sent photos with captions
 *   4. WhatsApp direct-message button to the responsible party
 */
export function StageThreeLive({
  token,
  ctx,
}: {
  token: string;
  ctx: CustomerPortalContext;
}) {
  const t = useT();
  const headline = useMemo(() => headlineForStage(ctx, t), [ctx, t]);
  const isHourly = !!ctx.kva?.isVariable;
  const arrivalWindow = arrivalWindowLine(ctx, t);
  const showReliabilityNote = !!ctx.timing.departureAt && !ctx.timing.onsiteAt;

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-border/50 bg-card p-5">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("stage3.currentStatus")}
        </div>
        <div className="mt-1 text-base font-medium">{headline}</div>
        {arrivalWindow && (
          <div className="mt-2 text-sm text-muted-foreground">{arrivalWindow}</div>
        )}
        {showReliabilityNote && (
          <div className="mt-1 text-sm text-muted-foreground">
            {t("stage3.reliabilityNote")}
          </div>
        )}
        {!isHourly && (
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <Milestone
              label={t("stage3.milestoneTravel")}
              iso={ctx.timing.departureAt}
            />
            <Milestone
              label={t("stage3.milestoneOnsite")}
              iso={ctx.timing.onsiteAt}
            />
            <Milestone
              label={t("stage3.milestoneFinished")}
              iso={ctx.timing.finishedAt}
            />
          </div>
        )}
      </div>

      {isHourly && (
        <HourlyClock
          timing={ctx.timing}
          kva={ctx.kva}
          crew={ctx.crew}
          primaryColor={ctx.branding.primaryColor}
        />
      )}

      <LiveMediaFeed token={token} attachments={ctx.attachments} primaryColor={ctx.branding.primaryColor} />

      {ctx.branding.whatsappNumberE164 && (
        <WhatsAppButton
          phoneE164={ctx.branding.whatsappNumberE164}
          dealNumber={ctx.dealNumber}
          firma={ctx.branding.displayName}
          primaryColor={ctx.branding.primaryColor}
        />
      )}
    </section>
  );
}

function headlineForStage(ctx: CustomerPortalContext, t: Translator): string {
  if (ctx.timing.finishedAt) return t("stage3.finished");
  if (ctx.timing.onsiteAt) return t("stage3.onsite");
  if (ctx.timing.departureAt) return t("stage3.departed");
  return t("stage3.running");
}

/**
 * Planned arrival window from the customer's chosen slot. Only shown while
 * the crew has not arrived yet; once onsiteAt is set the real time wins.
 */
function arrivalWindowLine(
  ctx: CustomerPortalContext,
  t: Translator
): string | null {
  if (ctx.timing.onsiteAt) return null;
  const { timeStart, timeEnd } = ctx.scope;
  if (!timeStart) return null;
  if (timeEnd) {
    return t("stage3.arrivalBetween", { start: timeStart, end: timeEnd });
  }
  return t("stage3.arrivalAround", { start: timeStart });
}

function Milestone({ label, iso }: { label: string; iso: string | null }) {
  const t = useT();
  const locale = useLocale();
  return (
    <div className="space-y-1 rounded-lg border border-border/50 px-2 py-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-xs tabular-nums">
        {iso ? (
          formatIsoTimeShort(iso, locale)
        ) : (
          <span className="text-muted-foreground/60">{t("stage3.pending")}</span>
        )}
      </div>
    </div>
  );
}

function WhatsAppButton({
  phoneE164,
  dealNumber,
  firma,
  primaryColor,
}: {
  phoneE164: string;
  dealNumber: string;
  firma: string;
  primaryColor: string;
}) {
  const t = useT();
  const text = encodeURIComponent(
    t("stage2.waMessage", { firma, dealNumber })
  );
  const phone = phoneE164.replace(/^\+/, "").replace(/\s/g, "");
  const href = `https://wa.me/${phone}?text=${text}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between gap-3 rounded-2xl border border-border/50 bg-card px-5 py-4 transition-colors hover:bg-accent"
    >
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full"
          style={{ background: `#${primaryColor}` }}
        >
          <MessageCircle className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="text-sm font-medium">{t("stage2.askQuestion")}</div>
          <div className="text-xs text-muted-foreground">
            {t("stage2.askQuestionSub")}
          </div>
        </div>
      </div>
    </a>
  );
}
