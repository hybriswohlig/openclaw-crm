import { describe, expect, it } from "vitest";
import { leaksPriceOrCommitment } from "@/services/agent/agent-suppress";
import {
  SIGNATUR_CEYLAN,
  SIGNATUR_KOTTKE,
  VERLUST_KEINE_RUECKMELDUNG,
} from "./konstanten";
import {
  altBatchErreicht,
  autoSendErlaubt,
  berlinTeile,
  entscheideNachfass,
  erkenneMarke,
  imKundenfenster,
  kundenCapErreicht,
  naechsterKundenSlot,
  ohneAntwort,
  ohneDoppeltenGruss,
  portalOhneDirektkontakt,
  schalterAn,
  sperreAusText,
  teamErinnerungFaellig,
  teamErinnerungText,
  umzugsterminLage,
  verlustgrundSchreiben,
  waehleKundenkanal,
  zaehltAlsKundeninhalt,
  type NachfassLage,
  type NachfassNachricht,
} from "./logik";

const TAG = 24 * 60 * 60 * 1000;
const angebot = new Date("2026-10-01T09:00:00+02:00");

function lage(p: Partial<NachfassLage> = {}): NachfassLage {
  return {
    marke: "kottke",
    kontoId: "82027c02-f0da-49db-923a-12a1d0f9a552",
    kanal: "whatsapp",
    kontoAdresse: "+491701234567",
    gespraechId: "conv-kunde",
    stageKategorie: "quoted",
    serviceUmzug: true,
    moveDate: "2026-11-20",
    angebotAm: angebot,
    hatAngebot: true,
    infosVollstaendig: true,
    infosVollstaendigSeit: new Date(angebot.getTime() - 5 * 60 * 60 * 1000),
    kundeHatNachgehakt: false,
    stumm: true,
    kundeHatGeantwortet: false,
    letzteAktivitaet: angebot,
    fu1Gesendet: false,
    fu2Gesendet: false,
    abschlussGesendet: false,
    regelCGesendet: false,
    legacyFuGesendetAm: null,
    legacyAbschlussGesendet: false,
    triage: null,
    sequenzBegonnen: false,
    teamErinnerungen: 0,
    letzteTeamErinnerung: null,
    humanOwned: false,
    aiPaused: false,
    aiNeedsReply: false,
    keinProaktivConsent: false,
    istIntern: false,
    istDuplikat: false,
    portalOhneKontakt: false,
    b2b: false,
    chatSperre: null,
    vomKunden: null,
    anredeUnklar: false,
    gesendetHeute: 0,
    legacyEntwuerfeHeute: 0,
    entwurfLiegt: false,
    teamEntwurfLiegt: false,
    gestoppt: false,
    ...p,
  };
}

function msg(p: Partial<NachfassNachricht> & Pick<NachfassNachricht, "direction" | "body">): NachfassNachricht {
  return { at: angebot, ...p };
}

describe("ohne Antwort", () => {
  it("ignoriert Lesebestätigungen, Reaktionen, leere und Systemzeilen", () => {
    const stand = ohneAntwort([
      msg({ direction: "outbound", body: "Hier das Angebot, Festpreis steht im PDF.", at: angebot }),
      msg({ direction: "inbound", body: "", at: new Date(angebot.getTime() + 1000) }),
      msg({ direction: "inbound", body: "Gelesen", at: new Date(angebot.getTime() + 2000) }),
      msg({ direction: "inbound", body: "👍", at: new Date(angebot.getTime() + 3000) }),
      msg({ direction: "inbound", body: "[System] bridge echo", system: true, at: new Date(angebot.getTime() + 4000) }),
      msg({ direction: "outbound", body: "intern", internal: true, at: new Date(angebot.getTime() + 5000) }),
    ]);
    expect(stand.stumm).toBe(true);
    expect(stand.kundeHatGeantwortet).toBe(false);
  });

  it("eine inhaltliche Antwort beendet die Stille", () => {
    const stand = ohneAntwort([
      msg({ direction: "outbound", body: "Angebot ist raus.", at: angebot }),
      msg({ direction: "inbound", body: "Danke, wir melden uns.", at: new Date(angebot.getTime() + TAG) }),
    ]);
    expect(stand.stumm).toBe(false);
    expect(stand.kundeHatGeantwortet).toBe(true);
  });

  it("pending und failed zählen nicht als gesendet", () => {
    expect(zaehltAlsKundeninhalt(msg({ direction: "outbound", body: "Hallo", status: "pending" }))).toBe("ignore");
    expect(zaehltAlsKundeninhalt(msg({ direction: "outbound", body: "Hallo", status: "sent" }))).toBe("outbound");
  });
});

