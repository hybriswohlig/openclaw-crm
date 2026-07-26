"use client";

import { useParams } from "next/navigation";
import { MessageCircle } from "lucide-react";
import {
  daysUntilMove,
  formatDateLong,
  type CustomerPortalContext,
  type MoveScope,
} from "@openclaw-crm/customer-portal-core";
import { ScopeSummary } from "./scope-summary";
import { MovingChecklist } from "./moving-checklist";
import { PortalRequestForm } from "./portal-request-form";
import { useLocale, useT } from "./portal-i18n";

/**
 * Stage 2: the waiting weeks between the confirmed AB and the move day.
 * Composition:
 *   1. Confirmation banner
 *   2. Move-day card with day-based countdown + planned arrival window,
 *      followed by a reschedule request form (also when the card is hidden)
 *   3. Crew preview
 *   4. Scope summary
 *   5. Preparation checklist (persisted per browser, see moving-checklist.tsx)
 *   6. WhatsApp contact card to the responsible party + question form
 * The AB PDF lives in the portal-wide documents section, not in this stage.
 */
export function StageTwoAb({ ctx }: { ctx: CustomerPortalContext }) {
  const t = useT();
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
        <div className="font-medium">{t("stage2.confirmedTitle")}</div>
        <p className="mt-1 text-xs">
          {t("stage2.confirmedBody")}
          {ctx.documents.orderConfirmationUrl
            ? t("stage2.abBelowSuffix")
            : null}
        </p>
      </div>

      <MoveDayCard
        scope={ctx.scope}
        serverTime={ctx.meta.serverTime}
        primaryColor={ctx.branding.primaryColor}
      />

      <PortalRequestForm
        token={token}
        kind="reschedule"
        triggerLabel={t("stage2.rescheduleTrigger")}
        title={t("stage2.rescheduleTitle")}
        intro={t("stage2.rescheduleIntro")}
        primaryColor={ctx.branding.primaryColor}
      />

      {ctx.crew.length > 0 && (
        <div className="rounded-2xl border border-border/50 bg-card p-5">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("stage2.yourCrew")}
          </div>
          <ul className="mt-3 flex flex-wrap gap-3">
            {ctx.crew.map((c) => (
              <li key={c.employeeId} className="flex items-center gap-3">
                {c.photoBase64DataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.photoBase64DataUrl}
                    alt={c.name}
                    className="h-9 w-9 rounded-full object-cover"
                  />
                ) : (
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-medium text-white"
                    style={{ background: `#${ctx.branding.primaryColor}` }}
                  >
                    {c.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <span className="text-sm">{c.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ScopeSummary scope={ctx.scope} />

      <MovingChecklist token={token} />

      {ctx.branding.whatsappNumberE164 && (
        <WhatsAppCard
          phoneE164={ctx.branding.whatsappNumberE164}
          dealNumber={ctx.dealNumber}
          firma={ctx.branding.displayName}
          primaryColor={ctx.branding.primaryColor}
        />
      )}

      <PortalRequestForm
        token={token}
        kind="question"
        triggerLabel={t("stage2.questionTrigger")}
        title={t("stage2.questionTitle")}
        primaryColor={ctx.branding.primaryColor}
      />
    </section>
  );
}

/**
 * Day-based countdown to the move. Hidden when the date is unset or already
 * in the past. Uses server time so a wrong device clock can't skew the count.
 */
function MoveDayCard({
  scope,
  serverTime,
  primaryColor,
}: {
  scope: MoveScope;
  serverTime: string;
  primaryColor: string;
}) {
  const t = useT();
  const locale = useLocale();
  if (!scope.moveDate) return null;
  const days = daysUntilMove(scope.moveDate, new Date(serverTime));
  if (days == null || days < 0) return null;

  return (
    <div className="rounded-2xl border border-border/50 bg-card p-5">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {t("stage2.moveDay")}
      </div>
      {days >= 2 ? (
        <p className="mt-2 text-base font-medium">
          {t("stage2.daysUntilBefore")}{" "}
          <span
            className="display align-baseline text-5xl font-medium tracking-tight"
            style={{ color: `#${primaryColor}` }}
          >
            {days}
          </span>{" "}
          {t("stage2.daysUntilAfter")}
        </p>
      ) : (
        <p className="display mt-2 text-3xl font-medium tracking-tight">
          {days === 1 ? t("stage2.tomorrow") : t("stage2.today")}
        </p>
      )}
      <div className="mt-3 text-sm">
        <div className="font-medium">
          {formatDateLong(scope.moveDate, locale)}
        </div>
        {scope.timeStart && (
          <div className="mt-0.5 text-muted-foreground">
            {scope.timeEnd
              ? t("stage2.arrivalBetween", {
                  start: scope.timeStart,
                  end: scope.timeEnd,
                })
              : t("stage2.arrivalAround", { start: scope.timeStart })}
          </div>
        )}
      </div>
    </div>
  );
}

function WhatsAppCard({
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
      className="flex items-center gap-3 rounded-2xl border border-border/50 bg-card px-5 py-4 transition-colors hover:bg-accent"
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
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
    </a>
  );
}
