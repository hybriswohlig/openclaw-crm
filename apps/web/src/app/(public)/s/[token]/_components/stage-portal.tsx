"use client";

import { useCallback, useEffect, useState } from "react";
import type { CustomerPortalContext } from "@openclaw-crm/customer-portal-core";
import { StageHeader } from "./stage-header";
import { StageOneKva } from "./stage-one-kva";
import { StageTwoAb } from "./stage-two-ab";
import { StageThreeLive } from "./stage-three-live";
import { StageFourDone } from "./stage-four-done";
import { portalBrandStyle } from "./portal-presentation";
import { BrandingFooter } from "./branding-footer";
import { useVisitTracker } from "./use-visit-tracker";

/**
 * Stage dispatcher + lightweight client-side refresh on confirmation. Each
 * stage is its own self-contained component so adding Stage 3/4 later doesn't
 * touch this file's structure.
 */
export function StagePortal({
  token,
  ctx: initialCtx,
}: {
  token: string;
  ctx: CustomerPortalContext;
}) {
  const [ctx, setCtx] = useState(initialCtx);

  // Open + duration beacon: tells the operator the customer saw the page and
  // for how long. Drives the share-panel telemetry. See use-visit-tracker.ts.
  useVisitTracker(token, ctx.stage);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/${token}/state`, { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { data: CustomerPortalContext };
      setCtx(json.data);
    } catch {
      // Network blip — keep showing what we have.
    }
  }, [token]);

  // Keep acceptance, document preparation and move-day transitions current.
  // Only poll while visible; returning to the tab refreshes immediately.
  const shouldPoll = ctx.stage < 4;
  useEffect(() => {
    if (!shouldPoll) return;
    const refreshVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const i = window.setInterval(refreshVisible, 30_000);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(i);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [shouldPoll, refresh]);

  return (
    <main className="portal-shell" style={{ ...portalBrandStyle(ctx.branding.primaryColor), "--portal-highlight": ctx.branding.firmaSlug === "kottke" ? "#ff8200" : `#${ctx.branding.primaryColor}` } as React.CSSProperties}>
      <a className="portal-skip" href="#portal-content">Zum Auftragsinhalt</a>
      <StageHeader ctx={ctx} />

      <div id="portal-content" className="portal-content">
        {ctx.stage === 1 && <StageOneKva token={token} ctx={ctx} onConfirmed={refresh} />}
        {ctx.stage === 2 && <StageTwoAb token={token} ctx={ctx} />}
        {ctx.stage === 3 && <StageThreeLive token={token} ctx={ctx} />}
        {ctx.stage === 4 && <StageFourDone token={token} ctx={ctx} />}
      </div>

      <BrandingFooter branding={ctx.branding} />
    </main>
  );
}