describe("Sendezeit 9–19 Europe/Berlin", () => {
  it("öffnet um 9 und schließt um 19, auch sonntags", () => {
    expect(imKundenfenster(new Date("2026-10-19T08:59:00+02:00"))).toBe(false);
    expect(imKundenfenster(new Date("2026-10-19T09:00:00+02:00"))).toBe(true);
    expect(imKundenfenster(new Date("2026-10-19T18:59:00+02:00"))).toBe(true);
    expect(imKundenfenster(new Date("2026-10-19T19:00:00+02:00"))).toBe(false);
    expect(imKundenfenster(new Date("2026-10-18T10:00:00+02:00"))).toBe(true);
  });

  it("rechnet Sommer- und Winterzeit über Berlin, nicht über UTC", () => {
    expect(imKundenfenster(new Date("2026-07-23T06:30:00Z"))).toBe(false);
    expect(imKundenfenster(new Date("2026-07-23T07:00:00Z"))).toBe(true);
    expect(imKundenfenster(new Date("2026-01-19T07:30:00Z"))).toBe(false);
    expect(imKundenfenster(new Date("2026-01-19T08:00:00Z"))).toBe(true);
  });

  it("legt außerhalb auf den nächsten 9-Uhr-Slot", () => {
    expect(naechsterKundenSlot(new Date("2026-10-19T08:30:00+02:00")).toISOString()).toBe(
      "2026-10-19T07:00:00.000Z"
    );
    expect(naechsterKundenSlot(new Date("2026-10-19T19:10:00+02:00")).toISOString()).toBe(
      "2026-10-20T07:00:00.000Z"
    );
    expect(naechsterKundenSlot(new Date("2026-01-19T08:15:00+01:00")).toISOString()).toBe(
      "2026-01-19T08:00:00.000Z"
    );
    const drin = new Date("2026-10-19T11:00:00+02:00");
    expect(naechsterKundenSlot(drin)).toBe(drin);
  });

  it("plant den Entwurf, statt ihn nachts anzulegen", () => {
    const e = entscheideNachfass(lage(), new Date(angebot.getTime() + 2 * TAG + 12 * 60 * 60 * 1000));
    expect(e.art).toBe("planen");
    if (e.art === "planen") {
      expect(e.regel).toBe("a1");
      expect(imKundenfenster(e.ab) || e.ab.getTime() === naechsterKundenSlot(e.ab).getTime()).toBe(true);
    }
  });
});

