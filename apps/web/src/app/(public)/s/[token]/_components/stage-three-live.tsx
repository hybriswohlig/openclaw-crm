"use client";

import { useMemo } from "react";
import { MessageCircle } from "lucide-react";
import type { CustomerPortalContext } from "@openclaw-crm/customer-portal-core";
import { LiveMediaFeed } from "./live-media-feed";
import { HourlyClock } from "./hourly-clock";

/**
 * Stage 3 — during the move. Composition:
 *   1. "Now happening" header with the most-recent timing milestone
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
  const headline = useMemo(() => headlineForStage(ctx), [ctx]);
  const isHourly = !!ctx.kva?.isVariable;

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-border/50 bg-card p-5">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Aktueller Status
        </div>
        <div className="mt-1 text-base font-medium">{headline}</div>
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

function headlineForStage(ctx: CustomerPortalContext): string {
  if (ctx.timing.finishedAt) return "Umzug abgeschlossen. Aufräumen läuft.";
  if (ctx.timing.onsiteAt) return "Die Crew ist vor Ort und arbeitet.";
  if (ctx.timing.departureAt) return "Die Crew ist auf dem Weg zur Abholadresse.";
  return "Der Umzug läuft.";
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
          <div className="text-sm font-medium">Frage stellen</div>
          <div className="text-xs text-muted-foreground">
            Direkt per WhatsApp an Ihren Ansprechpartner
          </div>
        </div>
      </div>
    </a>
  );
}
