/**
 * Texte der Seite Einstellungen (Plan 13, Entscheidung 6). Interne Oberfläche:
 * kein Sie oder du je Firma. Rückfragen nennen in einem Satz, was Kunden
 * danach sehen. Ausschalten fragt nicht.
 */

export interface RueckfrageText {
  titel: string;
  text: string;
  knopf: string;
}

export type RueckfrageArt =
  | "unterschrift"
  | "angebotAusKalkulation"
  | "tagespreise"
  | "erinnerung"
  | "bewertungEntwurf"
  | "hakenPortal"
  | "googleLink"
  | "mietanteil"
  | "kalenderNeu"
  | "kalenderEnde";

export const RUECKFRAGE: Record<RueckfrageArt, RueckfrageText> = {
  unterschrift: {
    titel: "Unterschrift im Portal einschalten?",
    text: "Kunden unterschreiben das Angebot danach direkt im Portal, bevor es als angenommen gilt.",
    knopf: "Einschalten",
  },
  angebotAusKalkulation: {
    titel: "Angebot aus der Kalkulation einschalten?",
    text: "Kunden sehen im Portal danach das Angebot mit den Posten aus der freigegebenen Kalkulation.",
    knopf: "Einschalten",
  },
  tagespreise: {
    titel: "Tagespreise einschalten?",
    text: "Kunden sehen bei der Terminwahl danach je Tag einen eigenen Preis.",
    knopf: "Einschalten",
  },
  erinnerung: {
    titel: "Zahlungserinnerung als Entwurf einschalten?",
    text: "Fällige Erinnerungen liegen danach als Entwurf zur Freigabe bereit. Kunden bekommen erst etwas, wenn jemand den Entwurf sendet.",
    knopf: "Einschalten",
  },
  bewertungEntwurf: {
    titel: "Bewertungs-Entwürfe einschalten?",
    text: "Fällige Bewertungsanfragen erscheinen danach zur Freigabe. Kunden bekommen erst etwas, wenn jemand freigibt.",
    knopf: "Einschalten",
  },
  hakenPortal: {
    titel: "Einwilligung im Portal abfragen?",
    text: "Kunden sehen bei der Annahme im Portal danach einen Haken, mit dem sie einer Bewertungsanfrage zustimmen.",
    knopf: "Einschalten",
  },
  googleLink: {
    titel: "Google-Link speichern?",
    text: "Bewertungsanfragen an Kunden führen danach auf diesen Link.",
    knopf: "Speichern",
  },
  mietanteil: {
    titel: "Mietanteil in den Preis nehmen?",
    text: "Der Anteil einer gebuchten Transporter-Miete steckt danach im Preis, den Kunden im Angebot sehen.",
    knopf: "Einschalten",
  },
  kalenderNeu: {
    titel: "Neuen Abo-Link erstellen?",
    text: "Der alte Link hört sofort auf zu funktionieren. Kalender mit dem alten Link zeigen keine Termine mehr.",
    knopf: "Neuer Link",
  },
  kalenderEnde: {
    titel: "Kalender-Abo beenden?",
    text: "Der Link hört sofort auf zu funktionieren. Kalender mit diesem Link zeigen keine Termine mehr.",
    knopf: "Abo beenden",
  },
};