describe("Zustände A / C", () => {
  const tags = (n: number, stunde = 10) => new Date(angebot.getTime() + n * TAG + (stunde - 9) * 60 * 60 * 1000);

  it("FU1 erst ab Tag 2, nicht davor", () => {
    expect(entscheideNachfass(lage(), tags(1)).art).toBe("nichts");
    const e = entscheideNachfass(lage(), tags(2));
    expect(e).toMatchObject({ art: "entwurf", regel: "a1", publikum: "kunde", nurEntwurf: false });
  });

  it("FU2 an Tag 7 nur nach FU1, Abschluss an Tag 10 nur nach FU2", () => {
    expect(entscheideNachfass(lage(), tags(7))).toMatchObject({ regel: "a1" });
    expect(entscheideNachfass(lage({ fu1Gesendet: true }), tags(6)).art).toBe("nichts");
    expect(entscheideNachfass(lage({ fu1Gesendet: true }), tags(7))).toMatchObject({ regel: "a2" });
    expect(entscheideNachfass(lage({ fu1Gesendet: true, fu2Gesendet: true }), tags(9)).art).toBe("nichts");
    expect(entscheideNachfass(lage({ fu1Gesendet: true, fu2Gesendet: true }), tags(10))).toMatchObject({
      regel: "a3",
    });
  });

  it("nach zwei Nachfass-Nachrichten kommt nur noch der Abschluss", () => {
    const e = entscheideNachfass(lage({ fu1Gesendet: true, fu2Gesendet: true, abschlussGesendet: true }), tags(12));
    expect(e).toMatchObject({ art: "nichts" });
  });

  it("Regel C einmal, wenn das Angebot mindestens 48h nach den vollständigen Infos rausging", () => {
    const spaet = lage({
      infosVollstaendigSeit: new Date(angebot.getTime() - 49 * 60 * 60 * 1000),
    });
    const erkannt = new Date(angebot.getTime() + 26 * 60 * 60 * 1000);
    expect(entscheideNachfass(spaet, erkannt)).toMatchObject({
      art: "entwurf",
      regel: "c",
      grund: "angebot_zu_spaet",
    });
    expect(entscheideNachfass(lage(), erkannt).art).not.toBe("entwurf");
    expect(entscheideNachfass({ ...spaet, regelCGesendet: true }, tags(2))).toMatchObject({ regel: "a1" });
  });

  it("ohne Angebot und ohne Nachhaken nur die Team-Erinnerung, kein C", () => {
    const jetzt = new Date("2026-10-05T11:00:00+02:00");
    const offen = lage({
      hatAngebot: false,
      angebotAm: null,
      stageKategorie: "open_engaged",
      letzteAktivitaet: new Date("2026-10-04T11:00:00+02:00"),
      infosVollstaendigSeit: new Date(jetzt.getTime() - 50 * 60 * 60 * 1000),
      kundeHatNachgehakt: false,
      stumm: false,
    });
    expect(entscheideNachfass(offen, jetzt).art).toBe("nichts");
    expect(teamErinnerungFaellig(offen, jetzt)).toMatchObject({ regel: "b", publikum: "team" });
  });

  it("C an den Kunden, wenn die Infos 48h vollständig sind, kein Angebot da ist und der Kunde nachgehakt hat", () => {
    const jetzt = new Date("2026-10-05T11:00:00+02:00");
    const e = entscheideNachfass(
      lage({
        hatAngebot: false,
        angebotAm: null,
        stageKategorie: "open_engaged",
        letzteAktivitaet: jetzt,
        infosVollstaendigSeit: new Date(jetzt.getTime() - 50 * 60 * 60 * 1000),
        kundeHatNachgehakt: true,
        stumm: false,
      }),
      jetzt
    );
    expect(e).toMatchObject({ regel: "c", grund: "angebot_fehlt_kunde_hakt_nach" });
  });
});

