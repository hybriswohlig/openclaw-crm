"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassSwitch } from "@/components/glassyui/glass-switch";
import { tagKurz } from "@/lib/anzeige";
import {
  ABWESENHEIT_TEXT,
  pruefeStammdaten,
  SATZ_ARBEIT_CENT_VORGABE,
  SATZ_FAHRT_CENT_VORGABE,
  type Abwesenheit,
  type EinsatzPerson,
  type KapazitaetTag,
  type StammdatenEingabe,
  type StammdatenFehler,
} from "@/lib/einsatz";
import { AbwesenheitListe } from "./abwesenheit-liste";
import { abwesenheitenLaden, personAendern, personAnlegen } from "./mitarbeiter-api";

const FEHLER_TEXT: Record<StammdatenFehler, string> = {
  NAME_LEER: "Name fehlt.",
  NAME_LANG: "Name ist zu lang (höchstens 80 Zeichen).",
  WOHNORT_LANG: "Ort ist zu lang (höchstens 80 Zeichen).",
  PLZ_UNGUELTIG: "PLZ: fünf Ziffern, z. B. 70176.",
  SATZ_UNGUELTIG: "Sätze zwischen 1 und 200 Euro je Stunde.",
};

interface Form {
  name: string;
  plz: string;
  wohnort: string;
  kannSprinter: boolean;
  eigenerPkw: boolean;
  satzFahrt: string;
  satzArbeit: string;
}

