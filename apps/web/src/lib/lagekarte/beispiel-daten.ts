/**
 * Lagekarte: erfundene Beispieldaten (keine echten Kunden) für Vorschau,
 * Komponentenentwicklung und Tests. Deterministisch.
 */
import type {
  ChatKurz,
  ChatNachricht,
  ChatVorschauAntwort,
  KartenStatus,
  LagekarteAntwort,
  LeadPunkt,
  Mission,
  VerlaufAntwort,
  VerlaufMeilenstein,
} from "./typen";

const FIRMEN = [
  { id: "firma-kottke", name: "Kottke-Umzüge", kurz: "K", farbe: "#1f3a5f" },
  { id: "firma-ceylan", name: "Ceylan Operations", kurz: "C", farbe: "#ea580c" },
];

const ORTE: Array<[string, string, number, number, string]> = [
  ["70176", "Stuttgart-West", 48.7718, 9.1686, "08111"],
  ["70173", "Stuttgart", 48.7726, 9.18, "08111"],
  ["70597", "Stuttgart-Degerloch", 48.7446, 9.1597, "08111"],
  ["71034", "Böblingen", 48.6902, 8.9705, "08115"],
  ["71063", "Sindelfingen", 48.7099, 9.003, "08115"],
  ["71638", "Ludwigsburg", 48.8975, 9.1919, "08118"],
  ["72218", "Wildberg", 48.6234, 8.7452, "08235"],
  ["72202", "Nagold", 48.5498, 8.7237, "08235"],
  ["75365", "Calw", 48.7148, 8.7406, "08235"],
  ["72070", "Tübingen", 48.5216, 9.0576, "08416"],
  ["72764", "Reutlingen", 48.4914, 9.2043, "08415"],
  ["75172", "Pforzheim", 48.8919, 8.6985, "08231"],
  ["73728", "Esslingen am Neckar", 48.7406, 9.3108, "08116"],
  ["76133", "Karlsruhe", 49.0094, 8.4044, "08212"],
];

const NAMEN = [
  "Familie Albrecht", "Herr Brenner", "Frau Celik", "Familie Demir", "Herr Engel", "Frau Fischer",
  "Herr Graf", "Familie Haas", "Frau Ilić", "Herr Jäger", "Frau Kaya", "Familie Lorenz",
  "Herr Maier", "Frau Neumann", "Familie Özdemir", "Herr Pfeiffer", "Frau Quast", "Herr Roth",
  "Familie Schäfer", "Frau Tran", "Herr Ulrich", "Familie Vogel", "Frau Weber", "Herr Yilmaz",
  "Familie Zimmer", "Frau Arnold", "Herr Bauer", "Familie Conrad", "Frau Dietz", "Herr Ebert",
];

const STATUS_FOLGE: KartenStatus[] = [
  "neu", "kontakt", "kontakt", "angebot", "auftrag", "kontakt", "erledigt", "angebot", "neu", "auftrag",
  "kontakt", "verloren", "angebot", "erledigt", "kontakt",
];

const TAG = 24 * 60 * 60 * 1000;

function isoTag(jetzt: Date, tage: number): string {
  return new Date(jetzt.getTime() + tage * TAG).toISOString().slice(0, 10);
}

