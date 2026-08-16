# Funnel im Chat: von der ersten Nachricht bis Auftrag (oder Absage)

Stand: 2026-08-15.

Der Chat ist kein Formular und kein Geschäftsbrief. Die meisten Verluste entstehen, bevor je ein Preis genannt wird: die erste Bubble stapelt sechs Fragen, der Kunde beantwortet die letzte oder keine. Ein verbindlicher Festpreis nach Fotos ist das richtige Produkt, aber die Qualifizierung muss wie ein Gespräch laufen, nicht wie eine Checkliste. Pro Stadium hat die nächste Nachricht genau einen Job. Zwei Sprechakte in einer Bubble (Preis plus Upsell plus Termin plus Bewertung) sind der zuverlässigste Close-Killer.

## Wozu diese Datei da ist

Diagnose-Grundlage für den späteren Skill: **in welchem Stadium der Chat steht, welcher Job die nächste Nachricht hat, und welcher Job verboten ist**.

Sie ist kein `SKILL.md`. Sie ist kein Baustein-Archiv. Sie enthält keine 20 WhatsApp-Vorlagen.

Sie prüft den Ist-Zustand in `reaktion.md` und `segmente.md` und darf ihn widerlegen. Sie gilt für Kottke Umzüge (Festpreis nach 5 bis 10 WhatsApp-Fotos, Kleinunternehmer §19 UStG, gesetzliche Mindesthaftung, Region Stuttgart) und soll auf Küche/Handwerk erweiterbar bleiben.

Sie ist **nicht** die Rechtsdatei (UWG, DSGVO, Widerruf). Wo Recht den Funnel zwingt, steht eine kurze Kante plus Verweis. Sie ist **nicht** die Follow-up-Datei (Kadenz nach Stille). Sie ist **nicht** die Einwand-Datei (Preis, Schwarz, Versicherung).

## Kernsatz

Der Funnel stirbt selten am Preis. Er stirbt an der nächsten Frage, die zu früh, zu viele oder die falsche ist.

---

## 1. Der Funnel, den der Chat wirklich hat

Klassisches Home-Service-Modell (übertragbar, nicht DE-Gesetz):

`Anfrage → Qualifizieren → Angebot → Close → Job-Tag-Kommunikation`

Für Kottke ist die reale Kette enger, weil das Produkt **Festpreis nach Foto** ist und der Hauptkanal **WhatsApp nach Kleinanzeigen** ist:

`Roh-Lead → fehlende Preishebel holen → Fotos → Festpreis raus → eine Zusage-Frage → Termin halten → Vortag/Tag → Aftercare`

Zwei Drop-off-Stellen sind branchenweit die teuren. Beide sind messbar, beide werden in DE-Umzugsverbandsstatistiken **nicht** veröffentlicht.

| Stelle | Was passiert | Typische Ursache im Chat |
|---|---|---|
| Anfrage wird nie Angebot | Kunde liefert keine kalkulierbaren Daten | Frage-Stapel, langsame Antwort, Formular-Ton, kein Grund warum Fotos |
| Angebot wird nie Auftrag | Kunde vergleicht oder friert | Preis ohne Scope, "ab", keine nächste Handlung, Druck, zu viele Akte in einer Bubble |

### 1.1 Was sich zu Drop-off halten lässt

**DE Umzug, Anfrage→Angebot→Auftrag: keine belastbare AMÖ-Quote gefunden.** Der Bundesverband veröffentlicht Qualitäts- und Verbrauchertipps, keine Conversion-Funnels seiner Mitglieder. Jede erfundene "30 Prozent Abschlussquote für Umzug DE" wäre Stufe E.

Was es gibt:

| Befund | Zahl / Aussage | Stufe | Quelle |
|---|---|---|---|
| DE: nur 18 % der Umziehenden beauftragen überhaupt ein Unternehmen | 53 % komplett selbst, 33 % Transporter/Anhänger | **A** | Deutsche Post Adress, Umzugsstudie 2024, n = 1.038 plus 3,5 Mio. Adressen 2023 |
| DE: von den 18 % wollen die meisten Transport + Möbelabbau/-aufbau, selten Packservice | Transport 86 %, Abbau 66 %, Aufbau 55 %, Kartons 43 %, Einpacken 12 %, Auspacken 7 % | **A** | dieselbe Studie |
| DE: Median-Ausgaben rund um den Umzug ca. 2.000 EUR, Mittel 5.130 EUR | Eigentümer viel höher als Mieter | **A** | dieselbe Studie |
| DE Handwerk: Auftragsquote (Auftrag ÷ abgegebene Angebote) unter 50 % gilt als Problem | Top Bauhandwerk 70 bis 80 % | **B** | handwerk magazin, 2023. Keine n, Branchenrichtwert |
| US/CA Umzug: Lead→gebucht im Schnitt 39 % | Top 50 %+ ; Time-to-book 2,5 Tage; nur 38 % antworten in 5 Min. | **D** für DE | SmartMoving State of Moving 2026, n = 484 Firmen, Vendor-Umfrage |
| US Web-Leads: Kontakt in der ersten Stunde qualifiziert ~7× so oft wie in der zweiten | 24 h warten: ~60× seltener Quali | **B** Mechanismus, **D** Zahl für DE-WhatsApp | Oldroyd, McElheran, Elkington, HBR 2011 (2.241 US-Firmen) plus Oldroyd 2007 LRM |
| US "78 % kaufen beim Erstantworter" | weit zitiert, **kein** sauberer Primärbeleg | **E** | Marketing-Folklore, oft McKinsey/InsideSales zugeschrieben |

**Inferenz (nicht messen, bis Kottke eigene Zahlen hat):** Auf Kleinanzeigen ist der erste Bruch größer als im klassischen Handwerk. Viele Erstnachrichten sind "Preis?" ohne Adresse. Die Angebotsquote (Angebote ÷ Anfragen) wird deshalb tiefer liegen als die Auftragsquote (Aufträge ÷ Angebote). Wer nur die zweite misst, schönt.

**Skill-Folge:** Funnel nicht als eine Quote führen. Mindestens drei Brüche: Roh→qualifiziert, qualifiziert→Angebot raus, Angebot→won. Ohne eigene n keine Zielprozente in den Skill schreiben.

### 1.2 Geschwindigkeit ist der erste Funnel-Hebel, nicht der Text

Die HBR/Oldroyd-Linie ist US und oft B2B-Webformular. Der **Mechanismus** überträgt: der Kunde schreibt parallel drei Anbieter. Wer zuerst eine *menschliche, konkrete* Antwort gibt, sitzt im Vergleichsset. Wer nach Stunden mit einer Checkliste kommt, ist der vierte PDF-Stapel.

Das SLA in `reaktion.md` (Werktag 1 Stunde, Sa 2, So 4; nicht versprechen was man nicht hält) ist **richtungsgleich** mit der Evidenz. Die konkrete Formulierung "Festpreis binnen 1 Stunde" ist gefährlich, wenn noch keine Fotos da sind. Dann ist das Versprechen ein anderer Sprechakt als die Realität.

**If-then:** Erste Bubble in der SLA-Zeit. Inhalt der ersten Bubble ist *nicht* automatisch das Angebot. Inhalt ist: gesehen + eine fehlende preisrelevante Sache + (wenn schon genug da) Fotos oder Preis.

### 1.3 Der Kunde holt drei Angebote. Das ist kein Einwand, das ist der Markt.

AMÖ rät Verbrauchern ausdrücklich zu drei Angeboten und kühlem Vergleich. Verbraucherzentrale ebenso. Wer im Chat so tut, als sei Vergleich illoyal, verliert Trust.

**If-then:** Nie "warum vergleichen Sie?". Wohl: Scope so klar machen, dass der Vergleich nicht nur die Zahl trifft.

---

## 2. Qualifizierung ohne Verhör

### 2.1 Was wirklich preisrelevant ist

Für Festpreis nach Foto bei Lokalumzug (und analog für Entrümpelung, später Küche) sind das die Hebel. Reihenfolge ist die des **Filters**, nicht die eines Lebenslaufs.

