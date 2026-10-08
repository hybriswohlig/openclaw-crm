/**
 * Lagekarte: erfundene Beispieldaten (keine echten Kunden) für Vorschau,
 * Komponentenentwicklung und Tests. Deterministisch.
 *
 * Die Daten folgen den Server-Regeln (beispiel-daten.test.ts prüft das gegen
 * wartetAuf): „antwort“ nur in WhatsApp-Threads, „neu_pruefen“ nur bei neuen
 * Anfragen unter 7 Tagen ohne Antwort, ein alter Chat (aktiv und nach
 * „Verloren“). Missionen und Kennzahlen rechnen dieselben reinen Funktionen
 * wie GET /api/v1/lagekarte.
 */
import { berechneKennzahlen } from "@/services/lagekarte/kennzahlen";
import { erzeugeMissionen } from "@/services/lagekarte/missionen";
import type {
  ChatKurz,
  ChatNachricht,
  ChatVorschauAntwort,
  KartenStatus,
  LagekarteAntwort,
  LeadPunkt,
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
const MINUTE = 60 * 1000;
const STUNDE = 60 * MINUTE;

/** Lead mit offenem WhatsApp-Chat, Kunde schrieb vor 18 Tagen: alter Chat (Ruling 9). */
const ALTER_CHAT = 10;
/** Verlorener Lead, Kunde schrieb vor 2 Tagen im offenen WhatsApp-Chat (Grok 4). */
const CHAT_NACH_VERLOREN = 11;
/** Abholadresse fehlt bei einer jungen Anfrage (Mission „Adresse fehlt“). */
const OHNE_ADRESSE = 2;
/** Tippfehler im Wert, Faktor 100 (Ruling 7, Mission „Wert prüfen“). */
const WERT_TIPPFEHLER = 9;

const TEXT_ANFRAGE = "3 Zimmer, 2. Stock ohne Aufzug. Dazu kommt ein Kellerabteil.";
const TEXT_KUNDE = "Vielen Dank, sieht gut aus. Wann können Sie zur Besichtigung kommen?";
const TEXT_NACH_VERLOREN = "Hallo, gilt Ihr Angebot noch? Wir würden doch gern mit Ihnen umziehen.";
const TEXT_WIR = "Gern, wir melden uns morgen.";

function isoTag(jetzt: Date, tage: number): string {
  return new Date(jetzt.getTime() + tage * TAG).toISOString().slice(0, 10);
}

interface ChatPlan {
  kanal: ChatKurz["kanal"];
  kundeZuletzt: boolean;
  /** ms vor jetzt */
  vor: number;
  ungelesen: number;
  vorschau: string;
}

/**
 * Welcher Thread zu Lead i gehört. Regeln wie auf dem Server: Wer auf Antwort
 * wartet, hat einen offenen WhatsApp-Thread mit Kunde zuletzt (höchstens 14 Tage);
 * neue Anfragen sind unbeantwortet (E-Mail, Kunde zuletzt); ungelesene E-Mails
 * nur, wenn der Kunde zuletzt schrieb.
 */
function chatPlan(i: number, status: KartenStatus, angelegt: Date, jetzt: Date): ChatPlan | null {
  if (i % 7 === 5) return null;
  const standardVor = (i + 1) * 47 * MINUTE;
  if (status === "neu") {
    // Die Anfrage selbst, kurz nach dem Anlegen; nie beantwortet.
    return { kanal: "email", kundeZuletzt: true, vor: jetzt.getTime() - angelegt.getTime() - 5 * MINUTE, ungelesen: 1, vorschau: TEXT_ANFRAGE };
  }
  if (i === ALTER_CHAT) return { kanal: "whatsapp", kundeZuletzt: true, vor: 18 * TAG, ungelesen: 1, vorschau: TEXT_KUNDE };
  if (i === CHAT_NACH_VERLOREN) {
    return { kanal: "whatsapp", kundeZuletzt: true, vor: 2 * TAG + 3 * STUNDE, ungelesen: 1, vorschau: TEXT_NACH_VERLOREN };
  }
  if ((status === "kontakt" || status === "angebot") && i % 4 === 1) {
    return { kanal: "whatsapp", kundeZuletzt: true, vor: standardVor, ungelesen: 1, vorschau: TEXT_KUNDE };
  }
  if (i % 6 === 2) return { kanal: "email", kundeZuletzt: true, vor: standardVor, ungelesen: 2, vorschau: TEXT_KUNDE };
  return { kanal: i % 2 === 0 ? "whatsapp" : "email", kundeZuletzt: false, vor: standardVor, ungelesen: 0, vorschau: `Du: ${TEXT_WIR}` };
}

export function beispielAntwort(jetzt: Date = new Date("2026-10-08T07:30:00+02:00")): LagekarteAntwort {
  const leads: LeadPunkt[] = NAMEN.map((name, i) => {
    const status = STATUS_FOLGE[i % STATUS_FOLGE.length];
    const ortRoh = i % 7 === 6 || i === OHNE_ADRESSE ? null : ORTE[i % ORTE.length];
    const zielRoh = ORTE[(i * 5 + 3) % ORTE.length];
    const firma = FIRMEN[i % 3 === 2 ? 1 : 0];
    const angelegt = new Date(jetzt.getTime() - (i * 2.3 + 0.2) * TAG);
    const wertCent =
      i === WERT_TIPPFEHLER
        ? (89000 + i * 13700) * 100
        : status === "auftrag" || status === "erledigt"
        ? 89000 + i * 13700
        : status === "angebot"
          ? 64000 + i * 9100
          : i % 3 === 0
            ? 120000
            : null;
    const chatId = `chat-${i}`;
    const plan = chatPlan(i, status, angelegt, jetzt);
    const chatAm = plan ? new Date(jetzt.getTime() - plan.vor).toISOString() : null;
    const kundeOffen = plan !== null && plan.kanal === "whatsapp" && plan.kundeZuletzt && status !== "verloren";
    const wartetAntwort = kundeOffen && plan.vor <= 14 * TAG;
    const imNeuFenster = jetzt.getTime() - angelegt.getTime() <= 7 * TAG;
    const alterChat =
      plan !== null && plan.kanal === "whatsapp" && plan.kundeZuletzt && (status === "verloren" || plan.vor > 14 * TAG)
        ? { chatId, seit: chatAm! }
        : null;
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
        ? { art: "antwort", seit: chatAm!, chatId }
        : status === "neu" && imNeuFenster
          ? { art: "neu_pruefen", seit: angelegt.toISOString(), chatId: plan ? chatId : null }
          : null,
      veraltet: status === "neu" && !imNeuFenster,
      emailUngelesen: plan?.kanal === "email" && plan.kundeZuletzt ? plan.ungelesen : 0,
      alterChat,
      chats: plan
        ? [
            {
              id: chatId,
              kanal: plan.kanal,
              kontoName: `${firma.name.split(" ")[0]} ${plan.kanal === "whatsapp" ? "WhatsApp" : "E-Mail"}`,
              firmaId: firma.id,
              status: "open",
              letzteNachrichtAm: chatAm,
              vorschau: plan.vorschau,
              ungelesen: plan.ungelesen,
              kundeZuletzt: plan.kundeZuletzt,
            },
          ]
        : [],
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
      // M-12: eindeutig erfundene Nummern (keine echte Mobilvorwahl).
      telefon: i % 5 === 3 ? null : `+49 000 000 ${String(i + 1).padStart(2, "0")}`,
    };
  });

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
    kennzahlen: berechneKennzahlen(leads, jetzt),
    missionen: erzeugeMissionen(leads, jetzt),
  };
}

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