const euroFeld = (cent: number) => (cent / 100).toLocaleString("de-DE", { maximumFractionDigits: 2 });
const centAus = (t: string): number => {
  const n = Number(t.trim().replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN;
};

function formAus(p: EinsatzPerson | null): Form {
  return {
    name: p?.name ?? "",
    plz: p?.plz ?? "",
    wohnort: p?.wohnort ?? "",
    kannSprinter: p?.kannSprinter ?? false,
    eigenerPkw: p?.eigenerPkw ?? false,
    satzFahrt: euroFeld(p?.satzFahrtCent ?? SATZ_FAHRT_CENT_VORGABE),
    satzArbeit: euroFeld(p?.satzArbeitCent ?? SATZ_ARBEIT_CENT_VORGABE),
  };
}

function eingabeAus(f: Form): StammdatenEingabe {
  return {
    name: f.name.trim(),
    plz: f.plz.trim() === "" ? null : f.plz.trim(),
    wohnort: f.wohnort.trim() === "" ? null : f.wohnort.trim(),
    kannSprinter: f.kannSprinter,
    eigenerPkw: f.eigenerPkw,
    satzFahrtCent: centAus(f.satzFahrt),
    satzArbeitCent: centAus(f.satzArbeit),
  };
}

/**
 * Panel einer Person (Plan 12a Task E): Name, PLZ und Ort, Sprinter, eigener
 * PKW, zwei Sätze; Deaktivieren und Reaktivieren mit Rückfrage; Ausnahmen;
 * nächste 14 Tage als Streifen. `person` null = neue Person anlegen.
 */
export function PersonPanel({
  person,
  kapazitaet,
  onGespeichert,
  onAbbrechen,
}: {
  person: EinsatzPerson | null;
  kapazitaet: KapazitaetTag[];
  onGespeichert: (p: EinsatzPerson) => void;
  onAbbrechen?: () => void;
}) {
  const id = useId();
  const [form, setForm] = useState<Form>(() => formAus(person));
  const [speichert, setSpeichert] = useState(false);
  const [rueckfrage, setRueckfrage] = useState(false);
  const [abwesenheiten, setAbwesenheiten] = useState<Abwesenheit[] | null>(null);

  useEffect(() => {
    setForm(formAus(person));
    setRueckfrage(false);
    setAbwesenheiten(null);
    if (!person) return;
    let aktiv = true;
    void abwesenheitenLaden(person.id).then((r) => {
      if (aktiv) setAbwesenheiten(r.ok ? r.data : []);
    });
    return () => {
      aktiv = false;
    };
  }, [person]);

  const eingabe = eingabeAus(form);
  const fehler = pruefeStammdaten(eingabe, person === null);
  const neu = person === null;

  async function speichern() {
    if (fehler) return;
    setSpeichert(true);
    const r = neu ? await personAnlegen(eingabe) : await personAendern(person.id, eingabe);
    setSpeichert(false);
    if (!r.ok) {
      toast.error(neu ? "Person nicht angelegt." : "Änderung nicht gespeichert.", { description: r.message });
      return;
    }
    toast.success(neu ? `${r.data.name} angelegt.` : "Gespeichert.");
    onGespeichert(r.data);
  }

  async function aktivSetzen(aktiv: boolean) {
    if (!person) return;
    setSpeichert(true);
    const r = await personAendern(person.id, { aktiv });
    setSpeichert(false);
    setRueckfrage(false);
    if (!r.ok) {
      toast.error("Nicht umgestellt.", { description: r.message });
      return;
    }
    toast.success(aktiv ? `${r.data.name} ist wieder aktiv.` : `${r.data.name} ist deaktiviert.`);
    onGespeichert(r.data);
  }

  async function abwesenheitenNeu() {
    if (!person) return;
    const r = await abwesenheitenLaden(person.id);
    setAbwesenheiten(r.ok ? r.data : []);
  }

  const feld = (key: keyof Form) => ({
    value: form[key] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  return (
    <div className="ma-panel">
      <div className="ma-abschnitt-kopf">
        <h2 className="ma-panel-titel">{neu ? "Neue Person" : person.name}</h2>
        {!neu && !person.aktiv ? <span className="ez-marke">deaktiviert</span> : null}
      </div>

      <div className="ma-felder">
        <label className="ma-feld ma-feld-breit">
          <span>Name</span>
          <input type="text" maxLength={80} autoComplete="off" {...feld("name")} />
        </label>
        <label className="ma-feld ma-feld-plz">
          <span>PLZ</span>
          <input type="text" inputMode="numeric" maxLength={5} autoComplete="off" {...feld("plz")} />
        </label>
        <label className="ma-feld">
          <span>Ort</span>
          <input type="text" maxLength={80} autoComplete="off" {...feld("wohnort")} />
        </label>
        <p className="ma-hinweis ma-feld-breit">PLZ und Ort, keine Straße. Nur für euch, nie für Bots oder die Mitarbeiter-App.</p>
        <div className="ma-schalter ma-feld-breit">
          <span className="ma-schalter-zeile">
            <GlassSwitch
              size="sm"
              checked={form.kannSprinter}
              onCheckedChange={(v) => setForm((f) => ({ ...f, kannSprinter: v }))}
              aria-labelledby={`${id}-sprinter`}
            />
            <span id={`${id}-sprinter`}>darf Sprinter fahren</span>
          </span>
          <span className="ma-schalter-zeile">
            <GlassSwitch
              size="sm"
              checked={form.eigenerPkw}
              onCheckedChange={(v) => setForm((f) => ({ ...f, eigenerPkw: v }))}
              aria-labelledby={`${id}-pkw`}
            />
            <span id={`${id}-pkw`}>kommt mit eigenem PKW</span>
          </span>
        </div>
        <label className="ma-feld">
          <span>Satz Arbeit, € je Stunde</span>
          <input type="text" inputMode="decimal" {...feld("satzArbeit")} />
        </label>
        <label className="ma-feld">
          <span>Satz Fahrt, € je Stunde</span>
          <input type="text" inputMode="decimal" {...feld("satzFahrt")} />
        </label>
      </div>
      {fehler && (form.name.trim() !== "" || !neu) ? <p className="ma-fehler">{FEHLER_TEXT[fehler]}</p> : null}

      <div className="ma-knoepfe">
        {neu && onAbbrechen ? (
          <GlassButton type="button" variant="ghost" onClick={onAbbrechen} disabled={speichert}>
            Abbrechen
          </GlassButton>
        ) : null}
        <GlassButton type="button" onClick={() => void speichern()} disabled={!!fehler || speichert} aria-busy={speichert || undefined}>
          {speichert ? "Speichert …" : neu ? "Anlegen" : "Speichern"}
        </GlassButton>
      </div>

      {!neu ? (
        <>
          <Streifen personId={person.id} kapazitaet={kapazitaet} />
          {abwesenheiten === null ? (
            <p className="ma-leer">Abwesenheiten werden geladen …</p>
          ) : (
            <AbwesenheitListe employeeId={person.id} liste={abwesenheiten} onGeaendert={abwesenheitenNeu} />
          )}
          <div className="ma-abschnitt">
            <div className="ma-abschnitt-kopf">
              <h3>{person.aktiv ? "Deaktivieren" : "Reaktivieren"}</h3>
            </div>
            <p className="ma-hinweis">
              {person.aktiv
                ? "Deaktivierte Personen zählen nicht mehr in Kapazität und Vorschlag. Login, Zeiten und Saldo bleiben."
                : "Wieder aktiv: zählt in Kapazität und Vorschlag."}
            </p>
            {rueckfrage ? (
              <div className="ez-rueckfrage" role="alertdialog" aria-label="Rückfrage">
                <i aria-hidden="true" />
                <p>
                  {person.aktiv
                    ? `${person.name} deaktivieren? Bestehende Einsätze bleiben, neu einteilen geht nicht mehr.`
                    : `${person.name} wieder aktivieren?`}
                </p>
                <div className="ez-rueckfrage-knoepfe">
                  <GlassButton type="button" size="sm" variant="ghost" onClick={() => setRueckfrage(false)}>
                    Abbrechen
                  </GlassButton>
                  <GlassButton type="button" size="sm" onClick={() => void aktivSetzen(!person.aktiv)} disabled={speichert}>
                    {person.aktiv ? "Deaktivieren" : "Reaktivieren"}
                  </GlassButton>
                </div>
              </div>
            ) : (
              <GlassButton type="button" size="sm" variant="ghost" onClick={() => setRueckfrage(true)}>
                {person.aktiv ? "Deaktivieren …" : "Reaktivieren …"}
              </GlassButton>
            )}
          </div>
          <p className="ma-hinweis ma-alt">
            Login, Saldo und Buchungsverlauf: <Link href="/employees">in der alten Oberfläche</Link>.
          </p>
        </>
      ) : null}
    </div>
  );
}

/** Nächste 14 Tage: frei, abwesend mit Art, belegt mit Link auf den Auftrag. */
function Streifen({ personId, kapazitaet }: { personId: string; kapazitaet: KapazitaetTag[] }) {
  if (kapazitaet.length === 0) return null;
  return (
    <div className="ma-abschnitt">
      <div className="ma-abschnitt-kopf">
        <h3>Nächste 14 Tage</h3>
      </div>
      <ol className="ma-streifen">
        {kapazitaet.map((k) => {
          const ab = k.abwesend.find((a) => a.person.id === personId);
          const belegt = k.belegt.find((b) => b.person.id === personId);
          const lage = ab ? "abwesend" : belegt ? "belegt" : k.frei.some((f) => f.id === personId) ? "frei" : "keine";
          return (
            <li key={k.tag} className="ma-tag" data-lage={lage}>
              <span className="ma-tag-datum">{tagKurz(k.tag)}</span>
              {ab ? <span className="ma-tag-text">{ABWESENHEIT_TEXT[ab.art]}</span> : null}
              {belegt
                ? belegt.deals.map((d) => (
                    <Link key={d.dealId} href={`/app/leads/${d.dealId}`} className="ma-tag-text ma-tag-link">
                      {d.titel}
                    </Link>
                  ))
                : null}
              {lage === "frei" ? <span className="ma-tag-text">frei</span> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