| Rang | Hebel | Warum preisrelevant | Wann in der ersten Bubble |
|---|---|---|---|
| 1 | Termin oder Fenster | Kapazität, Wochenende, Monatsende, Vorlauf | Ja, wenn nicht schon genannt. Kill-Kriterium. |
| 2 | Beide Orte grob (Stadt/Ort, nicht Hausnummer) | Gebiet, Distanz, Innenstadt-Parken | Ja, grob. Straße später. |
| 3 | Etage + Aufzug beide Seiten | Trageweg ist oft der größte Stundenhebel neben Volumen | Ja, wenn nicht aus Fotos/Text klar |
| 4 | Volumen | Fotos schlagen qm und "3 Zimmer". Zimmerzahl ist nur Proxy | Fotos sind der Job, nicht die Schätzung |
| 5 | Sondergut | Klavier (Kottke: nein), Tresor, Werkstatt, Aquarium, Einbauschrank | Nur fragen, wenn Fotos es nicht zeigen oder Kunde andeutet |
| 6 | Gewünschter Scope | Nur Transport vs. Montage, Kartons, Halteverbot, Entsorgung | Nicht in Bubble 1. Kommt nach oder mit dem Preis. |

Alles andere ist **nicht** preisrelevant in Nachricht 1:

- E-Mail, Rechnungsadresse, Geburtsdatum
- "Wie sind Sie auf uns gekommen?"
- Versicherungsseminar
- Steuerabzug §35a
- Wie viele Kartons *schätzen* Sie (Fotos schlagen die Schätzung)
- Vollständige Straße plus PLZ plus Klingel, solange Stadt und Etage reichen
- "Haben Sie schon andere Angebote?"

AMÖ nennt als Kostenfalle 2: Angebot auf unvollständigen Angaben, vergessene Keller und Dachböden. Das ist das Argument **für Fotos**, nicht für eine sechsteilige Liste. **B** (Verbandstext, keine Quote).

### 2.2 Reihenfolge: erst Filter, dann Foto, dann Feile

```
Geht der Tag? → Sind beide Orte im Gebiet? → Fehlt Etage/Aufzug? → Fotos → Festpreis
```

Wer mit "Wohnungsgröße, beide Adressen komplett, Besonderheiten, 5 bis 10 Fotos" startet, vermischt **Disqualifikation** (wir können nicht) mit **Kalkulation** (was kostet es). Der Kunde hört: Bewerbung.

**If-then:**

- Wenn der Termin unmöglich ist: in Nachricht 1 ablehnen oder Alternative nennen. Nicht noch Fotos verlangen.
- Wenn außerhalb 60 km / kein Fernumzug: in Nachricht 1 ablehnen. Nicht die Liste weiterschicken.
- Wenn Termin und Ort passen: die *eine* größte Lücke schließen. Meist: Fotos, oder Etage falls Fotos schon da.

### 2.3 Was man in der ersten Bubble nicht stapeln sollte

Eine nummerierte 6er-Liste ist ein Formular, das zufällig in WhatsApp klebt. Typeform (eigene Benchmarks): Formulare mit **höchstens 6 Fragen** haben die höchsten Completion-Raten; unter einer Minute spürbar besser. Durchschnitt Completion ihrer One-Question-Forms ca. 47 %. **B** (Plattform-Benchmark, Selektion). Das ist Formular, nicht Chat. Im Chat ist die Last höher, weil der Kunde tippt und keinen Fortschrittsbalken sieht.

Huang, Yeomans, Brooks, Minson, Gino 2017, *JPSP*: mehr Fragen erhöhen Sympathie, **wenn es Follow-ups auf das Gesagte sind**, nicht ein Stapel neuer Themen. Speed-Dater mit mehr Follow-up-Fragen bekamen mehr zweite Dates. **A**. Übertragung auf Verkaufschat: eine Nachfrage zu *seinem* Satz ("3. Stock ohne Aufzug, richtig? Dann brauchen wir nur noch Fotos der großen Möbel") ist der Evidenzkern. Sechs neue Felder sind das Gegenteil.

Sweller 1988, Cognitive Load: Arbeitsgedächtnis hält wenige neue Elemente. Eine 6er-Liste plus SLA plus Telefon plus Grußformel ist extraneous load. **A** für Lernpsychologie, **Inferenz** für WhatsApp.

Gesprächspragmatik, Grice 1975, Maxime der Quantität: nicht informativer als nötig. Eine komplette Intake-Liste in Bubble 1 verletzt Quantität *und* Relevanz, wenn der Kunde schon "2-Zimmer Vaihingen nach Möhringen, 12.9." geschrieben hat. **A** Theorie, **Inferenz** Anwendung.

Praxisregel Chat (wiederholt in Conversational-UX, **C/D**): Menschen beantworten die **letzte** Frage in einer Bubble oder keine. Die fünf davor werden "später" und dann nie.

**If-then:** Erste Bubble = Spiegel dessen, was schon da ist + genau eine Lücke. Wenn wirklich drei Hebel fehlen, nicht drei Fragen: die tödlichste zuerst (Termin oder Gebiet), Rest später.

Ausnahme: Der Kunde *bittet* um die Liste ("was braucht ihr für ein Angebot?"). Dann darf eine kurze 3er-Liste stehen, nicht 6, und Fotos als letzter Punkt mit einem Satz warum.

---

## 3. Foto-first vs. Besichtigung-first

### 3.1 Das Spannungsfeld, in dem Kottke steht

Zwei seriöse Skripte existieren parallel in DE:

| Skript | Wer sagt es | Trust-Versprechen | Kosten für den Betrieb |
|---|---|---|---|
| "Wir kommen kostenlos vorbei" | Verbraucherzentrale Niedersachsen 2021; viele AMÖ-Betriebe | Seriös = jemand sieht die Wohnung | Anfahrt, No-Shows, Kalender |
| "Schicken Sie Fotos, Festpreis danach" | Kottke-Modell; umzug.org wirbt mit "ohne Besichtigung, online buchbar" | Schnell, verbindlich, kein Fremder in der Wohnung | Risiko Unterschätzung, Foto-Lücken |

Verbraucherzentrale (bundesweit, Stand 11.6.2025): vor dem Kostenvoranschlag machen sich Spediteure **vor Ort** schlau über Größe, Lage, Gut. Festpreis wird empfohlen, Leistung schriftlich. **B**.

Verbraucherzentrale Niedersachsen (2021, über Celler Presse): seriöse Anbieter kommen unverbindlich und kostenfrei nach Hause; seriöse verlangen **in der Regel keine Anzahlung**, bestimmt keine zweite. **B** (Behördenlinie, Einzelfallgeschichte).

AMÖ: drei Angebote, Leistungsumfang kennen, Keller/Dachboden nicht vergessen. Kleinanzeigen, nur Handy, Angebot ohne MwSt. gelten dort als **Unseriös-Signale**. **B** als Verbandstext, **politisch** gegen genau das Geschäftsmodell vieler Kleinbetriebe.

Kottke ist Kleinunternehmer, WhatsApp-first, Kleinanzeigen-first, ohne Festnetz, Foto-Festpreis. Das Modell ist legal und für 1- bis 3-Zimmer-Lokalumzug operativ richtig. Es muss im Chat die Trust-Arbeit leisten, die der Hausbesuch traditionell leistet. Nicht indem man so tut, als käme man immer vorbei.

### 3.2 Wann welches Format

US-Moving-Software (Elromco, HomeSurvey, SmartMoving) ist **D**, aber die operative Logik ist dieselbe:

- Fotos/Video skalieren. Vor-Ort verbrennt Schätzerzeit.
- Virtuelle Surveys unterzählen, wenn niemand nach Keller, Garage, unter dem Bett fragt (Elromco: 10 bis 15 % Unterzählung ohne Disziplin). **D**
- Komplexe Jobs (Nachlass, Firma, viel Sondergut) bleiben Vor-Ort-würdig.
- Completion bei asynchronem Video-Link hoch, weil kein gemeinsamer Termin nötig. **D**, Vendor.

**Für Kottke (Inferenz, an eigene Jobs kalibrieren):**

