/**
 * Beispieldaten für Entwicklung und Tests der Seite Einstellungen (Plan 13):
 * Admin mit zwei Firmen (Ceylan ohne Google-Link), Member, Rechner-Fehler.
 */
import { ZAHLUNGSREGEL_STANDARD } from "@/lib/geld";
import type { EinstellungenAntwort, RechnerStammdatenAntwort } from "@/lib/einstellungen-uebersicht";

export const FIXTURE_ADMIN: EinstellungenAntwort = {
  ich: { darstellung: "system", kalender: { pfad: "/api/calendar/ics/beispiel.ics", erstelltAm: "2026-10-01T08:00:00.000Z" } },
  admin: true,
  firmen: [
    {
      id: "oc-ceylan",
      name: "Ceylan Transporte",
      marke: "ceylan",
      zahlung: { ...ZAHLUNGSREGEL_STANDARD },
      bewertung: { modus: "aus", seit: null, hakenPortal: false },
      googleReviewUrl: null,
      portal: { enabled: true, signatureEnabled: false, angebotAusKalkulation: false, tagespreiseEnabled: false },
      pakete: [],
      zeitposten: [],
      einsatz: { buchungImPreis: false },
    },
    {
      id: "oc-kottke",
      name: "Kottke Umzüge",
      marke: "kottke",
      zahlung: { basis: "umzugstag", tage: 0, erinnerungModus: "entwurf", erinnerungTage: 7, erinnerung2Tage: 14 },
      bewertung: { modus: "entwurf", seit: "2026-11-01T09:00:00.000Z", hakenPortal: true },
      googleReviewUrl: "https://g.page/r/kottke/review",
      portal: { enabled: true, signatureEnabled: true, angebotAusKalkulation: true, tagespreiseEnabled: true },
      pakete: [
        { id: "p1", slug: "basis", name: "Basis", aktiv: true, hebel: [] },
        { id: "p2", slug: "komfort", name: "Komfort", aktiv: true, hebel: ["montage", "einpacken"] },
      ],
      zeitposten: [
        { id: "zp-1", bezeichnung: "Klavier tragen", minuten: 90 },
        { id: "zp-2", bezeichnung: "Küche abbauen", minuten: 240, hinweis: "je Zeile" },
      ],
      einsatz: { buchungImPreis: true },
    },
  ],
  apiSchluessel: [
    {
      id: "k1",
      name: "MCP",
      prefix: "ock_ab12",
      zugriff: "voll",
      erstelltAm: "2026-01-01T00:00:00.000Z",
      zuletztBenutztAm: "2026-11-07T10:00:00.000Z",
      laeuftAbAm: null,
      abgelaufen: false,
      ungenutzt: false,
    },
  ],
};

export const FIXTURE_MEMBER: EinstellungenAntwort = { ...FIXTURE_ADMIN, admin: false, firmen: null, apiSchluessel: null };

export const FIXTURE_RECHNER_FEHLER: RechnerStammdatenAntwort = { ok: false, fehler: "Rechner nicht erreichbar." };
