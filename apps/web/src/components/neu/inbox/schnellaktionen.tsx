"use client";

import { useState } from "react";
import { toast } from "sonner";
import { apiAufruf } from "@/components/neu/akte/api";
import type { Kurzfassung } from "@/lib/inbox-neu";
import { SCHNELLAKTION_TEXT, linkFolge, type LinkAntwort } from "./inbox-logik";

/**
 * Die Schnellaktionen zwischen Entwurf-Karte und Antwortfeld (Entscheidung 11).
 * Sie fügen nur ins Antwortfeld ein, senden nie. „Link erneut senden“ holt
 * den Kunden-Link des Deals (idempotent) und baut den KV-Baustein; „Vorlage…“
 * öffnet den Vorlage-Dialog, nur bei einem WABA-Gespräch des Deals.
 */
export function Schnellaktionen({
  dealId,
  kurz,
  onEinfuegen,
  onVorlage,
}: {
  dealId: string | null;
  kurz: Kurzfassung | null;
  onEinfuegen: (text: string) => void;
  onVorlage?: () => void;
}) {
  const [laedt, setLaedt] = useState(false);

  async function linkEinfuegen() {
    if (!dealId || laedt) return;
    setLaedt(true);
    const r = await apiAufruf<LinkAntwort>(`/api/v1/customer-link/${encodeURIComponent(dealId)}`, { method: "POST" });
    setLaedt(false);
    if (!r.ok) {
      toast.error("Kunden-Link konnte nicht geholt werden.", { description: r.message });
      return;
    }
    const folge = linkFolge(r.data ?? { url: null }, kurz ?? { name: "", kunde: { telefon: null, email: null, von: null, nach: null, quelle: null, firma: null } });
    if (folge.art === "text") onEinfuegen(folge.text);
    else toast.message(folge.text);
  }

  return (
    <div className="inbox-schnell" role="group" aria-label="Schnellaktionen">
      <button type="button" className="inbox-chip" onClick={() => onEinfuegen(SCHNELLAKTION_TEXT.termin)}>
        Termin vorschlagen
      </button>
      <button type="button" className="inbox-chip" onClick={() => onEinfuegen(SCHNELLAKTION_TEXT.fotos)}>
        Fotos anfordern
      </button>
      {dealId ? (
        <button type="button" className="inbox-chip" onClick={() => void linkEinfuegen()} disabled={laedt}>
          {laedt ? "Link…" : "Link erneut senden"}
        </button>
      ) : null}
      {onVorlage ? (
        <button type="button" className="inbox-chip" onClick={onVorlage}>
          Vorlage…
        </button>
      ) : null}
    </div>
  );
}
