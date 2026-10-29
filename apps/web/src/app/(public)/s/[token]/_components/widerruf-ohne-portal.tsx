"use client";

import { useRouter } from "next/navigation";
import { WiderrufPanel, type WiderrufPanelKontext } from "./widerruf-panel";

/** Widerrufsbutton auf der Seite „Portal aus“; nach dem Widerruf neu laden. */
export function WiderrufOhnePortal({ token, ctx }: { token: string; ctx: WiderrufPanelKontext }) {
  const router = useRouter();
  return <WiderrufPanel token={token} ctx={ctx} onWiderrufen={() => router.refresh()} />;
}
