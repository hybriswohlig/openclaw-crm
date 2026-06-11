"use client";

import { useParams } from "next/navigation";
import { MessageCircle } from "lucide-react";
import {
  daysUntilMove,
  type CustomerPortalContext,
  type MoveScope,
} from "@openclaw-crm/customer-portal-core";
import { ScopeSummary } from "./scope-summary";
import { MovingChecklist } from "./moving-checklist";

/**
 * Stage 2: the waiting weeks between the confirmed AB and the move day.
 * Composition:
 *   1. Confirmation banner
 *   2. Move-day card with day-based countdown + planned arrival window
 *   3. Crew preview
 *   4. Scope summary
 *   5. Preparation checklist (persisted per browser, see moving-checklist.tsx)
 *   6. WhatsApp contact card to the responsible party
 * The AB PDF lives in the portal-wide documents section, not in this stage.
 */
export function StageTwoAb({ ctx }: { ctx: CustomerPortalContext }) {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
        <div className="font-medium">Ihr Auftrag ist bestätigt.</div>
        <p className="mt-1 text-xs">
          Wir freuen uns auf Ihren Umzug. Alle wichtigen Informationen finden
          Sie unten.
          {ctx.documents.orderConfirmationUrl
            ? " Ihre Auftragsbestätigung finden Sie unten unter Ihren Unterlagen."
            : null}
        </p>
      </div>

      <MoveDayCard
        scope={ctx.scope}
        serverTime={ctx.meta.serverTime}
        primaryColor={ctx.branding.primaryColor}
      />

      {ctx.crew.length > 0 && (
        <div className="rounded-2xl border border-border/50 bg-card p-5">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Ihre Crew
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
  if (!scope.moveDate) return null;
  const days = daysUntilMove(scope.moveDate, new Date(serverTime));
  if (days == null || days < 0) return null;

  return (
    <div className="rounded-2xl border border-border/50 bg-card p-5">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Ihr Umzugstag
      </div>
      {days >= 2 ? (
        <p className="mt-2 text-base font-medium">
          Noch{" "}
          <span
            className="display align-baseline text-5xl font-medium tracking-tight"
            style={{ color: `#${primaryColor}` }}
          >
            {days}
          </span>{" "}
          Tage bis zu Ihrem Umzug
        </p>
      ) : (
        <p className="display mt-2 text-3xl font-medium tracking-tight">
          {days === 1 ? "Morgen ist es so weit!" : "Heute ist Ihr Umzugstag!"}
        </p>
      )}
      <div className="mt-3 text-sm">
        <div className="font-medium">{formatGermanDate(scope.moveDate)}</div>
        {scope.timeStart && (
          <div className="mt-0.5 text-muted-foreground">
            {scope.timeEnd
              ? `Ankunft des Teams zwischen ${scope.timeStart} und ${scope.timeEnd} Uhr`
              : `Ankunft gegen ${scope.timeStart} Uhr`}
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
  const text = encodeURIComponent(
    `Hallo ${firma}, ich habe eine Frage zu meinem Umzug ${dealNumber}.`
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
        <div className="text-sm font-medium">Frage stellen</div>
        <div className="text-xs text-muted-foreground">
          Direkt per WhatsApp an Ihren Ansprechpartner
        </div>
      </div>
    </a>
  );
}

function formatGermanDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