describe("Ausschluss und Stop", () => {
  const jetzt = new Date(angebot.getTime() + 3 * TAG);

  it("stoppt bei inhaltlicher Antwort und verwirft den laufenden Entwurf", () => {
    expect(
      entscheideNachfass(lage({ kundeHatGeantwortet: true, stumm: false, entwurfLiegt: true }), jetzt)
    ).toEqual({ art: "stop", grund: "kunde_hat_geantwortet" });
  });

  it("schickt bei human_owned, Pause, offener Frage, B2B und Chat-Sperren nichts", () => {
    for (const patch of [
      { humanOwned: true },
      { aiPaused: true },
      { aiNeedsReply: true },
      { b2b: true },
      { chatSperre: "complaint" },
      { chatSperre: "price" },
      { chatSperre: "deposit" },
      { chatSperre: "legal" },
      { chatSperre: "optout" },
      { istIntern: true },
    ] as const) {
      expect(entscheideNachfass(lage(patch), jetzt).art).not.toBe("entwurf");
    }
  });

  it("lässt junge Deals mit vergangenem oder nahem Termin liegen, ohne zu schreiben", () => {
    expect(entscheideNachfass(lage({ moveDate: "2026-10-01" }), jetzt)).toMatchObject({
      art: "nichts",
      grund: "termin_vergangen",
    });
    const nah = berlinTeile(jetzt);
    const morgen = new Date(jetzt.getTime() + 20 * 60 * 60 * 1000);
    const m = berlinTeile(morgen);
    expect(umzugsterminLage(`${m.year}-${String(m.month).padStart(2, "0")}-${String(m.day).padStart(2, "0")}`, jetzt)).toBe(
      "innerhalb_48h"
    );
    void nah;
    expect(
      entscheideNachfass(
        lage({ moveDate: `${m.year}-${String(m.month).padStart(2, "0")}-${String(m.day).padStart(2, "0")}` }),
        jetzt
      ).art
    ).not.toBe("entwurf");
  });

  it("terminale und gebuchte Stages sind tabu", () => {
    expect(entscheideNachfass(lage({ stageKategorie: "booked" }), jetzt)).toMatchObject({ grund: "stage_terminal" });
    expect(entscheideNachfass(lage({ stageKategorie: "lost" }), jetzt).art).not.toBe("entwurf");
    expect(entscheideNachfass(lage({ stageKategorie: "paid", sequenzBegonnen: true }), jetzt)).toEqual({
      art: "stop",
      grund: "stage_terminal",
    });
  });

  it("Ceylan-WhatsApp und Markenmix sind hart gesperrt, Ceylan-Mail behält Nuri", () => {
    expect(
      waehleKundenkanal({
        marke: "ceylan",
        kontoId: "595a5e23-aaaa",
        kanal: "whatsapp",
        kontoAdresse: "+49111",
        gespraechId: "c1",
      }).grund
    ).toBe("ceylan_whatsapp");
    expect(
      waehleKundenkanal({
        marke: "kottke",
        kontoId: "mail-1",
        kanal: "email",
        kontoAdresse: "ceylanoperations@gmail.com",
        gespraechId: "c1",
      }).grund
    ).toBe("marken_mix");
    const ceylan = waehleKundenkanal({
      marke: "ceylan",
      kontoId: "mail-ceylan",
      kanal: "email",
      kontoAdresse: "ceylanoperations@gmail.com",
      gespraechId: "c1",
    });
    expect(ceylan).toMatchObject({ erlaubt: true, signatur: SIGNATUR_CEYLAN, nurEntwurf: false });
    expect(
      waehleKundenkanal({
        marke: "kottke",
        kontoId: "82027c02-f0da-49db-923a-12a1d0f9a552",
        kanal: "whatsapp",
        kontoAdresse: "+49170",
        gespraechId: "c1",
      }).signatur
    ).toBe(SIGNATUR_KOTTKE);
  });

  it("unklare Marke wird nur Entwurf", () => {
    expect(erkenneMarke({ firmenname: "Kottke Umzüge", kontoId: "x", kontoAdresse: "ceylanoperations@gmail.com" })).toBe(
      "unbekannt"
    );
    const e = entscheideNachfass(lage({ marke: "unbekannt", kontoId: "irgendwas", kanal: "email", kontoAdresse: "info@example.com" }), jetzt);
    expect(e).toMatchObject({ art: "entwurf", nurEntwurf: true });
  });

  it("Portal ohne Direktkontakt und Opt-out", () => {
    expect(portalOhneDirektkontakt({ quelle: "ImmoScout24 / umzugsfirmen-check", telefon: null, email: "noreply@immoscout.de" })).toBe(true);
    expect(portalOhneDirektkontakt({ quelle: "WhatsApp", telefon: null, email: null })).toBe(false);
    expect(portalOhneDirektkontakt({ quelle: "ImmoScout24", telefon: "+491701112233", email: null })).toBe(false);
    expect(sperreAusText("Bitte nicht mehr schreiben, kein Interesse.")).toBe("optout");
    expect(sperreAusText("Wir haben einen Schaden und überlegen einen Anwalt.")).toBe("legal");
  });
});

