"use client";

import { useEffect, useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import { tagKurz, uhrzeitKurz } from "@/lib/anzeige";
import { apiAufruf, jsonAufruf } from "./api";
import { notizDokument, notizText } from "./notiz-text";

export { notizDokument, notizText };

interface Notiz {
  id: string;
  title: string;
  content: unknown;
  createdAt: string;
  updatedAt: string;
}

type Zustand = { art: "laden" } | { art: "fehler"; meldung: string } | { art: "fertig"; notizen: Notiz[] };

/** Notizen des Deals, neueste zuerst, mit Feld „Notiz hinzufügen“. */
export function NotizenAnsicht({ dealId }: { dealId: string }) {
  const [zustand, setZustand] = useState<Zustand>({ art: "laden" });
  const [text, setText] = useState("");
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const url = `/api/v1/objects/deals/records/${dealId}/notes`;

  useEffect(() => {
    let aktiv = true;
    setZustand({ art: "laden" });
    void apiAufruf<Notiz[]>(url).then((r) => {
      if (!aktiv) return;
      if (!r.ok) {
        setZustand({ art: "fehler", meldung: r.message });
        return;
      }
      setZustand({ art: "fertig", notizen: sortiert(r.data ?? []) });
    });
    return () => {
      aktiv = false;
    };
  }, [url]);

  async function speichern() {
    const inhalt = text.trim();
    if (inhalt === "" || speichert) return;
    setSpeichert(true);
    setFehler(null);
    const r = await apiAufruf<Notiz>(url, jsonAufruf("POST", { title: "", content: notizDokument(inhalt) }));
    setSpeichert(false);
    if (!r.ok) {
      setFehler(`Notiz konnte nicht gespeichert werden. ${r.message}`);
      return;
    }
    setText("");
    setZustand((z) => (z.art === "fertig" ? { art: "fertig", notizen: sortiert([r.data, ...z.notizen]) } : z));
  }

  return (
    <div className="akte-gespraech-ansicht" aria-label="Notizen">
      <div className="akte-gespraech-notiz-neu">
        <label className="sr-only" htmlFor={`notiz-${dealId}`}>
          Notiz hinzufügen
        </label>
        <textarea
          id={`notiz-${dealId}`}
          className="akte-gespraech-feld"
          placeholder="Notiz hinzufügen…"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={speichert}
        />
        {fehler ? (
          <p className="akte-gespraech-fehler" role="alert">
            {fehler}
          </p>
        ) : null}
        <div className="akte-gespraech-notiz-knoepfe">
          <GlassButton size="sm" onClick={() => void speichern()} disabled={speichert || text.trim() === ""}>
            {speichert ? "Speichert…" : "Speichern"}
          </GlassButton>
        </div>
      </div>
      {zustand.art === "laden" ? <p className="akte-gespraech-leer">Notizen werden geladen…</p> : null}
      {zustand.art === "fehler" ? (
        <p className="akte-gespraech-leer" role="alert">
          Notizen konnten nicht geladen werden. {zustand.meldung}
        </p>
      ) : null}
      {zustand.art === "fertig" && zustand.notizen.length === 0 ? (
        <p className="akte-gespraech-leer">Noch keine Notizen.</p>
      ) : null}
      {zustand.art === "fertig" && zustand.notizen.length > 0 ? (
        <ul className="akte-gespraech-liste">
          {zustand.notizen.map((n) => {
            const inhalt = notizText(n.content).trim();
            return (
              <li key={n.id} className="akte-gespraech-zeile akte-gespraech-notiz">
                {n.title.trim() !== "" ? <p className="akte-gespraech-notiz-titel">{n.title}</p> : null}
                {inhalt !== "" ? <p className="akte-gespraech-notiz-text">{inhalt}</p> : null}
                <span className="akte-gespraech-zeile-meta">
                  {tagKurz(n.createdAt)} · {uhrzeitKurz(n.createdAt)}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function sortiert(notizen: Notiz[]): Notiz[] {
  return [...notizen].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
