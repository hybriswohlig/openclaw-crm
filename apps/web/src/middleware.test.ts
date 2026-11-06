import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

const anfrage = (url: string, host: string) => new NextRequest(url, { headers: { host } });

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