describe("Altbestand, Caps, Verlustgrund", () => {
  const jetzt = new Date("2026-10-19T11:00:00+02:00");
  const alt = lage({
    letzteAktivitaet: new Date("2026-09-01T11:00:00+02:00"),
    angebotAm: new Date("2026-09-01T11:00:00+02:00"),
    moveDate: "2026-12-01",
  });

  it("triagiert zuerst, ohne einen Entwurf", () => {
    expect(entscheideNachfass(alt, jetzt)).toEqual({ art: "triage_frei", grund: "altbestand_triage" });
    expect(
      entscheideNachfass(lage({ ...alt, moveDate: "2026-08-01" }), jetzt)
    ).toMatchObject({ art: "triage_verloren", verlustgrund: "Termin passt nicht" });
    expect(entscheideNachfass(lage({ ...alt, istDuplikat: true }), jetzt)).toMatchObject({
      art: "triage_markieren",
      grund: "duplikat",
    });
    expect(entscheideNachfass(lage({ ...alt, portalOhneKontakt: true }), jetzt)).toMatchObject({
      grund: "portal_ohne_kontakt",
    });
  });

  it("danach ein FU2-Entwurf, höchstens 15 am Tag, Abschluss drei Tage nach dem Versand", () => {
    expect(entscheideNachfass(lage({ ...alt, triage: "frei", legacyEntwuerfeHeute: 15 }), jetzt)).toMatchObject({
      grund: "alt_batch",
    });
    expect(entscheideNachfass(lage({ ...alt, triage: "frei", legacyEntwuerfeHeute: 14 }), jetzt)).toMatchObject({
      regel: "legacy",
    });
    const gesendet = new Date(jetzt.getTime() - 3 * TAG);
    expect(
      entscheideNachfass(lage({ ...alt, triage: "frei", legacyFuGesendetAm: gesendet }), jetzt)
    ).toMatchObject({ regel: "legacy_abschluss" });
    expect(
      entscheideNachfass(lage({ ...alt, triage: "frei", legacyFuGesendetAm: new Date(jetzt.getTime() - TAG) }), jetzt)
    ).toMatchObject({ grund: "alt_wartet" });
  });

  it("das Tageslimit gilt für automatische Sends, nicht für die Entscheidung einen Entwurf zu bauen", () => {
    expect(kundenCapErreicht(19)).toBe(false);
    expect(kundenCapErreicht(20)).toBe(true);
    expect(altBatchErreicht(14)).toBe(false);
    expect(altBatchErreicht(15)).toBe(true);
    const e = entscheideNachfass(lage({ gesendetHeute: 20 }), new Date(angebot.getTime() + 3 * TAG));
    expect(e).toMatchObject({ art: "entwurf", regel: "a1" });
    expect(
      autoSendErlaubt({
        schalterAn: true,
        dryRun: false,
        saubereFreigaben: 20,
        nurEntwurf: false,
        preisLeak: false,
        harteSperre: false,
        capErreicht: true,
        imFenster: true,
        publikum: "kunde",
      })
    ).toBe(false);
  });

  it("Auto-Send bleibt aus, solange Schalter, dryRun oder die 20 sauberen Freigaben fehlen", () => {
    const basis = {
      schalterAn: false,
      dryRun: true,
      saubereFreigaben: 0,
      nurEntwurf: false,
      preisLeak: false,
      harteSperre: false,
      capErreicht: false,
      imFenster: true,
      publikum: "kunde" as const,
    };
    expect(autoSendErlaubt(basis)).toBe(false);
    expect(autoSendErlaubt({ ...basis, schalterAn: true })).toBe(false);
    expect(autoSendErlaubt({ ...basis, schalterAn: true, dryRun: false, saubereFreigaben: 19 })).toBe(false);
    expect(autoSendErlaubt({ ...basis, schalterAn: true, dryRun: false, saubereFreigaben: 20 })).toBe(true);
    expect(autoSendErlaubt({ ...basis, schalterAn: true, dryRun: false, saubereFreigaben: 20, preisLeak: true })).toBe(
      false
    );
    expect(schalterAn([], "oc-kottke", "a1")).toBe(false);
    expect(schalterAn([{ oc: "oc-kottke", regel: "a1", an: false }], "oc-kottke", "a1")).toBe(false);
  });

  it("schreibt den Verlustgrund nur wenn er leer ist, am Tag 10 auf keine Rückmeldung", () => {
    expect(verlustgrundSchreiben({ bestehend: null, vomKunden: null, anlass: "tag10" })).toBe(
      VERLUST_KEINE_RUECKMELDUNG
    );
    expect(verlustgrundSchreiben({ bestehend: "zu teuer", vomKunden: null, anlass: "tag10" })).toBeNull();
    expect(
      verlustgrundSchreiben({ bestehend: null, vomKunden: "anderer Anbieter", anlass: "tag10" })
    ).toBe("anderer Anbieter");
    expect(
      verlustgrundSchreiben({
        bestehend: "Selbstumzug",
        vomKunden: "anderer Anbieter",
        anlass: "tag10",
      })
    ).toBeNull();
    expect(
      verlustgrundSchreiben({ bestehend: "zu teuer", vomKunden: null, anlass: "triage", triageGrund: "Termin passt nicht" })
    ).toBeNull();
    expect(
      verlustgrundSchreiben({ bestehend: null, vomKunden: null, anlass: "triage", triageGrund: "Termin passt nicht" })
    ).toBe("Termin passt nicht");
  });
});

