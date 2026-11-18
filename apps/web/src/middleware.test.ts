import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

const anfrage = (url: string, host: string) => new NextRequest(url, { headers: { host } });

const SITZUNG = "better-auth.session_token=sitzung";

function crm(pfad: string, cookie: string | null, host = "darioushkottke.online", modus?: string) {
  const headers = new Headers({ host });
  if (cookie) headers.set("cookie", cookie);
  if (modus) headers.set("sec-fetch-mode", modus);
  return new NextRequest(`https://${host}${pfad}`, { headers });
}

function weiter(res: Response): string | null {
  const loc = res.headers.get("location");
  if (!loc) return null;
  const url = new URL(loc);
  return url.pathname + url.search;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("middleware: Bewertungslink /r/", () => {
  it("/r/abc auf dem CRM-Host ohne Sitzung leitet nicht auf /login", () => {
    const res = middleware(anfrage("https://darioushkottke.online/r/abc", "darioushkottke.online"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("andere CRM-Seiten ohne Sitzung weiter auf /login", () => {
    const res = middleware(anfrage("https://darioushkottke.online/home", "darioushkottke.online"));
    expect(res.headers.get("location")).toContain("/login");
  });

  it("/r/ allein auf dem status.*-Host leitet wie bisher auf die Website", () => {
    const res = middleware(anfrage("https://status.kottke-umzuege.de/r/abc", "status.kottke-umzuege.de"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://kottke-umzuege.de/");
  });

  it("ähnliche Pfade wie /rechnungen bleiben geschützt", () => {
    const res = middleware(anfrage("https://darioushkottke.online/rechnungen", "darioushkottke.online"));
    expect(res.headers.get("location")).toContain("/login");
  });
});

describe("middleware: /select-workspace", () => {
  it("/select-workspace leitet auf /start", () => {
    const res = middleware(anfrage("https://darioushkottke.online/select-workspace", "darioushkottke.online"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/start");
  });

  it("/select-workspace/alt leitet ebenfalls auf /start", () => {
    const res = middleware(anfrage("https://darioushkottke.online/select-workspace/alt", "darioushkottke.online"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/start");
  });
});

describe("middleware: alte Handy-Links", () => {
  const neu = `${SITZUNG}; crm_ui=neu`;

  it("leitet Deal und Gespräch bei Cookie neu auf die Weiche", () => {
    const deal = middleware(crm("/objects/deals/d1", neu));
    expect(deal.status).toBe(307);
    expect(weiter(deal)).toBe("/weiter?deal=d1");

    const gespraech = middleware(crm("/inbox?conv=c", neu));
    expect(gespraech.status).toBe(307);
    expect(weiter(gespraech)).toBe("/weiter?conv=c");
  });

  it("leitet echte Seitenaufrufe um, Client-Navigation und RSC-Abrufe nicht (Review C1)", () => {
    const seite = middleware(crm("/inbox?conv=c", neu, undefined, "navigate"));
    expect(weiter(seite)).toBe("/weiter?conv=c");
    // router.replace("/inbox?conv=…") der alten Inbox: fetch mit sec-fetch-mode cors.
    for (const modus of ["cors", "same-origin", "no-cors"]) {
      const res = middleware(crm("/inbox?conv=c", neu, undefined, modus));
      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("x-middleware-next")).toBe("1");
      expect(weiter(middleware(crm("/objects/deals/d1", neu, undefined, modus)))).toBeNull();
    }
  });

  it("kaputte Prozent-Kodierung reicht durch statt 500 (Review M1)", () => {
    const res = middleware(crm("/objects/deals/%E0%A4", neu));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("lässt Abfragen, Listen, altes Cookie und fehlendes Cookie stehen", () => {
    const faelle = [
      "/objects/deals/d1?tab=quotation",
      "/objects/deals/d1?alt=1",
      "/inbox?compose=1",
      "/inbox",
      "/objects/deals",
    ];
    for (const pfad of faelle) {
      const res = middleware(crm(pfad, neu));
      expect(weiter(res), pfad).toBeNull();
      expect(res.headers.get("x-middleware-next")).toBe("1");
    }
    expect(weiter(middleware(crm("/objects/deals/d1", `${SITZUNG}; crm_ui=alt`)))).toBeNull();
    expect(weiter(middleware(crm("/objects/deals/d1", SITZUNG)))).toBeNull();
  });

  it("fasst status-Hosts, /s/ und /api/ nicht an", () => {
    const status = middleware(crm("/objects/deals/d1", neu, "status.kottke-umzuege.de"));
    expect(status.status).toBe(307);
    expect(status.headers.get("location")).toBe("https://kottke-umzuege.de/");
    expect(status.headers.get("location")).not.toContain("/weiter");

    const portal = middleware(crm("/s/x", neu));
    expect(weiter(portal)).toBeNull();
    expect(portal.headers.get("x-middleware-next")).toBe("1");

    const api = middleware(crm("/api/v1/me/settings", neu));
    expect(weiter(api)).toBeNull();
    expect(api.headers.get("x-middleware-next")).toBe("1");
  });

  it("ALT_UMLEITUNG=aus schaltet die Umleitung ab", () => {
    vi.stubEnv("ALT_UMLEITUNG", "aus");
    const res = middleware(crm("/objects/deals/d1", neu));
    expect(weiter(res)).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
    vi.unstubAllEnvs();
  });

  it("ohne Sitzung bleibt die Abfrage im Login-redirect", () => {
    const res = middleware(crm("/inbox?conv=c", null));
    expect(res.headers.get("location")).toContain("redirect=%2Finbox%3Fconv%3Dc");
  });
});

describe("middleware: alte Pfade (Plan 14)", () => {
  const neu = `${SITZUNG}; crm_ui=neu`;

  function seite(
    pfad: string,
    opts: { cookie?: string | null; host?: string; modus?: string; method?: string } = {},
  ) {
    const host = opts.host ?? "darioushkottke.online";
    const headers = new Headers({ host });
    if (opts.cookie) headers.set("cookie", opts.cookie);
    if (opts.modus) headers.set("sec-fetch-mode", opts.modus);
    return new NextRequest(`https://${host}${pfad}`, { headers, method: opts.method ?? "GET" });
  }

  function bleibt(res: Response) {
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  }

  it("leitet bei Cookie neu, Env an und Seitenaufruf auf die neue Oberfläche", () => {
    vi.stubEnv("ALTE_PFADE_UMLEITEN", "an");
    const faelle: [string, string][] = [
      ["/financial", "/app/kasse"],
      ["/statistics", "/app/uebersicht"],
      ["/objects/people/p1", "/app/kunden/p1"],
      ["/settings", "/app/einstellungen"],
    ];
    for (const [pfad, ziel] of faelle) {
      const res = middleware(seite(pfad, { cookie: neu, modus: "navigate" }));
      expect(res.status, pfad).toBe(307);
      expect(weiter(res), pfad).toBe(ziel);
    }
  });

  it("bleibt aus, solange die Umgebung nicht genau an ist", () => {
    for (const wert of [undefined, "aus", "AN"] as const) {
      vi.unstubAllEnvs();
      if (wert) vi.stubEnv("ALTE_PFADE_UMLEITEN", wert);
      bleibt(middleware(seite("/financial", { cookie: neu, modus: "navigate" })));
    }
  });

  it("bleibt aus ohne Cookie neu, bei POST, cors und den ausgenommenen Pfaden", () => {
    vi.stubEnv("ALTE_PFADE_UMLEITEN", "an");
    const still = [
      seite("/financial", { cookie: `${SITZUNG}; crm_ui=alt`, modus: "navigate" }),
      seite("/financial", { cookie: SITZUNG, modus: "navigate" }),
      seite("/financial", { cookie: neu, modus: "navigate", method: "POST" }),
      seite("/financial", { cookie: neu, modus: "cors" }),
      seite("/financial?alt=1", { cookie: neu, modus: "navigate" }),
      seite("/settings/whatsapp", { cookie: neu, modus: "navigate" }),
      seite("/objects/deals?create=1", { cookie: neu, modus: "navigate" }),
      seite("/inbox?compose=1", { cookie: neu, modus: "navigate" }),
      seite("/tasks", { cookie: neu, modus: "navigate" }),
      seite("/app/heute", { cookie: neu, modus: "navigate" }),
      seite("/weiter", { cookie: neu, modus: "navigate" }),
    ];
    for (const req of still) bleibt(middleware(req));
  });

  it("ohne Sitzung geht /financial weiter auf /login", () => {
    vi.stubEnv("ALTE_PFADE_UMLEITEN", "an");
    const res = middleware(seite("/financial", { cookie: null, modus: "navigate" }));
    expect(res.headers.get("location")).toContain("/login");
    expect(res.headers.get("location")).not.toContain("/app/");
  });

  it("lässt status.*-Hosts auf der Website", () => {
    vi.stubEnv("ALTE_PFADE_UMLEITEN", "an");
    const res = middleware(seite("/financial", { cookie: neu, host: "status.kottke-umzuege.de", modus: "navigate" }));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://kottke-umzuege.de/");
    expect(res.headers.get("location")).not.toContain("/app");
  });

  it("lässt Plan 10 vor der Pfad-Umleitung, auch bei Env an", () => {
    vi.stubEnv("ALTE_PFADE_UMLEITEN", "an");
    const deal = middleware(seite("/objects/deals/d1", { cookie: neu, modus: "navigate" }));
    expect(deal.status).toBe(307);
    expect(weiter(deal)).toBe("/weiter?deal=d1");
    const gespraech = middleware(seite("/inbox?conv=c", { cookie: neu, modus: "navigate" }));
    expect(gespraech.status).toBe(307);
    expect(weiter(gespraech)).toBe("/weiter?conv=c");
  });

  it("liest dieselbe Variable wie der Vertrag (statisch, für den Edge-Build)", async () => {
    const { UMLEITUNG_ENV } = await import("@/lib/dunkel-abschaltung");
    expect(UMLEITUNG_ENV).toBe("ALTE_PFADE_UMLEITEN");
  });

  it("ALT_UMLEITUNG=aus schaltet nur Plan 10 ab", () => {
    vi.stubEnv("ALTE_PFADE_UMLEITEN", "an");
    vi.stubEnv("ALT_UMLEITUNG", "aus");
    const kasse = middleware(seite("/financial", { cookie: neu, modus: "navigate" }));
    expect(kasse.status).toBe(307);
    expect(weiter(kasse)).toBe("/app/kasse");
    bleibt(middleware(seite("/objects/deals/d1", { cookie: neu, modus: "navigate" })));
  });
});

describe("middleware: gelöschte alte Seiten (Löschauftrag 18.11.)", () => {
  function seite(pfad: string, opts: { cookie?: string | null; modus?: string; method?: string } = {}) {
    const headers = new Headers({ host: "darioushkottke.online" });
    if (opts.cookie) headers.set("cookie", opts.cookie);
    if (opts.modus) headers.set("sec-fetch-mode", opts.modus);
    return new NextRequest(`https://darioushkottke.online${pfad}`, { headers, method: opts.method ?? "GET" });
  }

  const FAELLE: [string, string][] = [
    ["/home", "/app/heute/karte"],
    ["/anrufe", "/app/anrufe"],
    ["/contract-calendar", "/app/plan"],
  ];

  it("leitet immer um: ohne Env, mit Cookie alt, ohne Cookie, mit alt=1, bei cors und POST", () => {
    const varianten: { cookie: string; modus?: string; method?: string; abfrage?: string }[] = [
      { cookie: SITZUNG, modus: "navigate" },
      { cookie: `${SITZUNG}; crm_ui=alt`, modus: "navigate" },
      { cookie: `${SITZUNG}; crm_ui=neu`, modus: "navigate" },
      { cookie: `${SITZUNG}; crm_ui=neu`, modus: "navigate", abfrage: "?alt=1" },
      { cookie: `${SITZUNG}; crm_ui=alt`, modus: "cors" },
      { cookie: SITZUNG, method: "POST" },
    ];
    for (const [pfad, ziel] of FAELLE) {
      for (const v of varianten) {
        const res = middleware(seite(`${pfad}${v.abfrage ?? ""}`, v));
        expect(res.status, `${pfad} ${JSON.stringify(v)}`).toBe(307);
        expect(weiter(res), `${pfad} ${JSON.stringify(v)}`).toBe(ziel);
      }
    }
  });

  it("leitet auch mit ALTE_PFADE_UMLEITEN=aus und ALT_UMLEITUNG=aus um", () => {
    vi.stubEnv("ALTE_PFADE_UMLEITEN", "aus");
    vi.stubEnv("ALT_UMLEITUNG", "aus");
    const res = middleware(seite("/anrufe", { cookie: `${SITZUNG}; crm_ui=alt`, modus: "navigate" }));
    expect(res.status).toBe(307);
    expect(weiter(res)).toBe("/app/anrufe");
  });

  it("behält bei /home die Abfrage der Lagekarte, nur alt fällt weg", () => {
    const res = middleware(seite("/home?lead=l1&firma=f1&alt=1", { cookie: SITZUNG, modus: "navigate" }));
    expect(res.status).toBe(307);
    expect(weiter(res)).toBe("/app/heute/karte?lead=l1&firma=f1");
    const kalender = middleware(seite("/contract-calendar?x=1", { cookie: SITZUNG, modus: "navigate" }));
    expect(weiter(kalender)).toBe("/app/plan");
  });

  it("ohne Sitzung erst zum Login, mit dem alten Pfad als Rückweg", () => {
    const res = middleware(seite("/home", { cookie: null, modus: "navigate" }));
    expect(res.headers.get("location")).toContain("/login");
    expect(new URL(res.headers.get("location") ?? "").searchParams.get("redirect")).toBe("/home");
  });

  it("lässt bleibende alte Seiten ohne Env unverändert", () => {
    for (const pfad of ["/financial", "/inbox", "/tasks", "/settings", "/operations", "/objects/deals"]) {
      const res = middleware(seite(pfad, { cookie: `${SITZUNG}; crm_ui=neu`, modus: "navigate" }));
      expect(res.headers.get("location"), pfad).toBeNull();
      expect(res.headers.get("x-middleware-next"), pfad).toBe("1");
    }
  });

  it("fasst NIE_UMLEITEN nicht an", () => {
    for (const pfad of ["/pending-approval", "/start", "/weiter", "/app/heute", "/app/heute/karte", "/legal/agb"]) {
      const res = middleware(seite(`${pfad}?alt=1`, { cookie: `${SITZUNG}; crm_ui=neu`, modus: "navigate" }));
      expect(res.headers.get("location"), pfad).toBeNull();
    }
    // /api/ wird nie umgeleitet, auch nicht unter einem gelöschten Namen.
    const api = middleware(seite("/api/v1/home", { cookie: SITZUNG }));
    expect(api.headers.get("location")).toBeNull();
  });
});