export function beispielAntwort(jetzt: Date = new Date("2026-10-08T07:30:00+02:00")): LagekarteAntwort {
  const leads: LeadPunkt[] = NAMEN.map((name, i) => {
    const status = STATUS_FOLGE[i % STATUS_FOLGE.length];
    const ortRoh = i % 7 === 6 ? null : ORTE[i % ORTE.length];
    const zielRoh = ORTE[(i * 5 + 3) % ORTE.length];
    const firma = FIRMEN[i % 3 === 2 ? 1 : 0];
    const angelegt = new Date(jetzt.getTime() - (i * 2.3 + 0.2) * TAG);
    const wertCent =
      status === "auftrag" || status === "erledigt"
        ? 89000 + i * 13700
        : status === "angebot"
          ? 64000 + i * 9100
          : i % 3 === 0
            ? 120000
            : null;
    const wartetAntwort = (status === "kontakt" || status === "angebot") && i % 4 === 1;
    const wartetNeu = status === "neu" && i < 10;
    const chatId = `chat-${i}`;
    const versatz = ((i * 37) % 11) / 1000;
    return {
      id: `lead-${i}`,
      nummer: `2026-${String(40 + i).padStart(4, "0")}`,
      name,
      angelegtAm: angelegt.toISOString(),
      umzugAm: status === "auftrag" || status === "erledigt" || i % 5 === 0 ? isoTag(jetzt, (i % 9) - 2) : null,
      firmaId: i === 13 ? null : firma.id,
      stufe: null,
      status,
      statusHinweis: status === "auftrag" && i % 2 === 0 ? "KV angenommen, Stufe noch „In Kontakt“" : null,
      zahlungOffen: status === "erledigt" && i % 2 === 0,
      ort: ortRoh
        ? {
            lat: ortRoh[2] + versatz,
            lng: ortRoh[3] - versatz,
            plz: ortRoh[0],
            ortsname: ortRoh[1],
            kreisAgs: ortRoh[4],
            genauigkeit: "plz",
            quelle: i % 4 === 3 ? "immoscout" : "abholadresse",
          }
        : null,
      ziel: {
        lat: zielRoh[2],
        lng: zielRoh[3],
        plz: zielRoh[0],
        ortsname: zielRoh[1],
        kreisAgs: zielRoh[4],
        genauigkeit: "plz",
        quelle: "zieladresse",
      },
      wert: wertCent === null ? null : { cent: wertCent, art: status === "auftrag" || status === "erledigt" ? "bestaetigt" : status === "angebot" ? "angebot" : "schaetzung" },
      bezahltCent: status === "erledigt" && i % 2 === 1 ? 89000 + i * 13700 : 0,
      wartet: wartetAntwort
        ? { art: "antwort", seit: new Date(jetzt.getTime() - (i + 1) * 47 * 60 * 1000).toISOString(), chatId }
        : wartetNeu
          ? { art: "neu_pruefen", seit: angelegt.toISOString(), chatId: null }
          : null,
      veraltet: status === "neu" && i >= 10,
      emailUngelesen: i % 6 === 2 ? 2 : 0,
      alterChat: null,
      chats:
        i % 7 === 5
          ? []
          : [
              {
                id: chatId,
                kanal: i % 2 === 0 ? "whatsapp" : "email",
                kontoName: i % 2 === 0 ? `${firma.name.split(" ")[0]} WhatsApp` : `${firma.name.split(" ")[0]} E-Mail`,
                firmaId: firma.id,
                status: "open",
                letzteNachrichtAm: new Date(jetzt.getTime() - (i + 1) * 47 * 60 * 1000).toISOString(),
                vorschau: wartetAntwort ? "Hallo, wann können Sie zur Besichtigung kommen?" : "Du: Gern, wir melden uns morgen.",
                ungelesen: wartetAntwort ? 1 : 0,
                kundeZuletzt: wartetAntwort,
              },
            ],
      kv: {
        angebotErstellt: status === "angebot" || status === "auftrag" || status === "erledigt",
        angebotErstelltAm: status === "angebot" || status === "auftrag" ? new Date(angelegt.getTime() + TAG).toISOString() : null,
        linkAktiv: status === "angebot" || status === "auftrag",
        linkErstelltAm: status === "angebot" || status === "auftrag" ? new Date(angelegt.getTime() + TAG).toISOString() : null,
        linkAngesehenAnzahl: status === "angebot" ? i % 3 : status === "auftrag" ? 4 : 0,
        linkZuletztAngesehen: status === "angebot" && i % 3 > 0 ? new Date(jetzt.getTime() - 2 * TAG).toISOString() : null,
        angenommenAm: status === "auftrag" ? new Date(jetzt.getTime() - (i % 20) * TAG).toISOString() : null,
        dokumentId: status === "angebot" || status === "auftrag" ? `dok-${i}` : null,
        dokumentStand: status === "auftrag" ? "angenommen" : status === "angebot" ? "aktuell" : "keins",
      },
      kiEntwurfWartet: i === 4,
      telefon: i % 5 === 3 ? null : `+49 170 ${String(1000000 + i * 7919).slice(0, 7)}`,
    };
  });

  const missionen: Mission[] = leads
    .filter((l) => l.status === "angebot" && l.kv.linkAngesehenAnzahl === 0)
    .slice(0, 2)
    .map((l) => ({ id: `kv_nachfassen:${l.id}`, art: "kv_nachfassen", titel: "KV seit 5 Tagen ungesehen: nachfassen", leadId: l.id, dringlichkeit: 1 }));

  const wartende = leads.filter((l) => l.wartet);
  return {
    stand: jetzt.toISOString(),
    firmen: FIRMEN,
    stufen: [
      { id: "st-neu", titel: "Neue Anfrage", farbe: "#6366f1", kategorie: "open_new", aktiv: true, reihenfolge: 0 },
      { id: "st-kontakt", titel: "In Kontakt", farbe: "#8b5cf6", kategorie: "open_engaged", aktiv: true, reihenfolge: 1 },
      { id: "st-geplant", titel: "Geplant", farbe: "#d946ef", kategorie: "booked", aktiv: true, reihenfolge: 2 },
      { id: "st-durch", titel: "Durchgeführt", farbe: "#22c55e", kategorie: "done_unpaid", aktiv: true, reihenfolge: 3 },
      { id: "st-bezahlt", titel: "Bezahlt (Abgeschlossen)", farbe: "#15803d", kategorie: "paid", aktiv: true, reihenfolge: 4 },
      { id: "st-verloren", titel: "Verloren", farbe: "#ef4444", kategorie: "lost", aktiv: true, reihenfolge: 5 },
    ],
    leads,
    kennzahlen: {
      wartet: {
        gesamt: wartende.length,
        antwort: wartende.filter((l) => l.wartet?.art === "antwort").length,
        neuPruefen: wartende.filter((l) => l.wartet?.art === "neu_pruefen").length,
        aeltesteSeit: wartende.map((l) => l.wartet!.seit).sort()[0] ?? null,
      },
      emailUngelesen: { leads: leads.filter((l) => l.emailUngelesen > 0).length },
      angeboteOffen: {
        anzahl: leads.filter((l) => l.status === "angebot").length,
        ungesehen: leads.filter((l) => l.status === "angebot" && l.kv.linkAngesehenAnzahl === 0).length,
      },
      angenommenMonat: { anzahl: 3, cent: 412000, monat: "2026-10" },
      umzuegeNaechste7Tage: leads.filter((l) => l.umzugAm && (l.status === "auftrag" || l.status === "erledigt")).length,
      verortet: { mitOrt: leads.filter((l) => l.ort).length, gesamt: leads.length },
    },
    missionen,
  };
}