describe("Team-Erinnerung und Form", () => {
  it("erinnert frühestens nach 4 Stunden, höchstens dreimal, mit einem Tag Abstand", () => {
    const seit = new Date("2026-10-19T08:00:00+02:00");
    const basis = lage({
      hatAngebot: false,
      angebotAm: null,
      stageKategorie: "open_engaged",
      infosVollstaendigSeit: seit,
      letzteAktivitaet: seit,
      stumm: false,
    });
    expect(teamErinnerungFaellig(basis, new Date(seit.getTime() + 3 * 60 * 60 * 1000))).toMatchObject({
      grund: "team_zu_frueh",
    });
    expect(teamErinnerungFaellig(basis, new Date(seit.getTime() + 5 * 60 * 60 * 1000))).toMatchObject({
      regel: "b",
    });
    expect(
      teamErinnerungFaellig(
        lage({ ...basis, teamErinnerungen: 1, letzteTeamErinnerung: new Date(seit.getTime() + 5 * 60 * 60 * 1000) }),
        new Date(seit.getTime() + 10 * 60 * 60 * 1000)
      )
    ).toMatchObject({ grund: "team_abstand" });
    expect(teamErinnerungFaellig(lage({ ...basis, teamErinnerungen: 3 }), new Date(seit.getTime() + 5 * TAG))).toMatchObject({
      grund: "team_max",
    });
  });

  it("der interne Text nennt den Deal und keinen Preis", () => {
    const text = teamErinnerungText({
      dealName: "Familie Sommer",
      dealUrl: "https://crm.example/objects/deals/d1",
      nummer: 1,
    });
    expect(text).toContain("https://crm.example/objects/deals/d1");
    expect(text).toContain("Familie Sommer");
    expect(leaksPriceOrCommitment(text)).toBe(false);
  });

  it("streift eine zweite Begrüßung nur im laufenden Chat ab", () => {
    expect(ohneDoppeltenGruss("Hallo Anna, kurze Frage zum Angebot.", true)).toBe("kurze Frage zum Angebot.");
    expect(ohneDoppeltenGruss("Guten Tag, der Termin ist noch frei.", true).toLowerCase()).not.toMatch(/^guten tag/);
    expect(ohneDoppeltenGruss("Hallo, ich melde mich zum Umzug.", false)).toMatch(/^Hallo/);
  });
});