| Situation | Format | Warum |
|---|---|---|
| Standard 1 bis 3 Zimmer, Kunde schon auf WhatsApp, Fotos machbar | Foto-first | Passt zum Produkt, schnell, Vergleichsset |
| Fotos unscharf, Keller erwähnt, "vollgestellt", widersprüchliche Angaben | 4 gezielte Nachzieh-Fotos oder kurzer Video-Rundgang | Nicht gleich der LKW vors Haus |
| Senior, Angehörige organisiert, viel Erinnerungsgut, Unsicherheit | Vor-Ort oder Video-Call anbieten, nicht aufzwingen | `segmente.md` hat hier recht: Telefon/Besuch ist der Trust-Kanal |
| Firma / Büro / IT | Vor-Ort oder Video in den Räumen zur Geschäftszeit | Scope und Downtime, nicht nur m³ |
| Entrümpelung unklarer Bestand | Fotos plus "was bleibt, was weg" | Sonst Festpreis-Falle |
| Kunde fragt von selbst nach Besuch | Besuch anbieten oder ehrlich sagen, wann er nötig ist | Besuch verweigern, obwohl er ihn will = Misstrauen |
| Termin < 48 h und Fotos klar | Foto reicht, Besuch unmöglich | Zeit schlägt Ritual |

Video-Call (FaceTime/WhatsApp-Video, 10 bis 15 Min., fester Slot, nicht "zwischen 10 und 12"): Mittelweg, wenn Fotos nicht tragen und Vor-Ort zu teuer oder zu langsam ist. Elromco 2020: Kundenplattform wählen, vorher drei Bullet-Anweisungen, Schätzer führt. **D**.

### 3.3 Trust-Effekt der beiden Sätze

"Wir kommen kostenlos vorbei" senkt wahrgenommenes Risiko und erhöht Commitment des Kunden (jemand opfert Zeit). Es erzeugt auch **No-Shows** und Anker "die Zeit war schon die Beratung". Für ein 5-Personen-Team mit max. 3 pro Job ist der Hausbesuch als Default unwirtschaftlich.

"Schicken Sie Fotos" kann sich anfühlen wie: Sie tun die Arbeit, wir bleiben unsichtbar. Der Satz braucht **warum** in einem Atemzug: "Dann können wir einen Festpreis nennen, ohne dass Sie uns erst ins Haus lassen." Das kehrt den Trust: Foto ist Bequemlichkeit, nicht Misstrauen.

**If-then:**

- Foto nie als Befehl ("benötigen wir folgende Infos: 6. Bitte 5 bis 10 Fotos").
- Foto als Weg zum Festpreis, mit Obergrenze ("5 bis 10 Stück der großen Möbel, Keller wenn voll, reicht").
- Besuch nie als Alltagsversprechen in der Kleinanzeigen-Erstantwort. Besuch als Option, wenn Segment oder Unklarheit es verlangt.
- Wenn Besuch angeboten: fester Slot, nicht Fenster. Sonst fühlt es sich nach Kabel-Techniker an.

---

## 4. Eine Frage vs. Liste

### 4.1 Der Interview-Stapel ist ein Conversion-Killer

Drei unabhängige Linien zeigen in dieselbe Richtung, keine davon ist "WhatsApp-Umzug DE":

1. **Gespräch:** Follow-up auf das Gesagte > neuer Fragenkatalog (Huang et al. 2017, **A**).
2. **Formular:** weniger und kleinere Happen, Begründung *warum* vor dem Block (Typeform Data-on-Data; Intro-Satz hebt Completion, **B**).
3. **Chat-UX:** Bots und Menschen führen lineare Flows. Weicht der Nutzer ab oder bekommt sechs Prompts auf einmal, bricht der Flow (Nielsen Norman Group, Chatbot-UX 2018, kleine n=8, **B/C** für UX-Richtung, nicht für Quote). Vorteil von Chat: weniger Information Overload, *solange* der Flow eine Aufgabe zur Zeit hat.

**Inferenz:** Eine nummerierte Intake-Liste in Nachricht 1 ist das schlechteste aus beiden Welten. Sie hat die Kälte des Formulars und die Unübersichtlichkeit des Chats.

### 4.2 Wann eine Mini-Liste erlaubt ist

| Erlaubt | Nicht erlaubt |
|---|---|
| Kunde fragt "was braucht ihr?" | Kunde hat schon 4 von 6 geliefert |
| Nach Zusage, Ops-Daten (genaue Straße, Etage bestätigt, Halteverbot ja/nein) | Vor dem Preis, gemischt mit Trust-Floskeln |
| 3 Punkte, letzter = Fotos | 6 Punkte plus Telefon plus SLA plus Signatur |
| Ein Satz Zweck davor | "Damit wir Ihnen ein verbindliches Festpreisangebot machen können, benötigen wir folgende Infos:" plus Amtsdeutsch |

### 4.3 Diagnose im Kunden-Text

Der Skill muss **zuerst zählen, was schon da ist**. Nicht die Standardliste senden.

Signale "Liste wäre tödlich":

- Kunde hat Adressen, Tag, Zimmer schon genannt
- Kunde hat Fotos geschickt und "was kostet das?"
- Kunde schreibt in einer Zeile, Du, ohne Satzzeichen (Student/eilig)
- Zweite Nachricht nach einer unbeantworteten 6er-Liste: dann nicht dieselbe Liste nochmal

Signale "eine geordnete Mini-Liste hilft":

- "Was braucht ihr für ein Angebot?"
- Firma, mehrere Stakeholder, will weiterleiten
- Senior/Angehörige, bittet um Übersicht
- E-Mail-Kanal (dort ist Liste natürlicher als auf WhatsApp)

---

## 5. Angebot im Chat

### 5.1 Drei Preisformen, drei Jobs

| Form | Job | Wann | Risiko |
|---|---|---|---|
| **Festpreis** | Close-fähig, vergleichbar | Nach Fotos + Hebeln | Unterschätzung geht zu Lasten des Betriebs (VZ sagt das explizit) |
| **Spanne** | Ehrliche Unsicherheit | Fotos lückenhaft, Keller unbekannt, Montage unklar | Kunde hört die Untergrenze |
| **"ab"** | Anzeigen-Köder | Nur in der Anzeige, nie als Chat-Angebot | Anker unten, UWG-Nähe, Trust-Bruch |

Verbraucherzentrale 2025: Festpreis in den meisten Fällen empfehlen, Leistung exakt bestimmen. Stundenabrechnung: 15 bis 20 % über Kostenvoranschlag noch akzeptabel, darüber Streit. **B**.

AMÖ: Pauschale *und* nach Aufwand gleichzeitig = unseriös. **B**.

Kottke-Modell laut Profil: Spannen in der Anzeige, **verbindlicher** Festpreis nach Foto. Das ist konsistent, wenn der Chat die Grenze hält: Anzeige darf "2 Zimmer 490 bis 790" zeigen. Die WhatsApp-Zahl nach Fotos ist eine Zahl, keine neue Spanne, außer eine echte Lücke bleibt.

### 5.2 Preispsychologie, die den Chat wirklich betrifft

| Mechanismus | Was er im Umzugs-Chat tut | Stufe |
|---|---|---|
| **Verlustaversion** (Kahneman/Tversky 1979, Prospect Theory) | Angst vor Nachkarten am Umzugstag > Freude über 80 EUR Ersparnis. Festpreis verkauft Sicherheit, nicht Billig. | **A** Theorie, **Inferenz** Anwendung |
| **Anker** (Tversky/Kahneman 1974; Ariely-Replikationen) | Erste Zahl klebt. "ab 290" macht 690 zum Aufschlag. Die Festpreis-Zahl muss die erste *verbindliche* Zahl im Chat sein. | **A** |
| **Vergleichsset** | Kunde hat Check24/Jobruf/drei Kleinanzeigen-Chats. Er vergleicht die Zahl, wenn der Scope unsichtbar ist. | **C** plus AMÖ-Rat **B** |
| **"ab" als Irreführung** | EuGH C-122/10: Mindestpreis nicht per se illegal. DE-Linie: realistisches Preisniveau, beworbene Leistung zu diesem Preis tatsächlich erreichbar (IT-Recht Kanzlei; OLG Celle Fahrschule "ab"). | **B** Recht. Im Chat trotzdem meiden. |

**If-then für die Preis-Bubble:**

- Eine Zahl. Währung EUR. Brutto = Endpreis, weil Kleinunternehmer (kein "inkl. 19 % MwSt", das wäre falsch).
- Direkt darunter: wofür (von-nach, Tag, was drin, was nicht).
- Nicht "ab". Nicht "ca.". Nicht "je nach Aufwand".
- Wenn unsicher: Spanne *mit Grund* ("Keller auf den Fotos nicht zu sehen, deshalb 890 bis 990, nach 3 Kellerfotos eine Zahl").
- Schriftlich reicht WhatsApp. WhatsApp kann Willenserklärung sein (Angebot und Annahme, sofern keine Formvorschrift). Detail in der Rechtsdatei. Funnel-Folge: die Preis-Bubble so schreiben, als würde sie vorgelegt.

