"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Phone } from "lucide-react";
import { nameAusZusammenfassung, zeigeLeadKnopf } from "@/lib/phone-call-lead";
import { callActivityTitle, matchStatusLabel } from "@/lib/phone-call-text";

interface Karte {
  id: string;
  name: string;
}

interface Anruf {
  id: string;
  callerE164: string | null;
  callerRaw: string | null;
  lineLabel: string | null;
  startedAt: string;
  durationSeconds: number | null;
  summary: string | null;
  transcript: string | null;
  keywords: string[];
  personRecordId: string | null;
  dealRecordId: string | null;
  matchStatus: string;
  karten: Karte[];
  bestehendePerson: Karte | null;
  offeneLeads: Karte[];
}

function alsKarten(value: unknown): Karte[] {
  if (!Array.isArray(value)) return [];
  return value.filter((eintrag): eintrag is Karte => {
    if (!eintrag || typeof eintrag !== "object") return false;
    const karte = eintrag as { id?: unknown; name?: unknown };
    return typeof karte.id === "string" && typeof karte.name === "string";
  });
}

export default function AnrufePage() {
  const [calls, setCalls] = useState<Anruf[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState(false);
  const [dialogId, setDialogId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [wahl, setWahl] = useState("");
  const [melde, setMelde] = useState<string | null>(null);
  const [speichert, setSpeichert] = useState(false);

  const laden = useCallback(async (still = false) => {
    if (!still) setLoading(true);
    setFehler(false);
    try {
      const res = await fetch("/api/v1/phone-calls?limit=40");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const zeilen = Array.isArray(data.data) ? data.data : [];
      setCalls(
        zeilen.map((zeile: Anruf) => ({
          ...zeile,
          karten: alsKarten(zeile.karten),
          bestehendePerson:
            zeile.bestehendePerson && typeof zeile.bestehendePerson.id === "string"
              ? zeile.bestehendePerson
              : null,
          offeneLeads: alsKarten(zeile.offeneLeads),
          keywords: Array.isArray(zeile.keywords) ? zeile.keywords : [],
        }))
      );
    } catch {
      if (!still) setFehler(true);
    } finally {
      if (!still) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void laden();
  }, [laden]);

  const dialog = calls.find((call) => call.id === dialogId) ?? null;

  function oeffne(call: Anruf) {
    setDialogId(call.id);
    setName(nameAusZusammenfassung(call.summary) ?? "");
    setWahl("");
    setMelde(null);
  }

  async function anlegen(call: Anruf) {
    if (speichert) return;
    const body: { name?: string; dealId?: string; neuerLead?: boolean } = {};
    if (!call.bestehendePerson) body.name = name;
    if (call.offeneLeads.length > 1) {
      if (!wahl) {
        setMelde("Bitte einen Lead wählen.");
        return;
      }
      if (wahl === "neu") body.neuerLead = true;
      else body.dealId = wahl;
    }
    setSpeichert(true);
    setMelde(null);
    try {
      const res = await fetch(`/api/v1/phone-calls/${call.id}/lead`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 409) {
        const leads = alsKarten(data?.leads);
        const karten = alsKarten(data?.karten);
        if (leads.length > 1 || karten.length > 1) {
          setCalls((prev) =>
            prev.map((eintrag) =>
              eintrag.id === call.id
                ? {
                    ...eintrag,
                    offeneLeads: leads.length > 1 ? leads : eintrag.offeneLeads,
                    karten: karten.length > 1 ? karten : eintrag.karten,
                  }
                : eintrag
            )
          );
        }
        setMelde(typeof data?.error?.message === "string" ? data.error.message : "Der Lead wurde nicht angelegt.");
        return;
      }
      if (!res.ok) {
        setMelde(typeof data?.error?.message === "string" ? data.error.message : "Der Lead konnte nicht angelegt werden.");
        return;
      }
      setDialogId(null);
      await laden(true);
    } catch {
      setMelde("Der Lead konnte nicht angelegt werden.");
    } finally {
      setSpeichert(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-center gap-3">
        <Phone className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">Anrufe</h1>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Anrufe werden geladen.
        </div>
      )}

      {!loading && fehler && (
        <p className="text-sm text-muted-foreground">Anrufe konnten nicht geladen werden.</p>
      )}

      {!loading && !fehler && calls.length === 0 && (
        <p className="text-sm text-muted-foreground">Noch keine Anrufe.</p>
      )}

      {!loading && !fehler && calls.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {calls.map((call) => {
            const knopf = zeigeLeadKnopf(call.matchStatus, call.dealRecordId) && call.karten.length < 2;
            return (
              <li key={call.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">{callActivityTitle(call)}</p>
                  <time className="text-xs text-muted-foreground" dateTime={call.startedAt}>
                    {new Date(call.startedAt).toLocaleString("de-DE", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  {call.personRecordId ? (
                    <Link
                      href={`/objects/people/${call.personRecordId}`}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      Kunde öffnen
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">{matchStatusLabel(call.matchStatus)}</span>
                  )}
                  {call.dealRecordId && (
                    <Link
                      href={`/objects/deals/${call.dealRecordId}`}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      Lead öffnen
                    </Link>
                  )}
                  {call.karten.map((karte) => (
                    <Link
                      key={karte.id}
                      href={`/objects/people/${karte.id}`}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {karte.name || "Kunde"}
                    </Link>
                  ))}
                  {knopf && (
                    <button type="button" onClick={() => oeffne(call)} className="text-primary underline-offset-2 hover:underline">
                      {call.bestehendePerson ? "An diesen Kunden hängen" : "Als Lead anlegen"}
                    </button>
                  )}
                </div>
                {call.summary && (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{call.summary}</p>
                )}
                {call.keywords.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">{call.keywords.join(" · ")}</p>
                )}
                {call.transcript && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground">Transkript</summary>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{call.transcript}</p>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="lead-titel"
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border bg-background p-4 shadow-lg"
          >
            <h2 id="lead-titel" className="text-base font-semibold">
              {dialog.bestehendePerson ? "An diesen Kunden hängen" : "Als Lead anlegen"}
            </h2>
            <p className="mt-2 text-sm">{callActivityTitle(dialog)}</p>
            {dialog.summary && (
              <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{dialog.summary}</p>
            )}
            {dialog.transcript && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground">Transkript</summary>
                <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{dialog.transcript}</p>
              </details>
            )}

            {dialog.bestehendePerson ? (
              <p className="mt-3 text-sm">
                Kunde: {dialog.bestehendePerson.name || "Kunde"}. Der eingetragene Name bleibt.
              </p>
            ) : (
              <label className="mt-3 block text-sm">
                Name
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-1 w-full rounded-lg border bg-background px-3 py-2"
                />
              </label>
            )}

            {dialog.bestehendePerson && dialog.offeneLeads.length === 1 && (
              <p className="mt-3 text-sm">Der Anruf kommt an den offenen Lead „{dialog.offeneLeads[0].name}“.</p>
            )}
            {dialog.bestehendePerson && dialog.offeneLeads.length === 0 && (
              <p className="mt-3 text-sm">Neuer Lead in Neue Anfrage.</p>
            )}
            {dialog.offeneLeads.length > 1 && (
              <fieldset className="mt-3 space-y-2 text-sm">
                <legend>Offene Leads</legend>
                {dialog.offeneLeads.map((lead) => (
                  <label key={lead.id} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="lead-wahl"
                      value={lead.id}
                      checked={wahl === lead.id}
                      onChange={() => setWahl(lead.id)}
                    />
                    {lead.name || "Lead"}
                  </label>
                ))}
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="lead-wahl"
                    value="neu"
                    checked={wahl === "neu"}
                    onChange={() => setWahl("neu")}
                  />
                  Neuer Lead
                </label>
              </fieldset>
            )}

            {melde && <p className="mt-3 text-sm text-destructive">{melde}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDialogId(null)}
                disabled={speichert}
                className="rounded-lg border px-3 py-2 text-sm"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={() => void anlegen(dialog)}
                disabled={speichert}
                className="rounded-lg bg-foreground px-3 py-2 text-sm text-background disabled:opacity-40"
              >
                {speichert ? "Wird angelegt …" : dialog.bestehendePerson ? "Anhängen" : "Lead anlegen"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
