"use client";

import { useState } from "react";
import { Download, ExternalLink, PenLine } from "lucide-react";
import {
  BUTTON_VERTRAG_UNTERSCHREIBEN,
  UNTERSCHRIFT_HINWEIS,
  unterschriftMoeglich,
  type CustomerPortalContext,
} from "@openclaw-crm/customer-portal-core";
import { PanelHeading } from "./portal-ui";
import { UnterschriftForm } from "./unterschrift-form";

/**
 * Freiwillige Unterschrift als Nebenaktion auf jeder Stufe, unter dem
 * Auftragsinhalt (Anzahlung und Rechnung haben Vorrang). Nach der
 * Unterschrift zeigt das Panel in Stufe 1 den Vertrag selbst an; ab Stufe 2
 * steht er in „Ihre Dokumente“.
 */
export function UnterschriftPanel({
  token,
  ctx,
  onSigned,
}: {
  token: string;
  ctx: CustomerPortalContext;
  onSigned: () => void | Promise<void>;
}) {
  const [offen, setOffen] = useState(false);
  const moeglich = unterschriftMoeglich({ acceptance: ctx.acceptance, signatureEnabled: ctx.features?.signature === true });
  const vertragUrl = ctx.documents.signedContractUrl;

  if (!moeglich) {
    if (!vertragUrl || !ctx.acceptance?.unterschrift || ctx.stage > 1) return null;
    return (
      <section className="portal-panel mt-6" aria-live="polite">
        <PanelHeading icon={PenLine} title="Ihr unterschriebener Vertrag">
          <p>Unterschrieben am {new Date(ctx.acceptance.unterschrift.at).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}.</p>
        </PanelHeading>
        <div className="portal-document-actions">
          <a className="portal-button" href={vertragUrl} download>
            <Download size={18} aria-hidden />
            Vertrag als PDF herunterladen
          </a>
          <a className="portal-button portal-button-secondary" href={vertragUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={17} aria-hidden />
            PDF öffnen
          </a>
        </div>
      </section>
    );
  }

  return (
    <section className="portal-panel portal-note mt-6">
      <PanelHeading icon={PenLine} title={BUTTON_VERTRAG_UNTERSCHREIBEN}>
        {/* Geöffnet zeigt das Formular den Hinweis selbst. */}
        {!offen && <p>{UNTERSCHRIFT_HINWEIS}</p>}
      </PanelHeading>
      {offen ? (
        <UnterschriftForm token={token} ctx={ctx} onSigned={onSigned} />
      ) : (
        <button type="button" onClick={() => setOffen(true)} className="portal-button portal-button-secondary">
          <PenLine size={17} aria-hidden />
          {BUTTON_VERTRAG_UNTERSCHREIBEN}
        </button>
      )}
    </section>
  );
}
