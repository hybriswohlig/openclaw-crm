# Skill-Build: Kunden-Chat diagnostizieren

Stand: 2026-08-15. Das ist die Bau-Spec, nicht das Skill. Kein `SKILL.md`, bevor die RED-Fälle ohne Skill gelaufen sind.

**Heavy Reference (nicht hierher kopieren):**

- [`research-register-ton.md`](research-register-ton.md)
- [`research-linguistik-chat.md`](research-linguistik-chat.md)
- [`research-kanaele.md`](research-kanaele.md)
- [`research-funnel.md`](research-funnel.md)
- [`research-follow-up.md`](research-follow-up.md)
- [`research-einwaende-trust.md`](research-einwaende-trust.md)
- [`research-service-recovery.md`](research-service-recovery.md)
- [`research-recht-de.md`](research-recht-de.md)
- [`research-segmente.md`](research-segmente.md)
- [`research-kuechenbau.md`](research-kuechenbau.md)

Ein Fakt, ein Home. Spec hier. Evidenz in der Recherche. Echte Chats später in `references/`, nicht im Skill.

---

## 1. Was gebaut wird

Ein **Diagnose-Instrument, das gelegentlich einen WhatsApp-/Portal-/Mail-Entwurf schreibt**. Kein Template-Generator. Kein Game-Theory-Modul. Kein zweites Verkaufs-Skill.

Name (Vorschlag): `service-chat-diagnose`

Beschreibung (nur Trigger, kein Ablauf):

> Use when drafting, reviewing, or interpreting a German customer chat (WhatsApp, Kleinanzeigen, Immoscout, Check24, email) for a local service firm (moving, junk removal, later kitchen/trades), or when the user asks what to send next, how to match Sie/Du, how to quote, follow up, or handle a price objection. Not for cold ads, not for "lines that close" without a thread.

Sprache des Skills: **Deutsch**. Name und YAML-Description auf Englisch.

---

## 2. Scope

### Drin

- DACH, lokal, B2C und kleines B2B
- Kanäle: WhatsApp, Kleinanzeigen, Portale, Mail
- Default-Firma dieser Session: Kottke Umzüge (Foto-Festpreis, Kleinunternehmer §19, Haftung 620 EUR/m³, keine Extra-Police, gemietete Fahrzeuge)
- Diagnose des letzten Turns, dann höchstens zwei Varianten in passendem Register
- Ein Modus pro Antwort
- Küche nur als "nicht den Umzugs-SLA übertragen", kein zweites Skill

### Raus

- Anzeigen schreiben (liegt bei `kleinanzeigen-umzuege`)
- Kalkulations-Engine (Fotos → Zahl). Zahl kommt vom Menschen oder späterem Tool
- Game Theory, Payoff, Delay-Spiegel, Mystery
- Kalte Werbung auf gespeicherter Nummer
- US-SMS/TCPA als DE-Recht
- Line-Bibliotheken, 20 Vorlagen
- Fallakten im Skill-Body

### Entscheidung, die schon steht

| Thema | Entscheidung |
|---|---|
| Zwei Skills (Quali vs. Verkauf)? | Nein. Ein Skill, Modi innen |
| Game Theory als Modul? | Nein. Anker, Signal, Vergleichsset in Alltagssprache |
| Mehr Recherche vor Skill? | Nein |
| Skill vor Tests? | Nein |
| Schweigen / nicht senden | Erstklassige Ausgabe |
| Default ohne Anrede | Warmes Sie oder pronoun-frei, nie Peer-Du |
| Rabatt | Nur gegen weniger Leistung |
| Chat-Angebot | Eine Zahl nach Sicht, nie "ab" |

---

## 3. Was die Recherche nicht allein trägt

### 3.1 Eine Bubble, ein Job

Preis plus Upsell plus Termin plus Bewertung ist der Default-Fail "professioneller Kompletttext".

### 3.2 Foto ist der Turn, nicht die Liste

Kunde liefert schon Ort/Tag/Zimmer: nicht die 6er-Liste. Kunde liefert Fotos plus "was kostet das?": nicht nochmal Quali stapeln.

### 3.3 Wahrheit über den Betrieb

Bestehende `reaktion.md`-Sätze (19 % MwSt, Transportversicherung, Festnetz, Familienbetrieb, eigene LKW) sind keine Vorlage. Der Skill muss sie aktiv verhindern.

### 3.4 "Haben schon wen" ist Exit

Kein zweites Ask, kein Anruf, kein "nur sichtbar bleiben".

### 3.5 Alte Nummer ist kein Fenster

"Wir haben morgen frei" an einen Lead von März ist rote elektronische Post.

### 3.6 Stimme

Ohne Voice-Sample: ein Satz in der Registerlage des Betriebs, oder nur Diagnose. Kein Coach-Hochglanz, keine Em-Dashes.

### 3.7 Fehlende Inputs

Ohne wörtlichen Thread und ohne Ziel für *diesen* Text: ablehnen oder nach dem Thread fragen.

---

## 4. Pflicht-Inputs (vor jedem Entwurf)

| Input | Pflicht | Wenn fehlt |
|---|---|---|
| Wörtlicher Thread, letzte 3–8 Turns, wer-sagte-was | ja | kein Entwurf |
| Kanal | ja | fragen |
| Ziel für *diesen* Text | ja | fragen |
| Firma-Fakten die den Satz ändern (MwSt, Haftung, Fuhrpark) | ja, aus Profil oder User | nicht erfinden |
| Segment | ableiten | als Annahme markieren |
| Register-Signale (Pronomen, Gruß, Nähe, Rolle) | ableiten | Default Stufe 5 oder 3 |
| Voice-Sample | für Entwürfe | Diagnose oder ein Satz Lage |