const MINUTE = 60 * 1000;
const STUNDE = 60 * MINUTE;

/**
 * Verlauf einer erfundenen Anfrage: [Richtung, Text, Abstand vor der letzten Nachricht].
 * Eine Nachricht enthält den KV-Link (Domain .invalid, führt nirgendwohin).
 */
const VERLAUF_TEXTE: Array<[ChatNachricht["richtung"], string, number]> = [
  ["inbound", "Hallo, wir ziehen Ende Oktober von Stuttgart-West nach Böblingen. Können Sie uns ein Angebot machen?", 74 * STUNDE],
  ["outbound", "Guten Tag! Sehr gern. Wie viele Zimmer sind es ungefähr, und gibt es einen Aufzug?", 73 * STUNDE],
  ["inbound", "3 Zimmer, 2. Stock ohne Aufzug. Dazu kommt ein Kellerabteil.", 72 * STUNDE],
  ["outbound", "Danke! Schicken Sie uns gern ein paar Fotos vom Keller, dann wird der Kostenvoranschlag genauer.", 50 * STUNDE],
  // Fotos vom Keller: ohne Text, zwei Bild-Anhänge (Anzeige „2 Fotos“).
  ["inbound", "", 48 * STUNDE],
  [
    "outbound",
    "Hier ist Ihr Kostenvoranschlag zum Ansehen und Annehmen: https://kv.beispiel.invalid/2026-0041",
    20 * STUNDE,
  ],
];

/** Chat-Kopf aus beispielAntwort(); unbekannte IDs bekommen einen plausiblen WhatsApp-Chat. */
function beispielChat(chatId: string, jetzt: Date): ChatKurz {
  for (const lead of beispielAntwort(jetzt).leads) {
    const chat = lead.chats.find((c) => c.id === chatId);
    if (chat) return chat;
  }
  return {
    id: chatId,
    kanal: "whatsapp",
    kontoName: "Kottke-Umzüge WhatsApp",
    firmaId: FIRMEN[0].id,
    status: "open",
    letzteNachrichtAm: new Date(jetzt.getTime() - 2 * STUNDE).toISOString(),
    vorschau: "Hallo, wann können Sie zur Besichtigung kommen?",
    ungelesen: 1,
    kundeZuletzt: true,
  };
}

