"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import {
  ROLLE_LABEL,
  VERTRETEN_ROLLEN,
  type AuftraggeberAnrede,
  type DokumentAnrede,
  type DokumentEmpfaenger,
  type VertretenRolle,
} from "@/lib/dokument-empfaenger";
import { apiAufruf, jsonAufruf } from "./api";

const LEER: DokumentEmpfaenger = { anrede: null, auftraggeber: null, vertretenDurch: null };

/**
 * Auftraggeber auf KV, AB, Rechnung, Statusseite und Unterschrift.
 * Der Ansprechpartner für WhatsApp bleibt der Kontakt im Bereich darüber.
 */
export function DokumentEmpfaengerPanel({ dealId }: { dealId: string }) {
  const [stand, setStand] = useState<DokumentEmpfaenger>(LEER);
  const [anrede, setAnrede] = useState<"" | DokumentAnrede>("");
  const [agAnrede, setAgAnrede] = useState<"" | AuftraggeberAnrede>("");
  const [name, setName] = useState("");
  const [adresse, setAdresse] = useState("");
  const [vertreten, setVertreten] = useState("");
  const [rolle, setRolle] = useState<"" | VertretenRolle>("");
  const [speichert, setSpeichert] = useState(false);

  useEffect(() => {
    let aktiv = true;
    void apiAufruf<DokumentEmpfaenger>(`/api/v1/deals/${dealId}/dokument-empfaenger`).then((r) => {
      if (!aktiv || !r.ok) return;
      const d = r.data ?? LEER;
      setStand(d);
      setAnrede(d.anrede ?? "");
      setAgAnrede(d.auftraggeber?.anrede ?? "");
      setName(d.auftraggeber?.name ?? "");
      setAdresse(d.auftraggeber?.adresse ?? "");
      setVertreten(d.vertretenDurch?.name ?? "");
      setRolle(d.vertretenDurch?.rolle ?? "");
    });
    return () => {
      aktiv = false;
    };
  }, [dealId]);

  async function speichern() {
    setSpeichert(true);
    const body: DokumentEmpfaenger = {
      anrede: anrede || null,
      auftraggeber: name.trim()
        ? { anrede: agAnrede || null, name: name.trim(), adresse: adresse.trim() || null }
        : null,
      vertretenDurch: vertreten.trim() ? { name: vertreten.trim(), rolle: rolle || null } : null,
    };
    const r = await apiAufruf<DokumentEmpfaenger>(
      `/api/v1/deals/${dealId}/dokument-empfaenger`,
      jsonAufruf("PUT", body)
    );
    setSpeichert(false);
    if (!r.ok) {
      toast.error(r.message);
      return;
    }
    setStand(r.data);
    toast.success("Name auf Dokumenten gespeichert.");
  }

  const feld = "h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm";
  return (
    <section className="kunde-dokument" aria-label="Name auf Dokumenten">
      <h3>Name auf Dokumenten</h3>
      <p className="kunde-hinweis">
        Leer lassen: Dokumente und Statusseite nennen den Kontakt. Gesetzt gilt der Name hier als Empfänger, mit der Zeile
        „vertreten durch“. WhatsApp bleibt beim Kontakt. Anrede Standard: Kottke duzt in Vorlagen, Dokumente siezen, bis hier
        Sie oder Du steht.
      </p>
      <div className="kunde-zeilen">
        <label className="kunde-zeile">
          <span>Anrede in Nachrichten</span>
          <select className={feld} value={anrede} onChange={(e) => setAnrede(e.target.value as "" | DokumentAnrede)}>
            <option value="">Standard</option>
            <option value="sie">Sie</option>
            <option value="du">Du</option>
          </select>
        </label>
        <label className="kunde-zeile">
          <span>Auftraggeber</span>
          <input className={feld} value={name} onChange={(e) => setName(e.target.value)} placeholder="Angela Hermann" />
        </label>
        <label className="kunde-zeile">
          <span>Anrede auf dem Dokument</span>
          <select className={feld} value={agAnrede} onChange={(e) => setAgAnrede(e.target.value as "" | AuftraggeberAnrede)}>
            <option value="">neutral</option>
            <option value="frau">Frau</option>
            <option value="herr">Herr</option>
            <option value="neutral">neutral</option>
          </select>
        </label>
        <label className="kunde-zeile">
          <span>Adresse, falls abweichend</span>
          <input className={feld} value={adresse} onChange={(e) => setAdresse(e.target.value)} placeholder="optional" />
        </label>
        <label className="kunde-zeile">
          <span>vertreten durch</span>
          <input className={feld} value={vertreten} onChange={(e) => setVertreten(e.target.value)} placeholder="Elisabeth Bath" />
        </label>
        <label className="kunde-zeile">
          <span>Rolle</span>
          <select className={feld} value={rolle} onChange={(e) => setRolle(e.target.value as "" | VertretenRolle)}>
            <option value="">ohne Rolle</option>
            {VERTRETEN_ROLLEN.map((r) => (
              <option key={r} value={r}>
                {ROLLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="akte-dialog-knoepfe">
        <GlassButton type="button" onClick={() => void speichern()} disabled={speichert} aria-busy={speichert || undefined}>
          {speichert ? "Speichert …" : stand.auftraggeber?.name ? "Aktualisieren" : "Speichern"}
        </GlassButton>
      </div>
    </section>
  );
}
