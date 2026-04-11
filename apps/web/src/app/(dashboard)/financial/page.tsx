"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Wallet,
  Receipt,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";

interface Summary {
  totalAusgaben: number;
  totalZahlungen: number;
  nettoErgebnis: number;
  anzahlAusgaben: number;
  anzahlZahlungen: number;
}

interface Ausgabe {
  id: number;
  datum: string;
  betrag: number;
  empfaenger: string;
  beschreibung: string;
  kategorie: string;
  zahlungsart: string;
  auftrag_nr: string | null;
  firma: string;
  erstellt_am: string;
}

interface Zahlung {
  id: number;
  auftrag_nr: string;
  datum: string;
  betrag: number;
  zahler: string;
  zahlungsart: string;
  referenz: string | null;
  notiz: string | null;
  erstellt_am: string;
}

interface MitarbeiterKonto {
  id: number;
  mitarbeiter: string;
  datum: string;
  typ: string;
  betrag: number;
  beschreibung: string;
  auftrag_nr: string | null;
  status: string;
  zahlungsart: string;
  notiz: string | null;
  erstellt_am: string;
}

interface MitarbeiterSaldo {
  mitarbeiter: string;
  schulden_gesamt: number;
  gezahlt_gesamt: number;
  saldo: number;
  anzahl_transaktionen: number;
}

interface FinancialData {
  summary: Summary;
  breakdowns: {
    ausgabenByKategorie: Record<string, number>;
    ausgabenByFirma: Record<string, number>;
    ausgabenByZahlungsart: Record<string, number>;
  };
  mitarbeiterSaldo: MitarbeiterSaldo[];
  recentAusgaben: Ausgabe[];
  recentZahlungen: Zahlung[];
  mitarbeiterKonten: MitarbeiterKonto[];
}