/**
 * Lesende Chat-Vorschau für die Vorschau mit Beispieldaten (Form wie
 * GET /api/v1/lagekarte/chat/{id}): 7 bis 8 erfundene Nachrichten, älteste zuerst,
 * eine davon nur mit zwei Fotos; die letzte passt zu Richtung und Zeit des Chats
 * aus beispielAntwort().
 */
export function beispielChatVorschau(chatId: string, jetzt: Date = new Date()): ChatVorschauAntwort {
  const chat = beispielChat(chatId, jetzt);
  const letzte = new Date(chat.letzteNachrichtAm ?? jetzt.toISOString()).getTime();
  const zeilen: Array<[ChatNachricht["richtung"], string, number]> = [
    ...VERLAUF_TEXTE,
    chat.kundeZuletzt
      ? ["inbound", "Vielen Dank, sieht gut aus. Wann können Sie zur Besichtigung kommen?", 0]
      : ["inbound", "Vielen Dank, sieht gut aus. Wann können Sie zur Besichtigung kommen?", 3 * STUNDE],
  ];
  if (!chat.kundeZuletzt) zeilen.push(["outbound", "Gern, wir melden uns morgen.", 0]);

  const nachrichten: ChatNachricht[] = zeilen.map(([richtung, text, vorher], i) => ({
    id: `${chatId}-n${i + 1}`,
    richtung,
    text: text || "2 Fotos",
    zeit: new Date(letzte - vorher).toISOString(),
    status: richtung === "outbound" ? "read" : "received",
    anhaenge: text ? 0 : 2,
    anhangArt: text ? null : "foto",
  }));
  return { chat, nachrichten, mehr: false };
}

const MEILENSTEIN_LABEL: Array<[string, string]> = [
  ["erstkontakt", "Erstkontakt"],
  ["infos_erhalten", "Infos erhalten"],
  ["angebot", "Angebot gemacht"],
  ["angenommen", "Angebot angenommen"],
  ["umzugstermin", "Umzugstermin"],
  ["bezahlt", "Zahlung erhalten"],
  ["bewertung", "Bewertung anfragen"],
];

/**
 * Verlauf (Meilensteine) für die Vorschau mit Beispieldaten, in der Form von
 * GET /api/v1/deals/{id}/lifecycle, abgeleitet aus dem erfundenen Lead.
 */
export function beispielVerlauf(leadId: string, jetzt: Date = new Date()): VerlaufAntwort {
  const lead = beispielAntwort(jetzt).leads.find((l) => l.id === leadId) ?? null;
  const angelegt = lead ? new Date(lead.angelegtAm).getTime() : jetzt.getTime() - 2 * TAG;
  const status = lead?.status ?? "neu";
  const nach = (ms: number) => new Date(angelegt + ms).toISOString();
  const heute = jetzt.toISOString().slice(0, 10);
  const angebot = lead?.kv.angebotErstellt ? (lead.kv.angebotErstelltAm ?? nach(TAG)) : null;
  const angenommen = lead?.kv.angenommenAm ?? (status === "erledigt" ? nach(2 * TAG) : null);
  const umzug = lead?.umzugAm ?? null;
  const umzugErledigt = umzug !== null && (status === "erledigt" || ((status === "auftrag") && umzug < heute));
  const bezahlt = lead && lead.bezahltCent > 0 && umzug ? `${umzug}T16:00:00.000Z` : null;

  const erreicht: Record<string, string | null> = {
    erstkontakt: lead?.angelegtAm ?? nach(0),
    infos_erhalten: status === "neu" ? null : nach(2 * STUNDE),
    angebot,
    angenommen,
    umzugstermin: umzug,
    bezahlt,
    bewertung: null,
  };
  const milestones: VerlaufMeilenstein[] = MEILENSTEIN_LABEL.map(([key, label]) => {
    const at = erreicht[key];
    const done = key === "umzugstermin" ? umzugErledigt : key === "bewertung" ? false : at !== null;
    return { key, label, at, done };
  });
  return { milestones, current: milestones.find((m) => !m.done)?.key ?? null };
}