### 5.3 Was ins Angebot gehört, was nicht in *dieselbe* Bubble

Gehört in die Preis-Bubble (ein Sprechakt: **Angebot unterbreiten**):

- Zahl
- Tag / Fenster
- Von-nach grob
- Leistung in 3 bis 5 Strichen, Sprache des Kunden
- Eine Gültigkeit (siehe Close)
- Eine nächste Handlung

Gehört **nicht** in dieselbe Bubble:

- Upsell-Menü (Kartons, Halteverbot, Einlagerung) als Verkauf
- Bewertungslink
- Versicherungsseminar
- Steuer-Tipp gegen Schwarz
- "Rufen Sie uns an unter … oder WhatsApp … oder Mail …" (drei Kanäle = drei Ausgänge)
- Vollständige AGB
- 19 % MwSt (sachlich falsch)
- "Transportversicherung bis X EUR" (Produkt gibt es so nicht; es ist gesetzliche Mindesthaftung)

Haftung: Profil und Brief sagen §451g HGB, 620 EUR/m³. Verbraucherzentrale nennt §451e für die Höhe 620 EUR/m³. Das ist eine Rechts-Lücke, kein Funnel-Gesetz. Funnel-Regel: nicht "vollversichert" sagen. Nicht "unsere Transportversicherung". Wenn der Kunde fragt: eine ehrliche Haftungssätze-Bubble, nicht im Preis verstecken.

### 5.4 Spanne in der Anzeige vs. Zahl im Chat

`segmente.md` nutzt "Festpreis-Beispiele ab {pauschal_2z} EUR". Das ist Anzeigen-Handwerk, nicht Chat-Angebot. Sobald der Chat eine "ab"-Zahl als *sein* Angebot wiederholt, hat der Anker gewonnen.

**If-then:** Kunde zitiert die Anzeige ("ihr schreibt ab 490"): nicht verteidigen, übersetzen. "Die 490 ist das untere Ende einer 2-Zimmer-Spanne. Mit Ihren Fotos nenne ich Ihnen die Zahl für genau Ihren Weg."

---

## 6. Close im Chat ohne Druck

### 6.1 Was Close hier heißt

Nicht Unterschrift-Theater. Close = der Kunde macht die **eine** nächste Handlung, die den Tag bindet.

Wirksame nächste Handlungen, aufsteigend nach Härte:

1. "Passt der Dienstag so?" (Bestätigung)
2. "Wenn ja, blocke ich den 12.9. für Sie." (Kalender, noch ohne Geld)
3. "Ich schicke die kurze Bestätigung hier im Chat, Sie antworten mit 'passt'." (schriftliche Annahme)
4. Anzahlung (in diesem Markt meist schädlich, siehe unten)

Verbraucherzentrale Niedersachsen: nicht zum Vertragsschluss drängen, Bedenkzeit, **kein gesetzliches Widerrufsrecht** beim Umzug zu festem Termin (Kapazitätsbereitstellung). **B**. Das ist die ehrliche Close-Lage: der Kunde *hat* weniger Schutz als im Fernabsatz-Shop, deshalb darf der Ton nicht nach Falle klingen.

### 6.2 Gültigkeit "14 Tage"

BGB: Angebot bindet (§ 145), erlischt bei Ablehnung oder nicht rechtzeitiger Annahme (§ 146). Ohne Frist gilt § 147 Abs. 2 (unter regelmäßigen Umständen erwartbare Antwort). Schriftliche Angebote ohne Datum können länger binden als einem lieb ist. **A** Gesetz.

Praxis Handwerk: 7 bis 14 Tage kleine Aufträge, 14 bis 30 größere. Wiederholte Ratgeberlinie, **C** für Üblichkeit, rechtlich zulässig **A**.

Für einen Lokalumzug mit Wochenend-Engpass ist 14 Tage oft **zu lang** (der Samstag ist in 6 Tagen weg). Für einen Umzug in 8 Wochen ist 14 Tage fair.

**If-then:**

- Immer ein Enddatum, nicht nur "14 Tage".
- Das Datum an *Kapazität* koppeln, nicht an künstliche Knappheit. "Den 12.9. kann ich bis Mittwochabend frei halten." ist Close. "Angebot verfällt heute Abend" ist Druck.
- Wenn der Termin weiter weg ist: 14 Tage auf den *Preis*, kürzer auf den *konkreten Samstag*.

### 6.3 Anzahlung

Zwei DE-Linien, die sich nicht vertragen:

| Linie | Aussage | Stufe |
|---|---|---|
| VZ Niedersachsen / Aktiv-Online-Ratgeber | Seriöse Umzugsfirmen verlangen in der Regel **keine** Anzahlung. Vorkasse = Warnsignal. Zweite Vorauszahlung = Alarm. | **B/C** |
| Handwerk allgemein (Material) | 10 bis 30 % üblich, bei Material 40 bis 50 %. Nicht in AGB pauschal (BGH-Linie zu vorformulierten Klauseln). Werklohn grundsätzlich nach Abnahme. | **B** Recht, **C** Höhe |
| VZ allgemein Handwerk | Höchstens ca. 10 % Anzahlung raten, Insolvenzrisiko | **B** |

Für Kottke-Umzug (wenig Materialvorschuss, Team+Sprinter, Kleinanzeigen-Misstrauen): Anzahlung als Default **schadet Trust mehr als sie No-Shows spart**. Das ist Inferenz, aber die Verbraucherschienen sind eindeutig.

Wann Anzahlung später Sinn ergibt (Erweiterung Küche/Handwerk): Materialbestellung, Sonderanfertigung, hoher Auftragswert. Dann individuell, nicht als Chat-Floskel, nicht in der Preis-Bubble verstecken.

**If-then Umzug:** Close über Terminblock + schriftliche WhatsApp-Bestätigung. Geld am/nach Job, Rechnung ohne MwSt-Ausweis. Anzahlung nur wenn der Kunde selbst fragt oder ein teurer Fremdkostenblock (Halteverbot schon beantragt, Kartonlieferung vorher) entsteht. Dann Betrag benennen und wofür.

### 6.4 Schriftliche Bestätigung

Die Folge-Antwort in `reaktion.md` stapelt: Angebot + "gilt 14 Tage" + "schriftliche Bestätigung per E-Mail" + "Zusage per WhatsApp oder E-Mail". Das sind drei Close-Pfade.

**If-then:** Ein Pfad. Im WhatsApp-Chat: Annahme = Antwort im selben Chat. E-Mail-PDF danach als Kopie, nicht als zusätzliche Hürde vor der Zusage. Firma/Office-Manager darf E-Mail als *seinen* Pfad bekommen.

### 6.5 Druck-Marker, die verlieren

- "Nur noch ein Slot"
- "Heute unterschreiben"
- Preis + Bewertungslink
- "Andere warten auf den Termin" (kann wahr sein, klingt nach Markt)
- Rabatt gegen Sofortzusage (senkt den Anker des Festpreises dauerhaft)

Erlaubt: ehrliche Kapazität. "Den 28. (Monatsende) habe ich noch frei, den 4. auch. Der 28. ist der letzte Samstag im Monat, der geht zuerst." Information, kein Theater.

---

## 7. Quali-Filter und Absage

### 7.1 Wann ablehnen

Die Filter in `reaktion.md` sind im Kern richtig. Schärfung:

| Filter | Nehmen | Ablehnen / umleiten | Evidenz |
|---|---|---|---|
| Termin < 24 h, Kalender voll | Nur wenn real frei *und* Fotos klar | Absage oder nächster freier Tag | Ops, nicht Psychologie |
| Außer Gebiet, kein Fernumzug | (leer) | Absage, kein Foto-Verhör | Profil |
| Budget > 50 % unter Markt / Schwarz-Signal | Nicht predigen | Klare legale Zahl oder Absage | Einwand-Datei vertieft |
| Kein Detailwille nach *einer* konkreten Nachfrage | (leer) | Absage ohne Moral | C, wiederholte Handwerkerberichte |
| Klavier / nicht angebotene Leistung | (leer) | Absage + ehrliche Grenze (Profil: kein Klavier) | DHZ: nicht angebotene Leistung klar sagen **C** |
| "Zu klein" | Nicht als Grund sagen | Entweder kurzer Job oder Absage über Kapazität | DHZ/Steinseifer: "zu klein" nie sagen **D**, aber reputationsklug |
| Schwieriger Bestandskunde / Zahlungsausfall | Intern markieren | Kapazitätsgrund, keine Moralpredigt | DHZ **D** |