function eur(n: number) {
  return Number(n).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function ZahlungsartBadge({ art }: { art: string }) {
  const colors: Record<string, string> = {
    bar: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    karte: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    paypal: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400",
    ueberweisung: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  };
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${colors[art] || "bg-muted text-muted-foreground"}`}>
      {art === "ueberweisung" ? "Überweisung" : art.charAt(0).toUpperCase() + art.slice(1)}
    </span>
  );
}

function BarChart({ data, color }: { data: Record<string, number>; color: string }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...entries.map(([, v]) => v), 1);

  return (
    <div className="space-y-2">
      {entries.map(([label, value]) => (
        <div key={label} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground truncate max-w-[60%]">{label}</span>
            <span className="font-medium tabular-nums">{eur(value)}</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full ${color} transition-all duration-500`}
              style={{ width: `${(value / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function FinancialPage() {
  const [data, setData] = useState<FinancialData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/financial/overview")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => setData(json.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-destructive font-medium">Fehler beim Laden</p>
          <p className="text-sm text-muted-foreground">{error || "Keine Daten"}</p>
        </div>
      </div>
    );
  }

  const { summary, breakdowns, mitarbeiterSaldo, recentAusgaben, recentZahlungen, mitarbeiterKonten } = data;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Finanzen</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Übersicht über Ausgaben, Einnahmen und Mitarbeiter-Konten
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm text-muted-foreground">Einnahmen</CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {eur(summary.totalZahlungen)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {summary.anzahlZahlungen} Zahlungseingänge
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm text-muted-foreground">Ausgaben</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">
              {eur(summary.totalAusgaben)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {summary.anzahlAusgaben} Buchungen
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm text-muted-foreground">Netto-Ergebnis</CardTitle>
            {summary.nettoErgebnis >= 0 ? (
              <ArrowUpRight className="h-4 w-4 text-emerald-500" />
            ) : (
              <ArrowDownRight className="h-4 w-4 text-red-500" />
            )}
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${summary.nettoErgebnis >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
              {eur(summary.nettoErgebnis)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Einnahmen − Ausgaben
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm text-muted-foreground">Offene Salden</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {eur(mitarbeiterSaldo.reduce((s, m) => s + Number(m.saldo), 0))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {mitarbeiterSaldo.length} Mitarbeiter
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Ausgaben nach Kategorie</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart data={breakdowns.ausgabenByKategorie} color="bg-blue-500" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Ausgaben nach Firma</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart data={breakdowns.ausgabenByFirma} color="bg-violet-500" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Ausgaben nach Zahlungsart</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart data={breakdowns.ausgabenByZahlungsart} color="bg-amber-500" />
          </CardContent>
        </Card>
      </div>

      {/* Mitarbeiter Saldo */}
      {mitarbeiterSaldo.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Mitarbeiter-Salden</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium">Mitarbeiter</th>
                    <th className="text-right px-4 py-3 font-medium">Schulden</th>
                    <th className="text-right px-4 py-3 font-medium">Gezahlt</th>
                    <th className="text-right px-4 py-3 font-medium">Saldo</th>
                    <th className="text-right px-4 py-3 font-medium">Transaktionen</th>
                  </tr>
                </thead>
                <tbody>
                  {mitarbeiterSaldo.map((m) => (
                    <tr key={m.mitarbeiter} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{m.mitarbeiter}</td>
                      <td className="px-4 py-3 text-right text-red-600 dark:text-red-400">
                        {eur(Number(m.schulden_gesamt))}
                      </td>
                      <td className="px-4 py-3 text-right text-emerald-600 dark:text-emerald-400">
                        {eur(Number(m.gezahlt_gesamt))}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        <span className={Number(m.saldo) > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}>
                          {eur(Number(m.saldo))}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{m.anzahl_transaktionen}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Detail tables */}
      <Tabs defaultValue="ausgaben" className="space-y-4">
        <TabsList>
          <TabsTrigger value="ausgaben">
            <Receipt className="h-4 w-4 mr-1.5" />
            Ausgaben
          </TabsTrigger>
          <TabsTrigger value="zahlungen">
            <TrendingUp className="h-4 w-4 mr-1.5" />
            Zahlungseingänge
          </TabsTrigger>
          <TabsTrigger value="konten">
            <Wallet className="h-4 w-4 mr-1.5" />
            Mitarbeiter-Konten
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ausgaben">
          <Card>
            <CardContent className="pt-6">
              <div className="rounded-lg border border-border overflow-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left px-4 py-3 font-medium">Datum</th>
                      <th className="text-left px-4 py-3 font-medium">Empfänger</th>
                      <th className="text-left px-4 py-3 font-medium">Beschreibung</th>
                      <th className="text-left px-4 py-3 font-medium">Kategorie</th>
                      <th className="text-left px-4 py-3 font-medium">Zahlung</th>
                      <th className="text-left px-4 py-3 font-medium">Firma</th>
                      <th className="text-right px-4 py-3 font-medium">Betrag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentAusgaben.map((a) => (
                      <tr key={`${a.id}-${a.erstellt_am}`} className="border-b border-border last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3 tabular-nums whitespace-nowrap">{formatDate(a.datum)}</td>
                        <td className="px-4 py-3 font-medium">{a.empfaenger}</td>
                        <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">{a.beschreibung}</td>
                        <td className="px-4 py-3">
                          <Badge variant="secondary">{a.kategorie}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <ZahlungsartBadge art={a.zahlungsart} />
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{a.firma}</td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums text-red-600 dark:text-red-400">
                          {eur(Number(a.betrag))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="zahlungen">
          <Card>
            <CardContent className="pt-6">
              <div className="rounded-lg border border-border overflow-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left px-4 py-3 font-medium">Datum</th>
                      <th className="text-left px-4 py-3 font-medium">Auftrag</th>
                      <th className="text-left px-4 py-3 font-medium">Zahler</th>
                      <th className="text-left px-4 py-3 font-medium">Zahlung</th>
                      <th className="text-left px-4 py-3 font-medium">Notiz</th>
                      <th className="text-right px-4 py-3 font-medium">Betrag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentZahlungen.map((z) => (
                      <tr key={`${z.id}-${z.erstellt_am}`} className="border-b border-border last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3 tabular-nums whitespace-nowrap">{formatDate(z.datum)}</td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{z.auftrag_nr}</span>
                        </td>
                        <td className="px-4 py-3 font-medium">{z.zahler}</td>
                        <td className="px-4 py-3">
                          <ZahlungsartBadge art={z.zahlungsart} />
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs max-w-[250px] truncate">
                          {z.notiz || "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                          {eur(Number(z.betrag))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="konten">
          <Card>
            <CardContent className="pt-6">
              <div className="rounded-lg border border-border overflow-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left px-4 py-3 font-medium">Datum</th>
                      <th className="text-left px-4 py-3 font-medium">Mitarbeiter</th>
                      <th className="text-left px-4 py-3 font-medium">Typ</th>
                      <th className="text-left px-4 py-3 font-medium">Beschreibung</th>
                      <th className="text-left px-4 py-3 font-medium">Status</th>
                      <th className="text-left px-4 py-3 font-medium">Zahlung</th>
                      <th className="text-right px-4 py-3 font-medium">Betrag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mitarbeiterKonten.map((k) => (
                      <tr key={`${k.id}-${k.erstellt_am}`} className="border-b border-border last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3 tabular-nums whitespace-nowrap">{formatDate(k.datum)}</td>
                        <td className="px-4 py-3 font-medium">{k.mitarbeiter}</td>
                        <td className="px-4 py-3">
                          <Badge variant={k.typ === "erstattung" ? "default" : "secondary"}>
                            {k.typ === "lohn" ? "Lohn" : k.typ === "auslage" ? "Auslage" : k.typ === "erstattung" ? "Erstattung" : k.typ}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">{k.beschreibung}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            k.status === "bezahlt"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                              : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                          }`}>
                            {k.status === "bezahlt" ? "Bezahlt" : k.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <ZahlungsartBadge art={k.zahlungsart} />
                        </td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums">
                          <span className={k.typ === "erstattung" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                            {k.typ === "erstattung" ? "+" : "−"}{eur(Number(k.betrag))}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
