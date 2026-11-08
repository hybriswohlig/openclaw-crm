"use client";

import Link from "next/link";
import type { KundenAkte } from "@/lib/bewertungen-kunden";
import { datum, firmaKurz, gespraechZiel, KANAL_TEXT } from "./kunden-logik";

/** Gespräche je Firma (Firma des Kanalkontos), neueste zuerst; öffnen die neue Inbox. */
export function KundenakteGespraeche({ gruppen }: { gruppen: KundenAkte["gespraeche"] }) {
  if (gruppen.length === 0) return <p className="kd-leer">Keine Gespräche.</p>;
  return (
    <div className="kd-gespraeche">
      {gruppen.map((g) => (
        <section key={g.firma?.id ?? "ohne"} className="kd-gespraech-gruppe" aria-label={g.firma?.name ?? "Ohne Firma"}>
          <h3 className="kd-gespraech-firma" data-marke={g.firma?.marke ?? undefined}>
            {g.firma ? firmaKurz(g.firma.name) : "Ohne Firma"}
          </h3>
          <ul className="kd-zeilen">
            {g.liste.map((x) => (
              <li key={x.conversationId}>
                <Link href={gespraechZiel(x)} className="kd-gespraech">
                  <span className="kd-gespraech-kanal">{KANAL_TEXT[x.kanal]}</span>
                  <span className="kd-gespraech-konto">{x.konto}</span>
                  <span className="kd-gespraech-zeit">{x.letzteNachrichtAm ? datum(x.letzteNachrichtAm) : ""}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