Schwarzarbeit-Signal ist ein Filter, keine Chance für eine Steuerstunde. Die Standardantwort in `reaktion.md` (§35a, 1.200 EUR) ist inhaltlich oft richtig und im *Ton* eine Belehrung. Funnel-Job: eine klare Nein-Linie. Begründung maximal ein Satz. Kein Aufsatz.

### 7.2 Absage, ohne Google zu riskieren

Es gibt **keine** Studie "Absage-Ton → Review-Wahrscheinlichkeit". Was es gibt:

- Google: Rezensionen von Personen ohne tatsächliche Erfahrung können gegen Richtlinien verstoßen, Google schlichtet aber keine Konflikte. Eine Interaktion (Chat, Absage) reicht manchen, um zu bewerten. **B** Policy, **C** Missbrauch.
- DHZ 2022/23, Klaus Steinseifer: größter Fehler ist von oben herab. Verständnis + Bedauern + Grund, der nicht die Person beleidigt. Weitervermitteln, wenn ehrlich. **C/D**
- Brightlocal o. ä. Review-Studien sind US-Lokal und **D** für diesen Fall.

Risiko-Reihenfolge der Absagegründe (Inferenz):

1. **Sicher:** ausgebucht, Gebiet, Leistung nicht im Angebot
2. **Mittel:** zu kurzfristig (Kunde hört "ihr wollt nicht")
3. **Gefährlich:** "Sie liefern keine Infos", "Ihr Budget ist unrealistisch", "das lohnt sich nicht", Schwarz-Verdacht aussprechen
4. **Tödlich:** belehren, ironisch, "was glauben Sie wie voll wir sind"

**If-then Absage:**

- Danke + Bedauern + *ein* sachlicher Grund + Tür (späterer Monat / andere Leistung), optional ein konkreter Kollege nur wenn man ihn vertreten kann.
- Kein Bewertungslink.
- Kein "empfehlen Sie uns weiter".
- Kein Paragraph, keine drei Alternativ-Anbieter-Portale als Abwimmelung.
- Nicht "unqualifiziert" zum Kunden sagen. Das ist internes CRM.
- Nach Absage nicht nachfassen wie ein Angebot. Eine höfliche Tür reicht.

Wenn der Kunde nach Absage unhöflich wird: nicht den letzten Satz gewinnen. Eine ruhige Zeile, dann Schluss. Review-Risiko steigt mit der Länge des Streits, nicht mit der Kürze der Absage. **Inferenz**.

---

## 8. Stadien-Modell

Labels sind Verhaltensverträge, keine Stimmung. Der Skill liest das Stadium am *letzten Kundenturn* plus dem, was intern schon raus ist (wurde ein Preis genannt? Fotos da?).

| Stadium | Was wahr ist | Job der nächsten Nachricht | Verbotener Job |
|---|---|---|---|
| `lead-raw` | Irgendeine Anfrage, oft "Preis?", oft ohne Hebel | Gesehen werden. Eine Filterfrage oder die eine Lücke. Tempo. | 6er-Liste, Preis raten, Versicherungsaufsatz, Anzeigen-Pitch wiederholen |
| `qualifying` | Gespräch läuft, Hebel unvollständig | Das fehlende *eine* Preisding holen. Spiegeln was da ist. | Neu von vorn, zweite Liste, Upsell |
| `awaiting-photos` | Hebel ok, Volumen fehlt | Fotos leicht machen (was, wie viele, warum). Optional: "Keller extra". | Weitere demografische Fragen, "und E-Mail bitte auch" |
| `quote-out` | Zahl ist draußen, keine klare Annahme | Eine Verständnisfrage *oder* ein Termin-Halt. Nachfassen ist eigene Datei. | Zweite Zahl ohne Anlass, Upsell-Menü, Review, Drohung mit Verfall |
| `negotiating` | Preis, Scope oder Tag wird geschoben | Scope tauschen, nicht Feilschen um die Zahl. Eine Alternative. | "Ok 50 EUR weniger" ohne Gegen-Scope; Moral; Vergleich schlechtreden |
| `won` | Klare Annahme im Chat/Mail | Ops-Minimum: genaue Treffpunkte, Zeitfenster, was der Kunde vorbereitet. Eine Sache pro Bubble. | Verkauf, Cross-Sell-Stapel, Bewertungsbitten |
| `lost` | Absage durch uns oder ihn, oder tot nach Follow-up-Ende | Tür sauber zumachen oder schweigen | Überreden, "letzter Preis", Review-Bitte |
| `job-prep` | Auftrag fest, Tag kommt | Erinnerung, Zeitfenster, Halteverbot-Status, "Fotos noch was dazugekommen?" | Preis neu verhandeln, neue Leistungen heimlich |
| `on-job` | Team ist unterwegs / vor Ort | Kurze Lage (ETA, Verzug). Eine Info. | Marketing, Upsell am Treppenabsatz per Chat |
| `aftercare` | Job durch | Eine Sache: Rechnung *oder* "alles angekommen?" Schaden zuerst behandeln (Recovery-Datei). Review erst nach ruhigem Abschluss. | Preis + Review + Instagram in einer Bubble |

Zusatzzustände, die der Skill erkennen sollte, ohne die Liste zu sprengen:

- `visit-offered` / `visit-set`: Besuch ersetzt oder ergänzt Fotos. Nächster Job: Slot halten, nicht parallel die 6er-Liste.
- `hold`: Termin mündlich/chat geparkt, Annahme noch weich. Job: eine klare Annahme-Frage vor dem Tag.

Übergänge:

- Fotos komplett + Hebel da → nicht in `qualifying` bleiben → `quote-out` in der SLA-Zeit.
- Kunde sendet Gegenangebot → `negotiating`, nicht neues Full-Quote-Template.
- "Wir müssen uns das überlegen" bleibt `quote-out`, wird nicht `lost`. Lost erst nach Follow-up-Ende oder klarer Absage.
- Schadenmeldung überspringt Review und wird Recovery, nicht Aftercare-Marketing.

---

## 9. Zwei Sprechakte in einer Bubble

Sprechakttheorie (Austin 1962; Searle 1969, **A** als Linguistik): jede Äußerung hat eine illokutionäre Kraft. Bitten, anbieten, warnen, danken sind verschiedene Akte.

Im Chat muss der Empfänger den Akt *wählen*, auf den er antwortet. Vier Akte in einer Bubble erzeugen Freeze oder die billigste Antwort ("👍" auf nichts Bestimmtes).

**Fail-Muster (aus `reaktion.md` rekonstruierbar):**

1. Danken
2. Sechs Infos verlangen
3. SLA versprechen
4. Zwei Kanäle anbieten
5. Formal grüßen

Oder in der Angebots-Bubble:

1. Preis nennen
2. Leistungsliste
3. Versicherung
4. 14 Tage
5. E-Mail-Bestätigung
6. WhatsApp-Zusage
7. Telefon in der Signatur

**Regel für den Skill (Inferenz, hart):** Eine Bubble, ein primärer Akt. Ein sekundärer Akt nur wenn er *dieselbe Antwort* benutzt ("890 EUR für den 12.9., Montage drin. Soll ich den Tag blocken?"). Das ist Angebot + eine Entscheidungsfrage, ein Antwort-Slot.

Verbotene Paare in einer Bubble:

- Preis + Upsell
- Preis + Review
- Absage + Newsletter/Google
- Foto-Bitte + Steuer-Tipp
- Terminbestätigung + "und falls Sie noch Keller haben plus Kartons plus Bewertung"

NN/g 2018: Chat verträgt wenig Displayfläche und einfache lineare Aufgaben. Komplexität gehört nicht in eine Nachricht. **B/C**.

---

## 10. Ist-Zustand: `reaktion.md` und `segmente.md` zerlegt

Nicht höflich. Der Skill soll diese Texte nicht als Goldstandard laden.

### 10.1 Was gut ist