---

## 5. Diagnose (Reihenfolge)

1. **Schienen** zuerst: Nein, Schwarz, kalte Werbung, kein Thread, Küche-SLA-Transfer.
2. **Letzter Turn:** was der Kunde tut (Frage, Foto, Einwand, Exit, Preisdruck).
3. **Register + Segment + Kanal + Stadium.**
4. **Genau ein Modus.**
5. **Output-Vertrag** oder nicht senden.

### Modi (einer primär)

`qualify` · `answer` · `quote` · `defend` · `close` · `follow-up` · `recovery` · `graceful-close` · `silence`

`silence` ist erstklassig.

### Output-Vertrag

1. **Read** — Stadium, Register-Stufe, Segment, Kanal, letzter Turn, Job der nächsten Bubble.
2. **Mode** + ein Satz Warum.
3. **2 Varianten** (3 nur bei echter Gabel). Kurz, ein Job, passendes Register.
4. **Nicht senden** — 2–4 Anti-Entwürfe für *diesen* Thread.
5. **Risiko** — was schiefgeht; welches Signal die Diagnose kippt.
6. **Eine** Beobachtung für die Kundenantwort. Kein Mehr-Schritt-Playbook.

Mode `silence`: Read + Warum + Nicht-senden. Keine getarnten Drafts.

---

## 6. Harte Schienen

1. Kein Entwurf ohne Thread.
2. Kunde führt Anrede. Eine Stufe förmlicher ok, eine lockerer nicht.
3. Kein ungefragtes Du bei Senior, Firma, Hausverwaltung.
4. Kein Slang-, Dialekt-, Tippfehler-Echo.
5. Erste Bubble: Spiegel + eine Lücke, keine 6er-Liste (außer der Kunde fragt "was braucht ihr?").
6. Chat-Angebot nach Sicht = eine Zahl. Davor nur Spanne mit Bedingung.
7. Kein "ab" als Angebot. Kein Budget zuerst abfragen.
8. Rabatt nur gegen weniger Leistung.
9. Keine erfundenen Trust-Fakten (MwSt, Versicherung, Festnetz, eigene LKW, Familienbetrieb, Gründungsjahr).
10. Schwarzarbeit: klar nein, ohne Augenzwinkern.
11. Weiches Nein / "haben schon wen" / "nicht mehr schreiben" = Schluss.
12. Keine kalte elektronische Post auf alter Nummer.
13. Kein Game: kein Delay, keine Fake-Knappheit, kein Mystery.
14. Ein Job pro Bubble. Nach 23 Uhr kein Verkaufs-Pitch ohne laufenden Tages-Thread.
15. Küche: kein Umzugs-1-Stunden-Festpreis.
16. Schreiben, als sähe der Partner mit.

---

## 7. Was der Skill nur verlinkt

Register-Leiter, Segmente, Kanal-Matrix, Funnel-Stadien, Follow-up-Kadenz, Einwand-Tabelle, Recovery-Stadien, Rechts-Ampel, Küchen-Delta. Im SKILL.md nur Reihenfolge, Vertrag, Schienen, wann welche Datei laden.

---

## 8. Datei-Lage

```
customer-texting/
  RESEARCH-BRIEF.md
  README.md
  skill-build.md                 # diese Datei
  red/baseline/                  # RED-Mitschriften
  research-*.md                  # bleibt
  SKILL.md                       # dünn, erst nach RED
```

Deploy in Runtime-Skills erst nach GREEN.

---

## 9. Bau-Reihenfolge

Iron Law: kein SKILL.md ohne failing test.

### RED (gelaufen 2026-08-15)

10/10 ohne Skill. Mitschriften: `red/baseline/case-NN.md`. Muster: `red/baseline/SUMMARY.md`.

Kein Case sauber. Härteste Fails: 02 (MwSt+Versicherung+Brief), 03 (Rabatt), 07 (Delay/Knappheit), 08 (Du gegen Kunden-Sie), 10 (kalte WA). Nächste an der Schiene und trotzdem kippend: 01 (Spanne ohne Sicht), 04 (Tür nach Nein).

### GREEN

Minimales SKILL.md: Trigger, Reihenfolge, Vertrag, Schienen, Links. Nur Regeln, die RED gebrochen hat, plus unverzichtbare Gates (kein Thread → kein Entwurf, keine erfundenen Fakten).

### REFACTOR

Neue Ausreden aus GREEN in die Tabelle. Keine Nuanceklausel.

---

## 10. Checkliste vor SKILL.md

- [ ] Scope oben bestätigt
- [x] RED 1–10 ohne Skill, Ausreden wörtlich (`red/baseline/`)
- [x] Voice-Sample: Skill verlangt es (Stimme unbekannt markieren)
- [x] YAML: name + Use-when, kein Ablauf
- [x] SKILL.md dünn, Recherche nicht dupliziert
- [x] `silence` und Exit-Verbot stehen
- [x] Wahrheitsschienen (MwSt, Haftung, Fuhrpark) stehen
- [x] GREEN 10/10 Schienen (`red/green/SUMMARY.md`)
- [x] Runtime-Kopie nach GREEN (`~/.agents`, `~/.grok`, `~/.claude` / `service-chat-diagnose`)

---

## 11. Noch offen (Mensch)

1. Endgültiger Skill-Name.
2. 5 echte eigene Nachrichten als Stimme.
3. 3–8 anonymisierte echte Chats als Fallakten.
4. Ob Kalkulation später ein separates Tool wird (empfohlen: ja, nicht im Schreib-Skill).