/**
 * Chat-Kopf aus beispielAntwort() und ob der Thread nie beantwortet wurde (neue
 * Anfrage); unbekannte IDs bekommen einen plausiblen WhatsApp-Chat.
 */
function beispielChat(chatId: string, jetzt: Date): { chat: ChatKurz; nieBeantwortet: boolean } {
  for (const lead of beispielAntwort(jetzt).leads) {
    const chat = lead.chats.find((c) => c.id === chatId);
    if (chat) return { chat, nieBeantwortet: lead.status === "neu" };
  }
  return {
    chat: {
      id: chatId,
      kanal: "whatsapp",
      kontoName: "Kottke-Umzüge WhatsApp",
      firmaId: FIRMEN[0].id,
      status: "open",
      letzteNachrichtAm: new Date(jetzt.getTime() - 2 * STUNDE).toISOString(),
      vorschau: TEXT_KUNDE,
      ungelesen: 1,
      kundeZuletzt: true,
    },
    nieBeantwortet: false,
  };
}

/**
 * Lesende Chat-Vorschau für die Vorschau mit Beispieldaten (Form wie
 * GET /api/v1/lagekarte/chat/{id}), älteste zuerst. Beantwortete Threads: 7 bis 8
 * erfundene Nachrichten, eine nur mit zwei Fotos, eine mit KV-Link. Neue Anfragen
 * (nie beantwortet): nur Kundennachrichten. Die letzte Nachricht passt zu Richtung,
 * Zeit und Vorschautext des Chats aus beispielAntwort().
 */
export function beispielChatVorschau(chatId: string, jetzt: Date = new Date()): ChatVorschauAntwort {
  const { chat, nieBeantwortet } = beispielChat(chatId, jetzt);
  const letzte = new Date(chat.letzteNachrichtAm ?? jetzt.toISOString()).getTime();
  const letzterText = chat.vorschau?.replace(/^Du: /, "") ?? TEXT_KUNDE;
  const zeilen: Array<[ChatNachricht["richtung"], string, number]> = nieBeantwortet
    ? [
        ["inbound", VERLAUF_TEXTE[0][1], 6 * MINUTE],
        ["inbound", "", 3 * MINUTE],
        ["inbound", letzterText, 0],
      ]
    : chat.kundeZuletzt
      ? [...VERLAUF_TEXTE, ["inbound", letzterText, 0]]
      : [...VERLAUF_TEXTE, ["inbound", TEXT_KUNDE, 3 * STUNDE], ["outbound", letzterText, 0]];

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