- Reaktionszeit als eigener Hebel, und die Warnung, kein SLA zu versprechen, das bricht. Passt zu Oldroyd/HBR.
- Segment-Ton in der *Idee*: Sie Standard, Du Student, EN extra. Accommodation schlägt Universal-Brief.
- Quali-Filter existieren (kurzfristig, Gebiet, Schwarz-Indikator, kein Detailwille).
- Preis runter nur über Scope (Montage weglassen, Halteverbot selbst), nicht über "Rabatt". Das schützt den Festpreis-Anker.
- Ankunft als 2-Stunden-Fenster, exakt am Vortag. Ops-ehrlich.
- `segmente.md`: Senior = Telefon/Besuch, Firma = Besichtigung, Student = knapp. Die *Regler* stimmen, auch wenn die Copy nicht in den Chat gehört.

### 10.2 Was zu lang ist

Das Privat-Ersttemplate ist ein Brief. Anrede, Danksatz, Zweck-Satz, 6 nummerierte Felder, SLA, zwei Telefone, Gruß, Firmenname. Auf WhatsApp nach "Was kostet 2 Zimmer?" ist das eine Wand.

Das Studenten-Template ist besser (kürzer, Du, Spiegelstriche statt Amtsnummern) und immer noch eine 5er-Liste plus "Preis in 1 Stunde" plus Anruf.

Das EN-Template ist 1:1-Übersetzung des DE-Briefs. Expats auf Kleinanzeigen schreiben oft eine Zeile. Sie bekommen ein Formular.

Das Angebots-Template ist eine E-Mail, die so tut, als wäre sie WhatsApp. Zeile für Adresse, qm, Zimmer, 5 Leistungsstriche, Versicherung, MwSt, 14 Tage, E-Mail-Bestätigung, Zusage-Kanal.

### 10.3 Was nach Copy-Paste / KI wirkt

Marker:

- "vielen Dank für Ihre Anfrage. Damit wir Ihnen ein verbindliches Festpreisangebot machen können, benötigen wir folgende Infos:"
- Nummerierung 1. bis 6. in der ersten Antwort
- "Mit freundlichen Grüßen / {name} / Kottke Umzüge" nach jeder Bubble
- Platzhalter-Sprache in der Absage: "Empfehlung: {alternativ-anbieter-suchen | spätere Anfrage}"
- Identische Struktur DE/Du/EN, nur Pronomen getauscht
- Leistungsblock, der nicht auf das reagiert, was der Kunde geschrieben hat

Ein Mensch, der den Chat gelesen hat, fängt mit dem konkreten Satz des Kunden an. Templates, die das nicht können, entlarven sich in Zeile 1.

### 10.4 Was sachlich falsch oder gefährlich ist

| Stelle | Problem | Funnel-Effekt |
|---|---|---|
| Angebots-Template: "Festpreis: {preis} EUR brutto (inkl. 19 Prozent MwSt)" | Firma ist Kleinunternehmer §19. Kein MwSt-Ausweis. | Glaubwürdigkeit, später Rechts/Rechnungsärger |
| "Transportversicherung bis {versicherung} EUR" / "vollversichert" in Segment-Hooks | Produkt ist gesetzliche Mindesthaftung, keine Extra-Police | VZ/AMÖ-Leser haken nach; bei Schaden Eskalation |
| Schadens-Antwort: Selbstbehalt 250 EUR | AMÖ listet Selbstbeteiligung als Unseriös-Signal | Trust-Bruch genau dort, wo Sicherheit verkauft werden soll |
| Festnetz in Templates | Profil: Festnetz null, nur Mobil | Versprechen eines Kanals, den es nicht gibt |
| Student-Templates vs. `studentenumzug: false` im Profil | Skill würde ein Segment bedienen, das operativ aus ist | Falsche Erwartung "auch kurzfristig WG" |
| `segmente.md` Familienbetrieb, Profil `familienbetrieb: false` | Anzeigen-USP, der im Chat nicht haltbar ist wenn gefragt | Eine Nachfrage zerlegt den Text |
| SLA "Festpreis binnen 1 Stunde" in der Erstantwort | Stunde gilt höchstens *nach* Fotos | Gebrochenes Versprechen = zweiter Sprechakt, der fehlschlägt |
| Schwarz-Antwort als Mini-Seminar §35a | Richtiges Thema, falsches Stadium | Belehrung statt Grenze |
| Absage-Template kalt, Grund als Platzhalter | DHZ: von oben herab verlieren | Unnötiges Review-Risiko |

### 10.5 `segmente.md` als Funnel-Regler, nicht als Chat-Text

Die Datei ist eine **Anzeigen**-Spec. Ihre CTA-Beispiele ("Schreiben Sie uns Wohnungsgröße, beide Stockwerke und Wunschtermin") sind für das Inserat akzeptabel. Als erste WhatsApp-Antwort nach genau dieser CTA sind sie redundant: der Kunde hat die Hausaufgabe schon gelesen und oft teilweise geliefert.

Funnel-Übersetzung der Segmente:

| Segment | Erste Chat-Bewegung | Nicht |
|---|---|---|
| Privat Standard | Sie, kurz, eine Lücke, Foto-Warum | Brief |
| Student (falls doch an) | Du, eine Zeile, Foto oder Tag | 5 Spiegelstriche |
| Senior | Sie, langsamer, Telefon/Besuch *anbieten* | Foto-Befehl ohne Alternative |
| Familie | Sie, Wochenende/Kinderzimmer aufgreifen wenn genannt | "Anzahl Kinderzimmer" als Formularfeld 1 |
| Firma | Sie, knapp, Entscheider + Wunsch-Zeit außerhalb Geschäftszeit, Besuch/Video | Pauschalpreis aus der Privat-Anzeige |

---

## Regler vs. Invarianten

**Immer (Invarianten):**

- Eine Diagnose, bevor formuliert wird: Ton, Segment, Stadium, schon gelieferte Hebel.
- Ein primärer Sprechakt pro Bubble.
- Kein Preis ohne die Hebel, die den Preis tragen (mindestens Ort, Tag, Volumen-Proxy/Fotos, Etage wenn mehrgeschossig).
- Kein "ab" als Chat-Angebot.
- Kein erfundener MwSt-Satz, keine erfundene Vollkasko-Versicherung.
- Ablehnen ohne die Person zu bewerten.
- Festpreis, wenn die Infos reichen. Unsicherheit als Spanne *mit Grund*, nicht als Weichspüler.
- Tempo der ersten menschlichen Antwort schlägt elegante Copy.

**Regler (ändern sich):**

- Sie/Du/EN, Länge, Emoji: Ton-Datei.
- Foto vs. Video vs. Vor-Ort: Segment + Unklarheit + Auftragswert.
- Gültigkeitsdatum: Nähe des Termins, nicht immer 14 Tage.
- Anzahlung: default aus bei Umzug, später an bei materialschwerem Handwerk.
- Mini-Liste vs. eine Frage: Kanal (Mail verträgt Liste) und ob der Kunde die Liste *erbeten* hat.
- Close-Härte: Firma mit Beschaffungsprozess ≠ Student mit Umzug in 5 Tagen.

---

## Diagnose-Signale für den späteren Skill

Der Agent liest im **letzten Kundenturn** (und im Verlauf) mindestens:

**Stadium**

- Steht schon eine Zahl von uns im Chat?
- Sind Fotos da? Wie viele, welche Räume fehlen offensichtlich?
- Hat er angenommen, abgelehnt, "ich überlege", "zu teuer", "schwarz"?
- Sind wir nach Zusage (Adresse fein, ETA, Schaden)?

**Hebel-Inventar** (Checkbox intern, nie als Liste zurücksenden)

- Tag/Fenster
- Ort raus / Ort rein (Stadt reicht zuerst)
- Etage + Aufzug beide Seiten
- Volumen (Fotos > Zimmer > qm)
- Sondergut
- Scope-Wünsche

**Job-Signal der Kunden-Bubble**

- Preisfrage ohne Daten → `lead-raw`
- Daten ohne Frage → Quali fast fertig, Foto oder Quote
- Foto + "?" → `quote-out` fällig, nicht danken und neu fragen
- "geht günstiger" → `negotiating`, Scope
- "passt" / "nehmen wir" → `won`
- "doch nicht" / Stille nach Follow-up-Ende → `lost`
- "das ist aber teuer weil bei dem anderen…" → Vergleich, Scope sichtbar machen, nicht schlechtreden

