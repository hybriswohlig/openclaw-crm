"use client";

import "@/styles/neu-neuer-lead.css";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type FormEvent } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import { apiAufruf, jsonAufruf } from "@/components/neu/akte/api";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import { SOURCE_CHANNEL_OPTIONS } from "@/lib/deal-source";
import { kundeLink, type Karte, type NeuerLeadFeld, type PersonWahl } from "@/lib/handy-links";
import { leeresFormular, neuerLeadErgebnis, neuerLeadKoerper, type NeuerLeadFormular } from "./neuer-lead-logik";

type Firmen = { art: "laden" } | { art: "fehler"; text: string } | { art: "fertig"; liste: Karte[] };

/**
 * Dialog „Neuer Lead“ (Plan 10, Entscheidung 10): Name, Telefon oder E-Mail,
 * Firma, Quelle, Umzugsdatum. Gibt es zur Nummer schon Kunden, fragt der
 * Dialog nach (an einen davon oder neue Person); nach Erfolg geht es zur Akte.
 */
export function NeuerLeadDialog({ offen, onClose }: { offen: boolean; onClose: () => void }) {
  return offen ? <Inhalt onClose={onClose} /> : null;
}

function Inhalt({ onClose }: { onClose: () => void }) {
  const id = useId();
  const router = useRouter();
  const portalZiel = usePortalZiel();
  const [firmen, setFirmen] = useState<Firmen>({ art: "laden" });
  const [f, setF] = useState<NeuerLeadFormular>(() => leeresFormular([]));
  const [treffer, setTreffer] = useState<Karte[] | null>(null);
  const [wahl, setWahl] = useState<string | null>(null);
  const [fehler, setFehler] = useState<{ feld: NeuerLeadFeld | null; text: string } | null>(null);
  const [sendet, setSendet] = useState(false);

  useEffect(() => {
    let aktiv = true;
    void apiAufruf<Karte[]>("/api/v1/operating-companies").then((r) => {
      if (!aktiv) return;
      if (!r.ok) {
        setFirmen({ art: "fehler", text: r.message });
        return;
      }
      const liste = Array.isArray(r.data) ? r.data : [];
      setFirmen({ art: "fertig", liste });
      if (liste.length === 1) setF((alt) => (alt.firmaId ? alt : { ...alt, firmaId: liste[0].id }));
    });
    return () => {
      aktiv = false;
    };
  }, []);

  function setze<K extends keyof NeuerLeadFormular>(k: K, v: NeuerLeadFormular[K]) {
    setF((alt) => ({ ...alt, [k]: v }));
    // Eine neue Nummer macht die alte Rückfrage hinfällig.
    if (k === "telefon") {
      setTreffer(null);
      setWahl(null);
    }
  }

  async function absenden(e: FormEvent) {
    e.preventDefault();
    let personWahl: PersonWahl | null = null;
    if (treffer) {
      if (!wahl) {
        setFehler({ feld: "personWahl", text: "Bitte wählen: bestehender Kunde oder neue Person." });
        return;
      }
      personWahl = wahl === "neu" ? { art: "neu" } : { art: "bestehend", personId: wahl };
    }
    const k = neuerLeadKoerper(f, personWahl);
    if (!k.ok) {
      setFehler({ feld: k.feld, text: k.text });
      return;
    }
    setFehler(null);
    setSendet(true);
    let status = 0;
    let body: unknown = null;
    try {
      const res = await fetch("/api/v1/leads", jsonAufruf("POST", k.koerper));
      status = res.status;
      body = await res.json().catch(() => null);
    } catch {
      status = 0;
    }
    const r = neuerLeadErgebnis(status, body);
    if (r.art === "fertig") {
      router.push(`/app/leads/${encodeURIComponent(r.dealRecordId)}`);
      onClose();
      return;
    }
    setSendet(false);
    if (r.art === "rueckfrage") {
      setTreffer(r.treffer);
      setWahl(null);
      setFehler(
        r.treffer.length === 0 ? { feld: "personWahl", text: "Der gewählte Kunde passt nicht mehr zur Nummer. Bitte neu wählen." } : null
      );
      return;
    }
    setFehler({ feld: r.art === "feld" ? r.feld : null, text: r.text });
  }

  const feldFehler = (feld: NeuerLeadFeld) => (fehler?.feld === feld ? fehler.text : null);
  const fehlerId = (feld: NeuerLeadFeld) => (fehler?.feld === feld ? `${id}-fehler` : undefined);
  const firmenListe = firmen.art === "fertig" ? firmen.liste : [];

  return (
    <GlassDialog open onOpenChange={(o) => !o && !sendet && onClose()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen" className="neuer-lead">
        <GlassDialogTitle className="akte-dialog-titel">Neuer Lead</GlassDialogTitle>
        <GlassDialogDescription className="akte-dialog-text">
          Telefon oder E-Mail reicht. Gibt es die Nummer schon, fragt das CRM nach.
        </GlassDialogDescription>

        <form onSubmit={(e) => void absenden(e)} noValidate>
          <fieldset className="neuer-lead-felder" disabled={sendet}>
            <label className="akte-dialog-feld">
              Name
              <input
                className="lg-input"
                type="text"
                value={f.name}
                onChange={(e) => setze("name", e.target.value)}
                maxLength={120}
                autoComplete="off"
                aria-invalid={feldFehler("name") ? true : undefined}
                aria-describedby={fehlerId("name")}
              />
            </label>
            <div className="akte-dialog-zeile">
              <label className="akte-dialog-feld">
                Telefon
                <input
                  className="lg-input"
                  type="tel"
                  inputMode="tel"
                  value={f.telefon}
                  onChange={(e) => setze("telefon", e.target.value)}
                  maxLength={32}
                  autoComplete="off"
                  aria-invalid={feldFehler("kontakt") ? true : undefined}
                  aria-describedby={fehlerId("kontakt")}
                />
              </label>
              <label className="akte-dialog-feld">
                E-Mail
                <input
                  className="lg-input"
                  type="email"
                  inputMode="email"
                  value={f.email}
                  onChange={(e) => setze("email", e.target.value)}
                  maxLength={200}
                  autoComplete="off"
                  aria-invalid={feldFehler("email") || feldFehler("kontakt") ? true : undefined}
                  aria-describedby={fehlerId("email") ?? fehlerId("kontakt")}
                />
              </label>
            </div>
            <div className="akte-dialog-zeile">
              <label className="akte-dialog-feld">
                Firma
                <select
                  className="lg-input"
                  value={f.firmaId}
                  onChange={(e) => setze("firmaId", e.target.value)}
                  aria-invalid={feldFehler("firma") ? true : undefined}
                  aria-describedby={fehlerId("firma")}
                >
                  <option value="">{firmen.art === "laden" ? "Wird geladen" : "Bitte wählen"}</option>
                  {firmenListe.map((firma) => (
                    <option key={firma.id} value={firma.id}>
                      {firma.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="akte-dialog-feld">
                Quelle
                <select
                  className="lg-input"
                  value={f.quelle}
                  onChange={(e) => setze("quelle", e.target.value)}
                  aria-invalid={feldFehler("quelle") ? true : undefined}
                  aria-describedby={fehlerId("quelle")}
                >
                  {SOURCE_CHANNEL_OPTIONS.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="akte-dialog-feld neuer-lead-datum">
              Umzugsdatum (optional)
              <input
                className="lg-input"
                type="date"
                value={f.umzugsdatum}
                onChange={(e) => setze("umzugsdatum", e.target.value)}
                aria-invalid={feldFehler("umzugsdatum") ? true : undefined}
                aria-describedby={fehlerId("umzugsdatum")}
              />
            </label>
          </fieldset>

          {firmen.art === "fehler" ? <p className="akte-dialog-fehler">Firmen konnten nicht geladen werden. {firmen.text}</p> : null}

          {treffer && treffer.length > 0 ? (
            <fieldset className="neuer-lead-treffer" disabled={sendet}>
              <legend>Zu dieser Nummer gibt es schon {treffer.length === 1 ? "einen Kunden" : `${treffer.length} Kunden`}.</legend>
              {treffer.map((t) => (
                <div key={t.id} className="neuer-lead-treffer-zeile">
                  <label>
                    <input type="radio" name={`${id}-wahl`} value={t.id} checked={wahl === t.id} onChange={() => setWahl(t.id)} />
                    <span>An diesen Kunden: {t.name}</span>
                  </label>
                  <Link href={kundeLink(t.id)} target="_blank" rel="noopener">
                    ansehen
                  </Link>
                </div>
              ))}
              <div className="neuer-lead-treffer-zeile">
                <label>
                  <input type="radio" name={`${id}-wahl`} value="neu" checked={wahl === "neu"} onChange={() => setWahl("neu")} />
                  <span>Neue Person</span>
                </label>
              </div>
            </fieldset>
          ) : null}

          {fehler ? (
            <p id={`${id}-fehler`} className="akte-dialog-fehler" role="alert">
              {fehler.text}
            </p>
          ) : null}
          <div className="akte-dialog-knoepfe">
            <GlassButton type="button" variant="ghost" onClick={onClose} disabled={sendet}>
              Abbrechen
            </GlassButton>
            <GlassButton type="submit" disabled={sendet}>
              {sendet ? "Legt an" : "Lead anlegen"}
            </GlassButton>
          </div>
        </form>
      </GlassDialogContent>
    </GlassDialog>
  );
}