export const TEXT = {
  titel: "Einstellungen",
  zweite: "Für dich, für die Firmen, Rechner und Zugänge",
  zweiteMember: "Darstellung und Kalender-Abo",
  laden: "Einstellungen werden geladen",
  ladeFehler: "Einstellungen konnten nicht geladen werden.",
  erneut: "Erneut versuchen",
  speichern: "Speichern",
  gespeichert: "Gespeichert.",
  nichtGespeichert: "Nicht gespeichert.",

  abschnittIch: "Für mich",
  abschnittFirmen: "Firmen",
  abschnittRechner: "Rechner",
  abschnittZugaenge: "Zugänge",

  darstellung: "Darstellung",
  darstellungSatz: "Gilt nur für dieses Konto. Kundenportal und PDFs bleiben immer hell.",
  kalender: "Kalender-Abo",
  kalenderSatz: "Deine Termine im Handy- oder Bürokalender. Der Link ist persönlich, gib ihn nicht weiter.",
  kalenderErstellen: "Abo-Link erstellen",
  kalenderAlle: "Alle Firmen",
  kalenderKopieren: "Kopieren",
  kalenderKopiert: "Link kopiert.",
  kalenderOeffnen: "In Kalender öffnen",
  kalenderNeu: "Neuer Link",
  kalenderEnde: "Abo beenden",
  kalenderSeit: "Erstellt am",

  zahlung: "Zahlung",
  zahlungBasis: "Zahlungsziel ab",
  zahlungBasisUmzug: "Umzugstag",
  zahlungBasisRechnung: "Rechnungstag",
  zahlungTage: "Tage danach",
  zahlungErinnerung: "Erinnerung",
  zahlungErinnerungAus: "Aus",
  zahlungErinnerungEntwurf: "Entwurf",
  zahlungErste: "Erste nach Tagen",
  zahlungZweite: "Zweite nach Tagen",
  zahlungBereich: "Ganze Zahl von {von} bis {bis}.",

  bewertung: "Bewertungen",
  bewertungSeit: "Eingeschaltet seit",
  bewertungSeite: "Liste der Bewertungen",
  googleLink: "Google-Bewertungslink",
  googleTesten: "Testen",
  googlePlatzhalter: "https://g.page/r/…",
  googleOhne: "Ohne gültigen Google-Link bleiben Entwurf und Senden gesperrt.",

  portal: "Kundenportal",
  portalAus: "Das Portal dieser Firma ist aus. Die Schalter wirken erst, wenn es in der alten Oberfläche eingeschaltet ist.",
  unterschrift: "Unterschrift im Portal",
  angebotAusKalkulation: "Angebot aus Kalkulation",
  tagespreise: "Tagespreise",
  tagespreiseGesperrt: "Erst Angebot aus Kalkulation einschalten.",

  pakete: "Pakete und Hebel",
  paketeSatz: "Welche Leistungen der Paketpreis enthält. Pakete anlegen und Texte: alte Oberfläche.",
  paketeLeer: "Keine Pakete angelegt.",
  paketAktiv: "aktiv",

  zeitposten: "Zeitposten",
  zeitpostenSatz: "Vorlagen für die Kalkulation, in Personenminuten.",
  zeitpostenLeer: "Noch keine Zeitposten.",
  zeitpostenNeu: "Zeitposten hinzufügen",
  zeitpostenBezeichnung: "Bezeichnung",
  zeitpostenMinuten: "Minuten",
  zeitpostenHinweis: "Hinweis",
  zeitpostenHoch: "Nach oben",
  zeitpostenRunter: "Nach unten",
  zeitpostenEntfernen: "Entfernen",
  zeitpostenMax: "Höchstens 50 Zeitposten.",

  einsatz: "Einsatz",
  mietanteil: "Mietanteil im Preis",
  mietanteilSatz: "Gebuchte Transporter-Miete anteilig im Angebotspreis. Mitarbeiter und Sätze pflegst du unter",
  mitarbeiter: "Mitarbeiter",

  marke: "Rechner-Tarif",
  markeGemeinsam: "gemeinsamer Tarif",
  markeSatz: "Ändert die Preise, deshalb nur über die API.",

  rechnerSatz: "Nur lesen. Geändert wird im Rechner.",
  rechnerOeffnen: "Rechner öffnen",
  rechnerLaden: "Rechner-Daten werden geladen",
  rechnerErneut: "Erneut laden",
  rechnerFrueher: "Frühere Versionen",
  rechnerStationen: "Stationen",
  rechnerFahrzeuge: "Fahrzeuge",
  rechnerKeinTarif: "Kein aktiver Tarif.",

  schluessel: "API-Schlüssel",
  schluesselSatz: "Nur lesen. Anlegen und widerrufen in der alten Oberfläche.",
  schluesselLeer: "Keine API-Schlüssel.",
  schluesselVerwalten: "Schlüssel verwalten",
  schluesselAbgelaufen: "abgelaufen",
  schluesselUngenutzt: "seit 30 Tagen ungenutzt",

  alt: "Weitere Einstellungen in der alten Oberfläche",
} as const;

/** Links im Kasten unten (Entscheidung 3). */
export const ALTE_SEITEN: { href: string; label: string }[] = [
  { href: "/settings/whatsapp", label: "WhatsApp" },
  { href: "/integrations", label: "E-Mail und Integrationen" },
  { href: "/settings/members", label: "Nutzer" },
  { href: "/settings/ai", label: "KI" },
  { href: "/settings/customer-portal", label: "Kundenportal: Pakete anlegen, Texte, Domain, Bank, AGB" },
  { href: "/settings/api-keys", label: "API-Schlüssel anlegen und widerrufen" },
];