**Verbotene Fehl-Diagnose**

- Jede Erstnachricht als leeres Formular behandeln
- Jede Preisfrage als Einwand
- Jede langsame Antwort als Ghosting (Follow-up-Datei)

---

## Skill-Folgen (If-then, keine Line-Bibliothek)

1. **Wenn** der Kunde schon Tag, beide Städte und Etage geliefert hat **dann** nicht die 6er-Liste. **Dann** Fotos oder, wenn Fotos da, Preis.

2. **Wenn** nur "Was kostet ein Umzug?" **dann** nicht raten. **Dann** eine Filterfrage (wann, von wo nach wo). Optional ein Satz, dass der Festpreis nach Fotos kommt.

3. **Wenn** Termin unmöglich oder Ort draußen **dann** in derselben Antwort ablehnen. Nicht erst Infos ernten.

4. **Wenn** Fotos fehlen und der Rest reicht **dann** nur die Foto-Bitte. 5 bis 10, große Möbel, extra Keller/Balkon/Schuppen. Ein Warum (Festpreis ohne Hausbesuch).

5. **Wenn** Fotos lückenhaft **dann** 1 bis 3 gezielte Nachzieh-Fotos oder Video-Angebot. Nicht "bitte nochmal alles".

6. **Wenn** Senior/Angehörige oder explizite Unsicherheit **dann** Besuch oder Anruf *als Option* in einem Satz. Nicht als Default für alle.

7. **Wenn** Preis fällig **dann** eine Zahl, Scope, ein Halt-Datum am Termin, eine Annahme-Frage. Kein MwSt-19, keine Vollversicherung, kein Zweitkanal.

8. **Wenn** "zu teuer" **dann** Scope-Alternative (Montage raus, Halteverbot selbst, Kartons selbst) *eine*. Nicht drei. Nicht "wir sind eben Qualität".

9. **Wenn** Close **dann** ein Pfad: Tag blocken gegen "passt" im Chat. Anzahlung nicht default.

10. **Wenn** Absage **dann** Danke, Bedauern, ein neutraler Grund, optionale Tür. Kein Review, keine Belehrung, kein "{placeholder}".

11. **Wenn** `won` **dann** Ops in Happen: zuerst Zeitfenster und was wir brauchen. Kartons/Halteverbot nur wenn noch offen, eigene Bubble.

12. **Wenn** `aftercare` und alles ruhig **dann** eine Frage zum Ablauf. Review-Link erst danach, allein. Nie mit Rechnung *und* Upsell.

13. **Wenn** zwei mögliche Akte nötig scheinen **dann** zwei Bubbles, nicht eine klügere Bubble.

14. **Wenn** der Kunde die letzte Frage einer alten Liste nicht beantwortet hat **dann** nicht die Liste wiederholen. Die eine unbeantwortete Sache neu, kürzer.

15. **Wenn** Erweiterung Küche/Handwerk **dann** dasselbe Stadien-Gerüst. Foto-first bleibt bei Standard. Vor-Ort wird früher Pflicht (Aufmaß). Anzahlung wird früher legitim (Material). "ab" bleibt Anzeige.

---

## Anti-Patterns / Kill-shots

Dinge, die professionell klingen und trotzdem verlieren:

- **Der höfliche Fragebogen.** "Guten Tag, vielen Dank, folgende Infos 1 bis 6." Klingt nach Betrieb, wirkt nach Callcenter.
- **Preis ohne Fotos aus Freundlichkeit.** Zerstört entweder Marge oder Trust, wenn nachkorrigiert wird.
- **"Ab 490" im Chat.** Anker unten, Vergleich gewinnt.
- **Festpreis und Stunden im selben Atemzug.** AMÖ-Kostenfalle, VZ-Ärger.
- **Die Versicherungs-Blase im Angebot.** Verkauft ein Produkt, das so nicht existiert.
- **19 % MwSt bei Kleinunternehmer.** Faktencheck zerlegt den Text.
- **Vier CTAs.** Anrufen, mailen, WhatsApp, "oder schreiben Sie uns einfach".
- **Close + Review.** Der Kunde soll kaufen und uns bewerten, bevor er uns gesehen hat.
- **Absage als Behördenbescheid.** "Leider können wir diesen Auftrag nicht annehmen, weil {grund}."
- **Belehrung Schwarz plus Steuer.** Gewinnt keine legalen Jobs, verärgert die illegalen so, dass sie bewerten.
- **"Wir kommen immer kostenlos vorbei"** als Chat-Default. Unhaltbar, erzeugt No-Show oder gebrochenes Versprechen.
- **"Nur Fotos, Besuch gibt es nicht"** wenn der Kunde Angst hat. Billig-Signal.
- **Dieselbe Bubble nach 24 h nochmal.** Follow-up-Datei; hier nur: Wiederholung der Liste = Tod.
- **KI-Glätte:** keine Bezugnahme auf seinen Satz, keine Stadt, kein "das Sofa auf Bild 3".
- **Studenten-Du plus Briefstruktur.** Register-Bruch.
- **Alles in eine Nachricht packen, weil man "vollständig" sein will.** Vollständigkeit ist der Feind der Antwort.

---

## Offene Lücken

Diese Recherche darf der Skill **nicht** als Gesetz verkaufen:

1. **Keine DE-Umzugs-Conversionquote.** AMÖ veröffentlicht keine Anfrage→Angebot→Auftrag-Trichter. SmartMoving 39 % ist US/CA und Vendor. Nicht als Kottke-Zielzahl übernehmen.
2. **Kein A/B auf Kleinanzeigen-Erstnachricht Liste vs. eine Frage.** Die Empfehlung stützt sich auf Gesprächs-, Formular- und UX-Forschung plus Inferenz. Erste eigene Messung: Anteil Roh-Leads, die innerhalb 24 h Fotos schicken, Liste vs. eine Lücke.
3. **Foto-Genauigkeit vs. Vor-Ort** für *dieses* Team ist ungemessen. US-Vendor-Zahlen (93 % KI-Accuracy etc.) nicht übertragen. Intern: Nachkalkulation Festpreis vs. Ist-Stunden.
4. **Anzahlung vs. No-Show** lokal unbekannt. VZ-Linie spricht gegen Default-Anzahlung. Nicht ohne eigene Ausfallzahlen kippen.
5. **Review-Risiko nach Absage** ist Plausibilität, keine Quote.
6. **HBR 7× / 5-Minuten-Regel** ist US-Web-Lead, oft Telefon-Callback. WhatsApp-Kleinanzeigen können langsamer verzeihen (Kunde schreibt abends). SLA 1 Stunde Werktag bleibt Heuristik, kein Naturgesetz.
7. **"78 % kaufen beim Ersten"** nicht verwenden.
8. **Absatz §451e vs. §451g** und genaue Haftungstexte: Rechtsdatei. Funnel sagt nur: nicht "vollversichert".
9. **Widerruf, WhatsApp als Vertrag, PAngV im Chat:** Rechtsdatei. Funnel nimmt nur: eine klare Zahl, eine klare Annahme.
10. **Segment Student** operativ unklar (Profil aus, Templates an).
11. **Küchenbau-Funnel** hier nur als Regler-Hinweis (Aufmaß, Material-Anzahlung). Eigene Datei.
12. **Portal-Leads (Check24, Immoscout)** können andere Quali-Felder schon mitbringen. Nicht gemessen, welcher Hebel dort schon vorausgefüllt ist.

---

## Quellen

### A

- Deutsche Post Adress (2024): *Umzugsstudie 2024. So zieht Deutschland um.* Repräsentative Befragung n = 1.038 (Interrogare, Ende 2023) plus 3,5 Mio. Umzugsadressen 2023. <https://www.postadress.de/umzugsstudie.pdf>
- Oldroyd, J. B., McElheran, K. & Elkington, D. (2011): The Short Life of Online Sales Leads. *Harvard Business Review*, März 2011. <https://hbr.org/2011/03/the-short-life-of-online-sales-leads>
- Huang, K., Yeomans, M., Brooks, A. W., Minson, J. & Gino, F. (2017): It Doesn't Hurt to Ask: Question-Asking Increases Liking. *Journal of Personality and Social Psychology, 113*(3), 430-452. <https://pubmed.ncbi.nlm.nih.gov/28447835/> PDF: <https://www.hbs.edu/ris/Publication%20Files/Huang%20et%20al%202017_6945bc5e-3b3e-4c0a-addd-254c9e603c60.pdf>
- Sweller, J. (1988): Cognitive Load During Problem Solving: Effects on Learning. *Cognitive Science, 12*(2), 257-285. <https://onlinelibrary.wiley.com/doi/10.1207/s15516709cog1202_4>
- Kahneman, D. & Tversky, A. (1979): Prospect Theory: An Analysis of Decision under Risk. *Econometrica, 47*(2), 263-291.
- Tversky, A. & Kahneman, D. (1974): Judgment under Uncertainty: Heuristics and Biases. *Science, 185*(4157), 1124-1131.
- Grice, H. P. (1975): Logic and Conversation. In Cole & Morgan (eds.), *Syntax and Semantics 3*.
- Austin, J. L. (1962): *How to Do Things with Words.*
- Searle, J. R. (1969): *Speech Acts.*
- BGB §§ 145-147 (Angebot, Erlöschen, Annahmefrist). <https://www.gesetze-im-internet.de/bgb/__145.html>

### B

- Verbraucherzentrale (Stand 11.6.2025): Umzugsunternehmen: So fallen Sie nicht auf Umzugs-Abzocker rein. Festpreis-Empfehlung, Vor-Ort-Kalkulation, Haftung 620 EUR/m³. <https://www.verbraucherzentrale.de/wissen/vertraege-reklamation/kundenrechte/umzugsunternehmen-so-fallen-sie-nicht-auf-umzugsabzocker-rein-10470>
- Verbraucherzentrale Niedersachsen (2021), wiedergegeben u. a. Celler Presse 23.5.2021: keine Anzahlung als Seriositätsmerkmal, kostenfreie Besichtigung, keine zweite Vorauszahlung, Bedenkzeit, kein Widerruf analog Shop. <https://celler-presse.de/2021/05/23/aerger-beim-umzug-vermeiden-verbraucherzentrale-warnt-vor-unserioesen-umzugsunternehmen/>
- AMÖ: Worauf beim Umzug achten (drei Angebote, Kostenfallen, Unseriös-Liste). <https://amoe.de/worauf-beim-umzug-achten/>
- AMÖ / umzug.org: Online-Anfrage ohne Besichtigung als Portal-Flow. <https://umzug.org/>
- handwerk magazin (21.3.2023): Auftragsquote, Schwelle 50 %, Top Bauhandwerk 70 bis 80 %. <https://www.handwerk-magazin.de/auftragsquote-mehr-als-50-prozent-muessen-sein-281363/>
- Deutsche Handwerks Zeitung (Wesolowski / Steinseifer): Aufträge absagen ohne Kunden zu verprellen. <https://www.deutsche-handwerks-zeitung.de/so-sagen-sie-auftraege-ab-ohne-kunden-zu-verprellen-263325/>
- Typeform Help: durchschnittliche Completion ca. 47 %, Philosophie one question at a time. <https://help.typeform.com/hc/en-us/articles/360029615911-What-s-the-average-completion-rate-of-a-typeform>
- Typeform Survey School / Data-on-Data: höchste Completion bei höchstens 6 Fragen; Intro-Satz hilft. <https://www.typeform.com/blog/survey-school-1-forms-and-questions>
- IT-Recht Kanzlei: Ab-Preise, EuGH C-122/10, realistisches Preisniveau. <https://www.it-recht-kanzlei.de/abmahnung-werbung-preise-schlagworte.html>
- RA Plutte: Ab-Preise, OLG Celle 13 U 134/12 (Fahrschule). <https://www.ra-plutte.de/preiswerbung-ueber-20-werbeformen-im-rechts-check/>
- allrecht / sevdesk / gängige BGB-Kommentierung: Angebotsbindung, Frist setzen. <https://www.allrecht.de/alles-was-recht-ist/angebote-richtig-schreiben/>
- Nielsen Norman Group, Budiu (2018): The User Experience of Chatbots. Lineare Flows, ein Task, wenig Fläche. <https://www.nngroup.com/articles/chatbots/>
- Google: unangemessene Rezensionen / Richtlinien. <https://support.google.com/business/answer/4596773?hl=de>
- SWR / Verbraucherzentralen zu Anzahlung Handwerk (höchstens ca. 10 % Rat). <https://www.swr.de/leben/verbraucher/vorkasse-risiken-handwerker-reise-100.html>
- ratgeberrecht.eu (2025): WhatsApp kann Vertragserklärungen tragen, sofern keine Formvorschrift. <https://www.ratgeberrecht.eu/aktuell/geschaeftliche-kommunikation-per-whatsapp/>

### C

- Wiederholte Erstberichte Handwerk/Foren: Kunden beantworten die letzte Chat-Frage; Listen bleiben liegen; Vergleich von 3 Angeboten ist Normalverhalten (deckt sich mit AMÖ-Rat).
- Aktiv Online (2021): Vorkasse oft Unseriös-Zeichen bei Umzug. <https://www.aktiv-online.de/ratgeber/guenstige-und-serioese-umzugsunternehmen-finden-5-praktische-tipps-15946>
- Jobruf u. a. Verbraucherportale: Festpreis statt Stunden, drei Angebote. <https://www.jobruf.de/umziehen/umzugskosten/umzugskosten_rechner.html>
- Fillout / Conversational-Forms-Diskurs: One-at-a-time hilft bei kurzen Flows, schadet ab ca. 12 bis 14 Fragen. <https://www.fillout.com/blog/one-question-at-a-time-form>

### D

- SmartMoving (2026): State of Moving / Sales Benchmarks. Close 39 %, Response 8 Min. Schnitt, 38 % in 5 Min., Time-to-book 2,5 Tage. n = 484 US/CA. <https://www.smartmoving.com/blog/2026-moving-company-sales-benchmarks> <https://www.smartmoving.com/moving-company-sales-system>
- Elromco (2020): Virtual Estimates, Unterzählung 10 bis 15 % ohne Nachhaken, Follow-up-Kadenz. <https://www.elromco.com/blog/how-to-run-virtual-moving-estimates-that-actually-convert>
- HomeSurvey.ai (2026): Vendor-Guide Virtual Surveys, Completion/Accuracy-Claims nicht unabhängig. <https://homesurvey.ai/blogs/blog-virtual-moving-survey-guide/>
- handwerk-wird-gefunden.de (2026): Angebotsquote-Ratgeber, Agentur, keine n. <https://www.handwerk-wird-gefunden.de/praxistipps/angebotsquote-erhoehen-warum-handwerker-zu-viele-anfragen-verlieren>
- HubSpot Landing-Page-Feldstudie (historisch, oft übertrieben zitiert): mehr Felder eher schlechter, nicht linear. <https://blog.hubspot.com/blog/tabid/6307/bid/6746/which-types-of-form-fields-lower-landing-page-conversions.aspx>
- Handwerks-Blogs Anzahlung 20 bis 50 % (meisterwerk, clean-invoice): Materiallogik, nicht Umzug. <https://blog.meisterwerk.app/angebot-rechnungen/anzahlungen-im-handwerk-so-vermeidest-du-teure-fehler>
- Angebots-Ratgeber "14 Tage üblich": <https://angeboterstellen.de/blog/wie-lange-ist-ein-angebot-g%C3%BCltig-fristen-tipps/>

### E

- "78 % kaufen beim ersten, der antwortet" ohne auffindbaren Primärbeleg (oft McKinsey/InsideSales zugeschrieben). Siehe Einordnung: <https://ainora.lt/blog/lead-response-time-statistics-every-study-2026>
- "Kunden lieben vollständige professionelle Erstmails"
- "Immer zuerst die komplette Quali, dann Menschlichkeit"
- "Ohne Anzahlung bucht niemand"
- "Ohne kostenlose Besichtigung wirkt man schwarz" (AMÖ-Rhetorik, nicht Gesetz)

### Ist-Zustand intern (zu prüfen, nicht als Evidenz)

- `~/.claude/skills/kleinanzeigen-umzuege/strategie/reaktion.md`
- `~/.claude/skills/kleinanzeigen-umzuege/templates/segmente.md`
- `~/.claude/skills/kleinanzeigen-umzuege/profiles/kottke-umzuege.json`
