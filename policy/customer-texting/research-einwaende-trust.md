# Einwände, Preisgespräch und Trust im Chat

Stand: 2026-08-15. Recherche für einen späteren Diagnose-Skill, kein `SKILL.md`.

**Vier-Satz-Kern.** Kunden im Umzugs- und Entrümpelungs-Chat wenden selten den Preis als Zahl ein. Sie wenden Risiko, Vergleich und Status ein, und der Preis ist das sichtbare Wort dafür. Die bestehenden Antwort-Templates in `reaktion.md` beantworten das mit Sätzen, die für Kottke faktisch falsch sind: ausgewiesene MwSt, Transportversicherung, Festnetz, Handwerkerbonus 1.200 Euro. Vertrauen auf Kleinanzeigen und WhatsApp entsteht nicht durch glatte Vertrauens-Slides, sondern durch Adresse, Name, Rechnung ohne Märchen und eine Haftung, die 620 Euro pro Kubikmeter heißt und nicht "vollversichert". Wer knickt (Rabatt ohne Leistungsabbau) oder lügt (Familienbetrieb seit 1998, eigene LKW, schwarz geht doch), verliert entweder Marge oder den Auftrag, oft beides.

---

## Wozu diese Datei da ist

Sie liefert Evidenz dafür, **was Kunden wirklich einwenden** und **wie man antwortet, ohne zu lügen oder zu knicken**. Sie ist die Grundlage für Diagnose und If-then eines späteren Skills.

Sie ist **nicht**:

- eine Template-Bibliothek mit 20 fertigen WhatsApp-Antworten
- eine Lizenz, Cialdini als Manipulations-Toolkit zu verkaufen
- Steuerberatung, Versicherungsberatung oder Rechtsrat
- eine Freigabe, die Ist-Templates in `reaktion.md` als Wahrheit zu übernehmen

Annahmen:

- Firma: Kottke Umzüge, inhabergeführt seit 2023, Einzelunternehmen, Kleinunternehmer § 19 UStG, Region Stuttgart, Festpreis nach 5-10 Fotos.
- Haftung: gesetzliche Mindesthaftung § 451e HGB, 620 EUR/m³. Keine Extra-Transportversicherung kommunizieren.
- Fahrzeuge gemietet. Niemals "eigene LKW" oder "eigener Fuhrpark".
- Team: 5 Personen, max. 3 pro Auftrag. WhatsApp 0151-59058963, Mail kontakt@kottke-umzuege.de. Kein Festnetz.
- Sprache der Datei: Deutsch. Quellen oft DE, Psychologie oft EN. Übertragungen sind als Inferenz markiert.

---

## Kernsatz

**Ein Einwand ist ein Informationswunsch mit Angst-Lack.** Wer ihn als Feilschen behandelt, gibt nach. Wer ihn als Lüge-Gelegenheit behandelt, fällt auf. Wer ihn als Diagnose behandelt (Preis / Angst / Status / Vergleich), kann wahr antworten und trotzdem den Auftrag halten.

---

## Wie Evidenz hier gelesen wird

| Stufe | Bedeutung |
|---|---|
| **A** | Gesetzestext, BGH, BMF/Finanzverwaltung, große repräsentative DE/DACH-Umfrage mit n + Methode |
| **B** | Verbandsstudie, klare Behördenlinie (Zoll, Verbraucherzentrale, Finanzamt-FAQ), eine starke Studie, belastbarer Journalismus mit Methode |
| **C** | Wiederholte Erstberichte (Reddit r/wohnen, Foren, Trustpilot-Verbatims, Branchenpraxis). Textur, keine Quote |
| **D** | Einzelner Coach, Sales-Blog, US-Studie ohne DACH-Übertrag, Anekdote |
| **E** | Folklore ("Mobilnummer ist immer Schwarzarbeit", "Kunden lieben KI-Texte", "wir sind die Günstigsten schließt") |

Jede belastbare Aussage hat Stufe + Quelle + Jahr. Inferenzen heißen Inferenz.

---

## 0. Ist-Zustand `reaktion.md`: was hält, was fällt

Geprüft gegen Firmenprofil `kottke-umzuege.json` (Stand 2026-05-22) und gegen Recht. Das ist keine Stil-Kritik. Das sind Falschaussagen, die im Chat später als Betrug gelesen werden.

| Stelle in `reaktion.md` | Behauptung | Fakt | Urteil |
|---|---|---|---|
| Erst-Antwort, Zeile 27 | "erreichen Sie uns unter {festnetz}" | `festnetz: null` | **Lüge durch Platzhalter.** Mobil + Mail nennen, Festnetz nicht erfinden. |
| Angebot, Zeile 92 | "Transportversicherung bis {versicherung} EUR" | `versicherung_typ: gesetzliche_mindesthaftung`, `transportversicherung_zusatz: false` | **Falsch.** Haftung, nicht Versicherung. |
| Angebot, Zeile 94 | "Festpreis: {preis} EUR brutto (inkl. 19 Prozent MwSt)" | Kleinunternehmer § 19, kein USt-Ausweis | **Rechtswidrig und falsch.** Unberechtigter Steuerausweis nach § 14c UStG. |
| "Was ist wenn was kaputtgeht", Zeile 111 | "Unsere Transportversicherung deckt … Selbstbehalt 250 EUR" | Keine Zusatzpolice kommuniziert | **Erfunden.** Selbstbehalt 250 ist typisch für *Zusatz*-Transportversicherung, die hier nicht existiert. |
| "Können Sie das schwarz machen", Zeile 117 | "ausschließlich mit Rechnung und MwSt" | Rechnung ja, MwSt nein | **Halbwahrheit.** Rechnung ohne USt ist legal und für § 35a ausreichend. |
| dieselbe Stelle | "Privatumzüge über 530 EUR … Handwerkerleistung … bis 1.200 EUR" | Privater Umzug = haushaltsnahe Dienstleistung § 35a Abs. 2, max. 4.000 EUR Steuerermäßigung. 530 EUR ist die alte Minijob-Grenze, nicht § 35a. | **Falsche Norm, falsche Schwelle, falscher Deckel.** |
| dieselbe Stelle | "macht den legalen Weg oft günstiger als der Schwarzpreis" | 20 % der Arbeitskosten, nur bei Steuerzahler, nur Überweisung, nicht bei Entrümpelung/Haushaltsauflösung | **Verkaufstrick.** Darf als Hinweis stehen, nicht als Garantie. |
| SLA, Zeile 7 | Antwort 1 Stunde werktags | Operational, kein Rechtsversprechen | **Haltbar**, wenn in der Anzeige nicht als Garantie steht. |

Weitere Ist-Fehler außerhalb von `reaktion.md`, die im Chat nachhallen:

- Skill-Beschreibung und `beschreibung-skelett.md` verkaufen "Familienbetrieb" und "Rechnung mit ausgewiesener MwSt". Profil: `familienbetrieb: false`, Gründung 2023.
- AI-Prompt "VERSICHERT / Bis 50.000 EUR / Transportversicherung inklusive" ist für dieses Profil eine Täuschung.
- "Eigene Fotos vom LKW" sind im Profil `false`. Ein gemieteter Sprinter ohne Logo ist kein "eigener Fuhrpark".

**Inferenz (C/D):** Kunden merken den Widerspruch nicht am ersten Satz. Sie merken ihn, wenn die Rechnung ohne MwSt kommt, wenn ein Schaden nicht "vollversichert" ist, oder wenn Google "seit 2023" zeigt. Dann ist der Chat verloren und oft die Bewertung auch.

---

## 1. Top-Einwände Umzug DE

Es gibt keine repräsentative DE-Umfrage "Top-10-Einwände Umzug im WhatsApp-Chat". Die Rangliste ist **C**, gebaut aus Reddit r/wohnen (2023-2025), Verbraucherzentrale-Warnungen und den Ist-Templates. Die Rechts- und Psychologielage dahinter ist oft A/B.

Pro Einwand: Signal im Kundentext → was darunter liegt → erlaubte Strategie → verboten. Maximal ein Mikro-Beispiel.

### 1.1 "Zu teuer" / "können Sie noch günstiger?"

**Signal:** "Geht da noch was?", "das sprengt mein Budget", "andere wollen 400 weniger", einzelne Zahl ohne Kontext.

**Darunter:** meist Vergleich (anderer Anker) oder Angst (Geld weg, Leistung unklar), selten reiner Status. Loss Aversion: 100 Euro Nachlass fühlt sich größer an als 100 Euro mehr Leistung. **A**, Kahneman & Tversky, Prospect Theory, 1979.

**Erlaubt:** Leistung rausnehmen, nicht den Festpreis weichspülen. Montage, Halteverbot, Kartonleihe, Packservice als sichtbare Hebel. Festpreis bleibt Festpreis für den *genannten* Umfang. Spanne erklären (Etage, Aufzug, Volumen), nicht den ersten Preis als "Verhandlungsanfang" behandeln.

**Verboten:** "für Sie mache ich 80 Euro weniger" ohne Gegenleistung. Das trainiert Feilschen und macht den nächsten Kunden zum Feilscher, wenn der Chat weitergegeben wird.

Mikro: "Der Preis gilt für Tragen, Transport, Demontage/Montage und Halteverbot. Wenn Sie Montage und Halteverbot selbst machen, liegt das Angebot bei X Euro."

### 1.2 Schwarz / ohne Rechnung / "bar günstiger"

**Signal:** "ohne Rechnung?", "bar?", "was kostet schwarz?", "netto ohne Steuer", "machbar ohne Beleg?"

**Darunter:** Preis (MwSt-Mythos) plus Status ("ich bin kein Dummer, der Steuer zahlt") plus Angst vor Nachverfolgung. Bei Kleinunternehmer entfällt der MwSt-Hebel: es gibt keine 19 %, die man "schenken" könnte.

**Erlaubt:** Klare Absage in einem Satz. Dann sachlich: Rechnung ohne Umsatzsteuer (§ 19), Überweisung, bei *privatem* Umzug möglicher Abzug nach § 35a Abs. 2 (20 % der Arbeitskosten, max. 4.000 Euro Steuerermäßigung), nicht als Handwerker 1.200. Kein Versprechen, dass das Finanzamt zahlt.

**Verboten:** Zwinkern, "offiziell so, bar so", "Rechnung über weniger". Vertrag ist dann nach BGH insgesamt nichtig. **A**, BGH 01.08.2013, VII ZR 6/13; BGH 10.04.2014, VII ZR 241/13; Zoll-Hinweis für Privatpersonen.

Mikro: "Nein, nur mit Rechnung. Wir sind Kleinunternehmer, auf der Rechnung steht keine MwSt. Privatumzug können Sie oft als haushaltsnahe Dienstleistung ansetzen, wenn Sie überweisen. Bar ohne Rechnung machen wir nicht."

### 1.3 "Nachbar / Kleinanzeigen-Typ macht's billiger"

**Signal:** "mein Schwager macht das für 300", "einer von Kleinanzeigen will 450", "warum seid ihr teurer?"

**Darunter:** Vergleich plus Status. VOC: 300-550 Euro für Stadtumzüge tauchen auf Reddit regelmäßig auf, oft mit "Firma" in Anführungszeichen, Pleite Wochen später, Sandalen auf der Autobahn, keine Rechnung. **C**, r/wohnen, 2025.

**Erlaubt:** Leistungsumfang neben Preis legen. Haftung, Rechnung, wie viele Personen, was passiert wenn etwas bricht, wer das Halteverbot beantragt. Den anderen nicht beleidigen.

**Verboten:** "Das ist Schwarzarbeit" (wissen Sie nicht). "Die machen das nicht richtig." "Wir sind professioneller." Das ist Status-Kampf und UWG-nah.

Mikro: "450 Euro kann ein Preis für reines Tragen ohne Montage und ohne Rechnung sein. Bei uns sind im Festpreis X Personen, Montage und die gesetzliche Haftung. Wenn der andere das auch schriftlich gibt, können Sie fair vergleichen."

### 1.4 Versicherung / "was wenn was kaputtgeht?"

**Signal:** "seid ihr versichert?", "vollversichert?", "was ist bei Schaden?", "haftet ihr für alles?"

**Darunter:** Angst, nicht Preis. Beweislast liegt beim Kunden. **B**, Verbraucherzentrale, 11.06.2025.

**Erlaubt:** Das Wort Haftung benutzen. 620 EUR/m³, Zeitwert nicht Neuwert, Fristen (erkennbar: Tag danach; verdeckt: 14 Tage), Ausschlüsse (selbst verpackt). Angebot einer *höheren* Haftung oder Kunden-Hausrat erwähnen, ohne eine Police zu erfinden, die es nicht gibt. Aufklärung ist Voraussetzung, damit die 620-Euro-Grenze überhaupt gilt. **A**, § 451e, § 451f, § 451g HGB.

**Verboten:** "vollversichert", "Transportversicherung inklusive bis 50.000", "wir ersetzen alles neu". Das ist die häufigste Branchenlüge. **C**, Anbieterseiten, die "vollversichert nach Umzugsstandard" schreiben und damit die gesetzliche Haftung meinen.

Mikro: "Wir haften nach § 451e HGB mit 620 Euro pro Kubikmeter Laderaum, Zeitwert. Offensichtliche Schäden bitte am nächsten Tag schriftlich, verdeckte binnen 14 Tagen. Eine Extra-Transportversicherung haben wir nicht dabei. Wenn Sie Neuwert wollen, sagen Sie Bescheid, dann klären wir eine Wertdeklaration oder Ihre Hausrat."

### 1.5 Halteverbot

**Signal:** "brauchen wir das wirklich?", "das ist doch Abzocke", "wir stellen Warnwesten hin"

**Darunter:** Preis (Gebühr) plus Unwissen. In Stuttgart ist die Zone bei der Stadt zu beantragen, Schilder in der Regel 72 Stunden vorher, Bearbeitungszeit oft zwei Wochen. **B**, Stadt Stuttgart / service-bw.

**Erlaubt:** Empfehlung an die Straße koppeln, nicht als Pflicht verkaufen. Verzicht = längerer Trageweg, Preis gilt dann für den längeren Weg oder wird vorher angepasst. Warnwesten und Pylonen sind keine Halteverbotszone.

**Verboten:** "Ohne Halteverbot kommen wir nicht" (stimmt nicht immer). "Kostet uns intern 60, für Sie 60" ohne zu sagen, was Stadtgebühr und was Service ist.

Mikro: "Pflicht ist es nicht. In Ihrer Straße ohne freie Lücke sparen die Schilder oft eine Stunde Tragen. Die Stadtgebühr liegt meist bei ein paar Dutzend Euro, der Rest ist Beantragen und Aufstellen. Wenn Sie selbst beantragen, ziehen wir den Posten."

### 1.6 "Müssen wir selbst tragen / packen / Kartons?"

**Signal:** "könnt ihr auch nur den LKW?", "Kartons habt ihr?", "wir packen selbst"

**Darunter:** Preis-Steuerung. Kunden unterschätzen Kartonzahl systematisch (15-20 Kartons für 80 m² gelten in Foren als "viel zu wenig"). **C**, r/wohnen. Selbst verpackt = Haftungsausschluss für dieses Gut. **A**, § 451d HGB.

**Erlaubt:** Drei klare Pakete: nur Transport / Transport + Tragen / voll (Packen, Montage, Kartons). Hinweis: eigene Kartons und Selbstpacken senken den Preis und die Haftung für Bruch in diesen Kartons.

**Verboten:** "Wenn Sie selbst packen, haften wir trotzdem für alles."

Mikro: "Selbst packen geht. Dann haften wir nicht für Bruch in Ihren Kartons. Wir können 20 Leihkartons dazu legen, das ist der Posten Y Euro."

### 1.7 Kurzfristig / "geht morgen?"

**Signal:** "morgen frei?", "übermorgen muss die Wohnung leer sein", "Räumung Freitag"

**Darunter:** echte Frist (Mietende, Nachlass, Gerichtsvollzieher) oder Test, ob man "ja" sagt und dann pfuscht.

**Erlaubt:** Kalender wahr sagen. Wenn ja: Fotos *jetzt*, Festpreis *heute*, kein Rabatt für Panik. Wenn nein: höflich ablehnen, optional späteren Slot. VZ: kein gesetzliches Widerrufsrecht bei termingebundener Umzugsleistung, deshalb nicht drängen. **B**, VZ Niedersachsen / Preuschoff, wiedergegeben 2021.

**Verboten:** Zusagen ohne Slot. "Wir schieben einen anderen Kunden" als Drama. Erfundene Knappheit ("letzte Lücke heute").

Mikro: "Morgen sind wir in Tübingen. Freitag vormittag ginge. Dafür brauche ich heute die Fotos, sonst kann ich den Festpreis nicht halten."

### 1.8 Anzahlung unsicher

**Signal:** "warum Anzahlung?", "überweise ich erst nach dem Umzug?", "zweite Abschlag?"

**Darunter:** Angst vor Abzocke. Fall VZ Niedersachsen: 375 Euro Anzahlung, dann zweite Forderung, Termin verschoben, niemand kam. Expertin: seriöse Umzugsunternehmen verlangen in der Regel **keine** Anzahlung, und bestimmt keine zweite. **B**, VZ Niedersachsen, Tiana Preuschoff (2021, über Zweitquelle).

**Erlaubt:** Wenn die Firma keine Anzahlung nimmt: das laut sagen, das ist Trust. Wenn sie eine nimmt: Zweck (Material, Halteverbot-Gebühr), Höhe klein, Rest nach Leistung, kein zweiter Abschlag vor Eintreffen. Schriftliche Bestätigung.

**Verboten:** "Ohne Vorkasse kommen wir nicht" als Druck. Zweite Vorauszahlung. Bargeld "an die Jungs auf die Hand" vor Entladen.

Mikro: "Wir rechnen nach dem Umzug per Rechnung, Überweisung. Eine Anzahlung brauchen wir nicht."

### 1.9 "Kommt ihr pünktlich?"

**Signal:** "wann genau?", "letzte Firma kam drei Stunden zu spät", "steht ihr um 8 da?"

**Darunter:** Angst, oft aus Vorerfahrung. Reddit: zwei Mann statt sechs, eine Stunde Verspätung, dann Nachverhandeln. **C**.

**Erlaubt:** Fenster nennen (z. B. 8-10), am Vortag die engere Zeit. Verspätung selbst schreiben, nicht den Kunden anrufen lassen. Kein "wir sind immer pünktlich" als Absolutum.

**Verboten:** Exakte Uhr als Garantie, wenn der Vortour-Umzug unbekannt ist. "Verkehr, nicht unsere Schuld" als erste Antwort.

Mikro: "Fenster 8 bis 10 Uhr. Gestern Abend schreiben wir die engere Zeit. Wenn wir später sind, schreiben wir, bevor das Fenster endet."

### 1.10 Fotos / "sagen Sie erst den Preis"

Eigener Abschnitt 6. Kurz: oft Angst vor Anker und vor Wohnungsbildern an Fremde, nicht Faulheit.

### 1.11 "Ich habe schon 3 Angebote"

Eigener Abschnitt 7.

---

## 2. Trust-Defizit Kleinanzeigen und WhatsApp

Kunden auf Kleinanzeigen behandeln Anbieter zuerst als Risiko. Die Verbraucherzentrale sagt das für Umzug explizit: Vergleichsangebote, schriftliche Leistung, Festpreis, Haftung nur 620 EUR/m³, Meldefristen. **B**, VZ, 11.06.2025.

### 2.1 Was als Schwarzarbeit-Signal gelesen wird

| Signal | Was Kunden daraus machen | Evidenz | Was Kottke tun kann, ohne zu lügen |
|---|---|---|---|
| Nur Mobilnummer, kein Festnetz | "Die gibt's morgen nicht mehr" | **C/D.** Checklisten (u. a. Regionalpresse BW 2026) nennen fehlendes Festnetz als Seriositäts-Hinweis. Eine **Verbraucherzentrale-Primärquelle** dafür habe ich in dieser Recherche **nicht** gefunden. Das Profil behauptet sie. Stufe hier: Folklore mit Wiederholung, nicht A. | Nicht erfinden. Adresse Wildberg, Mail, Name, Impressum. Optional später Sipgate. |
| Fehlendes Impressum | Gewerbe unklar | **A/B**, DDG § 5, Kleinanzeigen-Pflichtangaben gewerblich | Block am Chat-Anfang oder in der Anzeige: Name, Anschrift, Mail, Telefon. |
| Stockfotos, AI-Team, zu glatte Texte | Fake-Firma | **C** plus **B** Bynder 2024 (50 % erkennen KI-Text). YouGov 2025: 54 % der Deutschen misstrauen KI-Nachrichten. | Echte Handy-Fotos, ein Gesicht, unperfekter Satz. |
| "Rechnung mit MwSt" und dann Kleinunternehmer-Rechnung | Betrug | **A**, § 19 UStG, § 14c UStG | Von Anfang an: "Rechnung ohne MwSt, Kleinunternehmer". |
| WhatsApp als einziger Kanal | Privatperson, nicht Firma | **C.** WhatsApp selbst ist in DE der Normal-Kanal, nicht das Problem. Das Problem ist WhatsApp *ohne* Impressum. | WhatsApp + Mail + Anschrift. |
| Anzahlung / zweite Abschlag | Abzocke | **B**, VZ NI | Keine Anzahlung oder winzige, begründete. |
| Bewertungen nur 5,0 bei 3 Stück / keine URL | Gekauft | **C** | Zahl nicht aufblasen. Link nur wenn er existiert. Profil: `google_bewertungen_anzahl: null`. |

**Inferenz:** Das Trust-Defizit heilt man nicht mit dem Wort "seriös". Man heilt es mit überprüfbaren Daten, die wahr sind.

### 2.2 KI-Ton und zu glatte Texte

Erkennungsmerkmale, die Kunden (und Lehrer) als seelenlos lesen: Dreier-Aufzählungen, "ganzheitlich", langer Gedankenstrich, gleichmäßige Höflichkeit ohne Kanten. **C**, BR 2026 zu KI-Stil; MIT 2025 (klein, Studierende).

Skill-Folge: Ein Satz weniger Höflichkeitsformel, eine konkrete Zahl, ein lokaler Bezug (Etage, Straße, Termin). Nicht "Wir legen größten Wert auf Zuverlässigkeit".

### 2.3 Face, Name, Person

Cialdini: Liking und Authority wirken, wenn sie wahr sind. **A**, Cialdini, Influence (1984/2021). Goldstein, Cialdini & Griskevicius 2008: *spezifische* ähnliche Andere schlagen generische Appelle. **A**.

Für den Chat: "Dario" plus ein echtes Einsatzfoto schlägt "Ihr Kottke-Team" plus Shield-Icon. Unbelegt als Conversion-Prozent. Belegt als Richtung.

Verboten: AI-Gesichter, "Familienbetrieb in 3. Generation", Stock-LKW mit fremdem Kennzeichen als "unser Fuhrpark".

---

## 3. Preisverteidigung

### 3.1 Festpreis vs. Stunde

Verbraucherzentrale empfiehlt in den meisten Fällen Festpreis, Leistung vorher exakt, Mehraufwand trägt der Unternehmer. Stundenabrechnung: 15-20 % über Kostenvoranschlag noch "akzeptabel", darüber Hinweispflicht. **B**, VZ 2025.

VOC: Festpreis ist das, was Kunden nach Stunden-Horror wollen. Gleichzeitig misstrauen sie einem Festpreis *ohne* Fotos/Besichtigung, weil Nachverhandeln am Umzugstag ein bekanntes Muster ist. **C**, r/wohnen, "nach der Hälfte nachverhandelt".

**Für Kottke:** Das Modell "Spanne in der Anzeige, Festpreis nach Fotos" ist genau die Antwort auf beide Ängste. Es darf nicht zu "Festpreis, aber dann sehen wir mal" werden.

### 3.2 Leistung rausnehmen statt Rabatt

Das ist kein Trick, das ist Angebotsarchitektur. Der Kunde steuert den Preis über Umfang. Der Festpreis bleibt intern kalkuliert.

Ehrliche Hebel bei Kottke (Profil-Preistreiber):

- Montage/Demontage weglassen
- Halteverbot selbst beantragen
- Kartons selbst, keine Leihe
- Packservice streichen
- nur große Möbel, Kleinkram selbst
- zweiter Helfer weniger, wenn EG + Aufzug

Unterscheiden: *Preis senken durch weniger Leistung* (erlaubt) vs. *dieselbe Leistung billiger, weil der Kunde nervt* (verboten, trainiert Einwand).

### 3.3 Anker

Erster genannter Preis zieht das Ergebnis. **A**, Tversky & Kahneman 1974; Galinsky & Mussweiler 2001 (r ≈ 0,85 zwischen Erstgebot und Abschluss in Laborsituation). Extreme Erstgebote erhöhen aber Impasse-Risiko. **A**, Schweinsberg et al. 2012.

**Ehrliche Nutzung:** Nach Fotos *einen* Festpreis nennen, nicht "zwischen 400 und 1.400, je nachdem". Die Anzeigen-Spanne darf vorher stehen. Wer zuerst "was haben Sie denn budgetiert?" fragt, lässt den Kunden einen niedrigen Anker setzen.

**Unehrliche Nutzung:** Künstlich hoher Preis, damit 10 % Nachlass sich gut anfühlt. Das ist der durchgestrichene 299-auf-149-Move. Hier nicht.

### 3.4 Decoy (Köder-Option)

Huber, Payne & Puto 1982: eine asymmetisch dominierte dritte Option verschiebt Wahlanteile. **A**. Replikationsdebatte existiert, der Effekt ist nicht alltagssicher. **B/D**.

**Ehrliche Variante:** Drei Pakete, von denen das mittlere das ist, das ihr wirklich fahren wollt (Transport+Tragen+Montage). Das teure ist Vollservice. Das günstige ist "nur LKW und 2 Mann, selbst packen". Alle drei müssen kalkuliert wahr sein. Kein Schein-Paket, das niemand liefern kann.

**Unehrlich:** Ein absichtlich unsinniges "Premium 2.400" nur damit 1.190 "günstig" wirkt.

### 3.5 Cialdini, nur wo ehrlich

| Prinzip | Ehrlicher Einsatz | Manipulativ (verboten) |
|---|---|---|
| Reciprocity | Kostenlose, knappe Einschätzung nach Fotos | "Ich habe Ihnen jetzt so viel Zeit geschenkt, sagen Sie ja" |
| Social Proof | Echte Google-Zahl, echte Nachbar-Straße ohne Namen zu leaken | "alle buchen uns diese Woche", erfundene 5,0 bei 0 Reviews |
| Authority | Gesetz, Haftung, Impressum, Inhabername | "AMÖ-Mitglied" wenn nicht, "Meisterbetrieb" wenn nicht |
| Commitment | "Soll ich den Freitag so festhalten?" nach klarem Angebot | Mini-Ja-Treppe ("Sie wollen stressfrei? Sie wollen pünktlich?") |
| Scarcity | "Freitag ist der letzte freie Slot im Juni" wenn Kalender das sagt | "Nur heute 10 % " |
| Liking | Mensch schreiben, Du nur bei Studenten | Kumpel-Theater, Spitznamen |
| Unity | "wir sind selbst aus Wildberg / Region" wenn wahr | "Familienbetrieb seit 1998" |

Cialdini selbst rahmt die Prinzipien als *ethical*. Das ist die einzige erlaubte Lesart hier. **A**, Influence at Work / Cialdini.

---

## 4. Schwarzarbeit und § 35a EStG

### 4.1 Was Schwarzarbeit rechtlich ist

§ 1 Abs. 2 SchwarzArbG: u. a. steuerliche Pflichten nicht erfüllen, Sozialversicherung umgehen, Gewerbe nicht anzeigen. "Ohne Rechnung, damit es günstiger ist" ist die klassische Ohne-Rechnung-Abrede.

Folgen, die man im Chat **wahr** sagen darf:

- Vertrag nichtig, § 134 BGB i. V. m. SchwarzArbG. **A**, BGH VII ZR 6/13 (2013).
- Keine Gewährleistung für den Kunden. **A**, dasselbe Urteil.
- Unternehmer bekommt auch keinen Werklohn / Wertersatz. Auch Teil-Schwarz macht den ganzen Vertrag nichtig. **A**, BGH VII ZR 241/13 (2014); BGH VII ZR 197/16 (2017, nachträgliche Abrede).
- Auftraggeber-Bußgeld bis 50.000 Euro möglich. **A/B**, Zoll, Privatperson als Auftraggeber; § 8 SchwarzArbG.
- Rechnung 2 Jahre aufbewahren bei bestimmten Grundstücksleistungen. **B**, Zoll.

Das ist Absage-Material, kein Moral-Sermon.

### 4.2 § 35a: was trägt, was nicht

Gesetz: § 35a EStG. Voraussetzung Abs. 5 S. 3: **Rechnung** und **Zahlung auf das Konto** des Leistenden. Bar tötet den Abzug, auch mit Quittung. **A**, Gesetz; LStN-FAQ.

| Leistung | Norm | Deckel Steuerermäßigung | Für Kottke |
|---|---|---|---|
| Privater Umzug (Tragen, Fahren, Maschinen/LKW-Kosten, Verbrauchskartons) | § 35a Abs. 2, haushaltsnahe Dienstleistung | 20 % der Aufwendungen, max. **4.000 EUR**/Jahr | **Ja, erwähnbar.** OFD Koblenz 08.05.2006; LStN; FA Baden-Württemberg ("Dienstleistungen für privat veranlasste Umzüge") |
| Möbelmontage/-demontage "vor Ort" | oft Abs. 3, Handwerker | 20 %, max. **1.200 EUR** | Ja, aber andere Zeile. Nur erwähnen, wenn Montage getrennt ausgewiesen wird |
| Beruflicher Umzug | Werbungskosten, nicht 35a | entfällt | Nicht als 35a verkaufen |
| Entrümpelung / Haushaltsauflösung | explizit **nicht** haushaltsnah | entfällt | **Nicht erwähnen.** FA BW-Liste: "Entrümpelung einer Wohnung im Zuge einer Haushaltsauflösung" = nicht begünstigt. Finanztip 2026 ebenso |
| Material | nicht begünstigt | entfällt | Karton-*verkauf* nicht in den 35a-Satz mischen |

Schwelle "über 530 EUR" in `reaktion.md`: **existiert in § 35a nicht.** Verwechslung mit historischer Minijob-Grenze.

### 4.3 Trägt § 35a beim Kleinunternehmer ohne MwSt-Ausweis?

**Ja, dem Grunde nach.** Das Gesetz verlangt eine Rechnung, nicht eine Rechnung *mit Umsatzsteuer*. Kleinunternehmer dürfen keine USt ausweisen (§ 19 UStG, seit 2025 Hinweis nach § 34a UStDV). Die Rechnung bleibt eine Rechnung. Unbare Zahlung bleibt unbare Zahlung. **A/B**, § 35a Abs. 5 S. 3 EStG; IHK/USt-Regeln Kleinunternehmer.

Was man **nicht** sagen darf:

- "inkl. MwSt, deshalb absetzbar"
- "Handwerkerbonus 1.200 auf den ganzen Umzug"
- "dadurch ist legal billiger als schwarz" als Fakt
- "Sie bekommen 20 % vom Finanzamt zurück" (nur wenn überhaupt Steuerschuld da ist; kein Vortrag ins Folgejahr)

Ehrliche Formulierung: Hinweis, keine Steuerberatung, Arbeitskosten auf der Rechnung getrennt ausweisen (hilft dem Kunden beim Finanzamt).

**Rechenbild, nur zur internen Klarheit, nicht als Chat-Versprechen:** 890 EUR privater Umzug, alles Arbeit/Maschine, Überweisung, Steuerzahler → 178 EUR weniger Steuerschuld. Der Schwarzpreis müsste *unter* 712 liegen, um "günstiger nach Steuer" zu sein, und der Kunde hätte dann keinen Vertrag. Das ist Illustration, keine Garantie.

### 4.4 Offene Steuer-Lücke der Firma selbst

Profil: 20 Umzüge in Q2 2026. Hochgerechnet ~80/Jahr. Bei mittleren 700 EUR schon ~56.000 EUR Umsatz. Kleinunternehmer-Grenze seit 2025: Vorjahr 25.000, lfd. Jahr 100.000. **A**, IHK Rhein-Neckar / BMF 2025.

**Inferenz:** Wenn § 19 faktisch nicht mehr gilt, dürfen Chat und Rechnung keine Kleinunternehmer-Sätze mehr verwenden. Das muss der Skill aus dem Profil lesen, nicht hart kodieren.

---

## 5. Versicherungs-Sprache

### 5.1 Die Wörter, die lügen

| Formulierung | Warum sie falsch oder gefährlich ist |
|---|---|
| "vollversichert" | Gesetzliche Haftung ist begrenzt, verschuldensabhängig in den Ausschlüssen, Zeitwert. "Voll" suggeriert Neuwert + alle Gefahren. |
| "Transportversicherung inklusive" | Das ist eine *Kundenpolice* oder eine Verkehrshaftung. Beides ist nicht dasselbe. Kottke hat keine Zusatz-Transportversicherung im Profil. |
| "versichert bis 50.000 EUR" | Zahl ohne Bezug (pro Auftrag? Neuwert? Selbstbehalt?) ist typische Anzeigen-Luft. |
| "unsere Versicherung übernimmt das" | Bei gesetzlicher Haftung zahlt zuerst der Unternehmer, seine Verkehrshaftung folgt der *gesetzlichen* Haftung, nicht einem Wunschbetrag. |
| "bis 620 EUR/m³ voll abgesichert" | 620 ist die *Obergrenze*, nicht eine zugesicherte Summe pro kaputtem Schrank. 10 m³ × 620 = 6.200 EUR Maximum für *das gesamte* Gut dieses Volumens. |

Verbraucherzentrale, wörtlich sinngemäß: nicht alle Schäden sind versichert; Haftung in der Regel nur für vom Unternehmen verursachte Schäden, höchstens 620 EUR/m³ (§ 451e HGB); Versicherungen ersetzen Zeit- nicht Wiederbeschaffungswert; Beweislast beim Kunden. **B**, VZ 11.06.2025.

### 5.2 Was wahr und trotzdem beruhigend ist

Beruhigen heißt nicht aufblasen. Beruhigen heißt konkret:

1. Wir haften für Verlust und Beschädigung in unserer Obhut.
2. Grenze 620 EUR je m³ benötigtem Laderaum.
3. Zeitwert, nicht Kaufpreis neu.
4. Selbst gepackte Kartons: in der Regel kein Anspruch (§ 451d).
5. Sie müssen offensichtliche Schäden am nächsten Tag schriftlich melden, verdeckte in 14 Tagen.
6. Wir klären Sie darüber auf (sonst gilt die Grenze gegenüber Verbrauchern nicht, § 451g). Das ist in Ihrem Interesse *und* in unserem.
7. Extra-Deckung gibt es bei uns nicht als Inklusiv-Märchen. Hausrat des Kunden oder Wertdeklaration gegen Zuschlag sind die ehrlichen Wege.

Beispielrechnung intern: Sprinter 17 m³ → Obergrenze 10.540 EUR für *alles*. Ein Designersofa plus Geschirr-Kartons können das reißen. Deshalb ist "620 klingt klein" eine faire Kundenangst. Antwort: Volumen nennen, nicht die Zahl verstecken.

### 5.3 Betrieb vs. Gut

Treppenhaus, Türzarge, Nachbarauto: nicht Umzugsgut, sondern Betriebshaftpflicht. Im Chat nicht "versichert" ohne zu sagen, *was*. Ob Kottke eine Betriebshaftpflicht hat, steht nicht im Profil. **Nicht behaupten, bis es im Profil steht.**

Verkehrshaftung ab 3,5 t Pflicht (§ 7a GüKG). Kottke-Sprinter sind typischerweise unter 3,5 t. **Nicht** "gesetzlich voll versichert, weil Spedition" sagen.

---

## 6. Foto-Verweigerung: "sagen Sie erst den Preis"

### 6.1 Diagnose

| Lesart | Typischer Text | Was darunter liegt |
|---|---|---|
| Anker-Angst | "Erst Preis, dann Fotos" | Kunde will nicht sein Volumen zeigen, bevor ein niedriger Anker steht |
| Vergleichseinkauf | "ich sammle erst Zahlen" | 2-3 Angebote, VZ empfiehlt das |
| Privacy / Scham | Ausweichen, keine Wohnungsbilder | Entrümpelung, Unordnung, Kinder, Vermögen sichtbar |
| Scam-Filter | "warum braucht ihr Fotos von meiner Wohnung?" | Kleinanzeigen-Misstrauen |
| Aufwand | "habe jetzt keine Zeit zum Fotografieren" | echter Aufwand oder Desinteresse |
| Macht | "Sie sind der Profi, schätzen Sie" | Status, will den anderen arbeiten lassen |

Es gibt keine A-Studie "Foto-Verweigerung Umzug DE". Die Tabelle ist **Inferenz aus VOC + Ankerforschung**.

### 6.2 Nächster Zug

**Erlaubt:**

- Orientierungsspanne *mit Bedingung* ("2 Zimmer, EG, Aufzug, ohne Montage: bei uns oft 490-790, verbindlich nach Fotos").
- Warum: Festpreis ohne Volumen ist raten, und Raten endet am Umzugstag mit Nachforderung. Genau das, wovor die VZ warnt.
- Alternative: 3-Minuten-Video durch die Räume, oder 6 Pflichtmotive (Wohnzimmer, Schlafzimmer, Küche, Flur/Treppe, Keller, sperrigstes Stück).
- Bei Scham (Entrümpelung): "unsichtbare" Fotos, nur Volumen, keine Gesichter, Chat bleibt beim Inhaber.

**Verboten:**

- Exakten Festpreis ohne Sicht.
- Künstlich niedrigen Lockpreis, "sehen wir vor Ort".
- "Ohne Fotos machen wir das nicht" als Abbruch ohne Spanne (fühlt sich nach Falle an).
- Druck: "ohne Fotos können wir Ihnen nicht helfen" in Moralton.

Mikro: "Einen verbindlichen Festpreis ohne Fotos wäre geraten, und genau daraus werden Nachforderungen. Für 2 Zimmer ohne Keller liegen wir meist zwischen A und B. 5 Fotos, dann eine Zahl, die gilt."

Wenn nach der Spanne immer noch keine Fotos kommen: ein Nachfass, dann stehen lassen. Das ist oft Preisvergleich, kein Close.

---

## 7. Vergleich mit drei anderen Angeboten

VZ rät zu mehreren Angeboten. Der Kunde, der das sagt, folgt der offiziellen Empfehlung. **B**. Ihn dafür zu bestrafen ("dann nehmen Sie die anderen") ist Status-Verlust.

**UWG:** Vergleichende Werbung, die Mitbewerber erkennbar macht, nur unter § 6 UWG (objektiv, nachprüfbar, nicht herabsetzend, nicht irreführend). Im 1:1-Chat ist "die Firma XY ist Pfusch" unnötig und riskant. **A**, § 6, § 4, § 5 UWG.

**Erlaubte Strategie:**

1. Kurz anerkennen: Vergleich ist vernünftig.
2. Eine Checkliste, *was* verglichen werden soll, nicht *wer* schlechter ist: Personenanzahl, Montage ja/nein, Halteverbot, Kartons, Festpreis vs. Stunde, Haftung/Versicherungswort, Rechnung, Anfahrt, Nachforderungsklausel.
3. Eigenes Angebot auf einer Zeile spiegeln.
4. Nicht nach den Namen der anderen fragen.
5. Nicht unterbieten, um "der Vierte" zu sein. Unterbieten ohne Leistungsabbau ist Knicken.

Mikro: "Drei Angebote sind sinnvoll. Vergleichen Sie nicht nur die Endzahl: Steht Montage drin, wer beantragt das Halteverbot, Festpreis oder Stunde, und steht da Versicherung oder die 620-Euro-Haftung? Unser Preis X enthält Y. Wenn ein anderes Angebot dasselbe schriftlich hat und günstiger ist, nehmen Sie das."

**Verboten:** "Die Billigen kommen nicht", "das kann nicht legal sein", "Check24-Schleuder". Auch dann, wenn es manchmal stimmt.

---

## 8. Entrümpelung-spezifisch

Anderer Job als Umzug. Anderer Ton. Dieselbe Wahrheitsregel.

### 8.1 Scham

Haushaltsauflösung, Messie, Trennung, "die Wohnung sieht schlimm aus". VOC und Branchenratgeber: Angehörige schämen sich, wollen keine Fotos, wollen "einfach weg". **C**.

**Erlaubt:** Normalisieren ohne Pathos. Fotos nur für Volumen. Kein "das kennen wir, so schlimm ist das nicht" (wertet). Kein Witz über Müll.

**Verboten:** Vorher-Nachher als Marketing mit erkennbarem Haus. Moral ("wie kann man so leben").

### 8.2 Frist, Erbe, "muss schnell weg"

Mietende, Sonderkündigung nach Tod (§ 580 BGB-Komplex / Nachlass), Räumungstermin, Erbengemeinschaft, die sich nicht einig ist. **B**, Erbrechts- und Vermieter-Ratgeber (ERGO, Generali; juristisch nicht vertiefen).

**Erlaubt:** Termin wahr. Was *heute* geht (Teilräumung, Sperrmüll-Termin, Container). Was nicht geht (morgen komplette 120 m² voll). Nicht die rechtliche Erbfrage lösen.

**Verboten:** "Letzte Chance heute 20 % weil Nachlass" (erfundene Dringlichkeit auf echter Trauer). Auftrag annehmen, wenn unklar ist, ob der Schreiber verfügen darf (ein Erbe von dreien).

### 8.3 Illegale Entsorgung

Auftraggeber bleibt oft Abfallerzeuger. Vertrag mit einer Firma entbindet nicht automatisch. Illegale Ablagerung: Bußgeld, im Extrem Strafrecht. Fahrlässigkeit kann reichen. **B**, KrWG-Logik, Branchen-Merkblätter; Bußgeldkataloge je Bundesland.

Sondermüll: Farben, Lacke, Chemie, Asbest-Verdacht, Batterien, bestimmte Elektrogeräte, Medikamente.

**Erlaubt und geboten:** Ablehnen, wenn der Kunde "einfach mit auf die Deponie" oder "im Wald / Restmüll" will. Angebot: nachweisbare Entsorgung, oder Kunde bringt Sondermüll selbst zur Annahmestelle.

**Verboten:** "das mischen wir unter den Sperrmüll", Preis, der nur bei illegaler Entsorgung kalkulatorisch geht. Das ist kein Einwand, den man "behandelt". Das ist ein Nein.

### 8.4 Steuer

Noch einmal: Haushaltsauflösung/Entrümpelung in der FA-BW-Liste **nicht** § 35a. Wer hier den Handwerkerbonus verkauft, liegt falsch.

---

## 9. Social Proof im Chat

### 9.1 Wann schicken, wann nicht

| Stadium | Bewertungen schicken? | Warum |
|---|---|---|
| Erste Antwort, noch keine Fotos | Nein, höchstens ein stiller Link in der Signatur | Wirkt wie Broschüre. Kunde hat noch keinen Job für Proof. |
| Kunde fragt "seid ihr seriös / Erfahrungen?" | Ja, ein Link, eine konkrete Zahl nur wenn wahr | Direkte Antwort auf Angst |
| Nach dem Festpreis, vor Zusage | Optional eine Zeile + Link | Social Proof wirkt bei Unsicherheit, Goldstein et al. 2008: ähnlich + konkret |
| Unaufgefordert 8 Screenshots | Nie | Aufdringlich, wirkt gekauft |
| Nach dem Auftrag | Bitte um ehrliche Bewertung, Link, kein "nur wenn 5 Sterne" | Reciprocity ehrlich; UWG/Irreführung bei gefilterten Bitten |

Profilstand: `google_bewertungen_anzahl: null`, Formulierung "5,0 Sterne" existiert trotzdem. **Eine 5,0 ohne n ist eine rote Flagge, nicht ein Trust-Signal.** Nicht verwenden, bis n und URL im Profil stehen.

### 9.2 Person, Name, Gesicht

Hilft, wenn:

- der Schreibende sich mit Vornamen zeigt (Dario, nicht "Team Support")
- ein reales Foto vom Einsatz oder vom Inhaber existiert
- der Kunde älter ist oder Entrümpelung/Erbe (Authority + Liking)

Hilft nicht, wenn:

- das Gesicht AI ist
- "Ihr festes 5-köpfiges Team" bei max. 3 am Auftrag und ohne Foto
- der Kunde nur den Preis will (dann ist Face Verzögerung)

**Inferenz C/D**, keine Quote.

### 9.3 Spezifisch schlägt generisch

"Die meisten Gäste in *diesem* Zimmer" schlug "helfen Sie der Umwelt". **A**, Goldstein, Cialdini, Griskevicius, JCR 2008.

Übertrag Chat: "letzten Monat drei 2-Zimmer-Umzüge in Stuttgart-Süd" (wenn wahr) schlägt "hundert zufriedene Kunden". Straße und Name des Kunden Dritter: DSGVO, nicht schicken.

---

## 10. Kill-shots

Dinge, die professionell klingen und trotzdem verlieren oder rechtlich wehtun.

| Kill-shot | Warum er tötet |
|---|---|
| "Wir sind die Günstigsten" | UWG-riskant (§ 5, ggf. § 6), oft falsch, lädt zum Unterbieten ein. VZ und Kunden vergleichen *Leistung*. |
| Erfundene Dringlichkeit ("letzter Platz heute", "Preis nur bis 18 Uhr") | Cialdini-Scarcity als Lüge. Wenn der Freitag wirklich voll ist, Kalender sagen. |
| "Familienbetrieb seit 1998" / "seit über 20 Jahren" | Profil: 2023, nicht Familienbetrieb. Irreführung § 5 UWG. |
| "Eigene LKW / eigener Fuhrpark" | Gemietet. Falschaussage. Sixt nicht erwähnen, aber Eigentum nicht behaupten. |
| Billigheimer beleidigen | Status-Niederlage für den Kunden, der den anderen ernst genommen hat. UWG-nah. |
| "Vollversichert / Transportversicherung 50.000 inklusive" | Falsch im Profil. Schadenfall = Reputations-GAU. |
| "Rechnung inkl. 19 % MwSt" | § 14c, und die echte Rechnung entlarvt es. |
| "Schwarz geht, wenn Sie nichts sagen" | Strafrecht / Bußgeld / nichtiger Vertrag. |
| "§ 35a macht uns günstiger als schwarz" als Garantie | Falsch bei Nicht-Steuerzahlern, Entrümpelung, Bar, Berufsumzug. |
| SLA "Antwort in 1 Stunde" als Versprechen, das reißt | Trust-Bruch genauer als ein hoher Preis. |
| KI-Broschürenton + Stockfotos | Kleinanzeigen-Filter "Fake". |
| Anzahlung + zweite Abschlag | VZ-Lehrbuchfall. |
| Nachverhandeln am Umzugstag trotz Festpreis | Das Horror-Skript, das Reddit erzählt. |
| "Meisterbetrieb / AMÖ / IHK-geprüft" ohne Beleg | Authority-Fälschung. |
| Google 5,0 ohne Anzahl und ohne Link | Wirkt gekauft. |

---

## Regler vs. Invarianten

**Regler** (ändern sich mit Segment, Kanal, Stadium):

- Sie/Du, Länge, Emoji (andere Datei: Register)
- Wie hart der Preis erklärt wird (Student vs. Firma vs. Erbe)
- Ob § 35a erwähnt wird (privat ja, Firma/Entrümpelung nein)
- Ob Face/Name im Chat vorkommt
- Spanne vs. eine Zahl (vor Fotos vs. nach Fotos)
- Halteverbot-Empfehlung (Straße, nicht Dogma)

**Invarianten** (gelten immer):

- Nicht lügen. Nicht schönen. Profil schlägt Wunsch-Positionierung.
- Keine Schwarzarbeit, auch nicht "ein bisschen".
- Keine MwSt ausweisen, solange § 19 gilt. Hinweis Kleinunternehmer.
- Haftung heißt Haftung, 620 EUR/m³, nicht Versicherung.
- Keine eigenen LKW erfinden. Kein Familienbetrieb erfinden. Kein Gründungsjahr zurückdatieren.
- Festpreis nach Sicht (Fotos/Video). Ohne Sicht nur Spanne mit Bedingung.
- Rabatt nur gegen weniger Leistung.
- Andere Anbieter nicht herabsetzen.
- Illegale Entsorgung ablehnen.
- Bewertungszahlen nur mit n und Quelle.
- Einwand zuerst diagnostizieren (Preis / Angst / Status / Vergleich), dann *einen* Zug.

---

## Diagnose-Signale für den späteren Skill

Der Agent liest im *letzten* Kundenturn mindestens:

1. **Einwandklasse:** Preis | Angst | Status | Vergleich | Frist | Scham | Legal (schwarz/Müll) | Prozess (Fotos, Anzahlung, Pünktlichkeit)
2. **Wortlaut-Trigger:** schwarz, bar, ohne Rechnung, vollversichert, kaputt, Nachbar, günstiger, 3 Angebote, erst Preis, Anzahlung, morgen, Halteverbot, Kartons, selbst tragen, pünktlich, Fotos, Erbe, schnell weg, Sondermüll
3. **Stadium:** vor Quali / vor Angebot / nach Angebot / nach Zusage
4. **Ob schon ein Festpreis im Thread steht** (dann kein neuer Anker ohne Grund)
5. **Ob der Kunde ein anderes Angebot beziffert** (dann Vergleichs-Checkliste, nicht Unterbieten)
6. **Segment-Hinweis:** Student, Familie, Firma, Senior, Erbe, Expat (beeinflusst 35a, Ton, Face)
7. **Kanal:** Kleinanzeigen-Erst vs. WhatsApp-Fortsetzung (Impressum-Dichte)
8. **Lügen-Verbot aus Profil:** `kleinunternehmer`, `versicherung_typ`, `familienbetrieb`, `gruendungsjahr`, `fuhrpark.eigentum`, `festnetz`, `google_*`

Wenn Legal-Trigger (schwarz, Wald, Restmüll für Lacke): zuerst Nein, dann ggf. legaler Weg. Kein Softening.

---

## Skill-Folgen (If-then, keine Line-Bibliothek)

- **Wenn** "günstiger/zu teuer" **und** Angebot steht **dann** Leistung rausnehmen, nicht Zahl weichspülen.
- **Wenn** "schwarz/bar/ohne Rechnung" **dann** ein Nein, Rechnung ohne MwSt erklären, 35a nur bei privatem Umzug als Möglichkeit, nicht als Trick.
- **Wenn** "Nachbar/anderer billiger" **dann** Umfang spiegeln, anderen nicht bewerten.
- **Wenn** "versichert/kaputt" **dann** § 451e/f/g in Alltagssprache, Wort "Transportversicherung" vermeiden, außer der Kunde fragt nach *Zusatz* und das Profil hat eine.
- **Wenn** "Halteverbot?" **dann** Empfehlung an Parksituation, Verzicht = Trageweg, Preis-Hebel.
- **Wenn** "selbst tragen/packen/Kartons" **dann** Paket bauen und Haftungshinweis Selbstpacken.
- **Wenn** "morgen/kurzfristig" **dann** Kalender wahr, Fotos heute oder Absage.
- **Wenn** "Anzahlung" **dann** Praxis der Firma sagen (bevorzugt: keine). Keine zweite Vorauszahlung.
- **Wenn** "pünktlich?" **dann** Fenster + Vortag-Update, kein Absolutum.
- **Wenn** "erst Preis, dann Fotos" **dann** Spanne + Grund + 5 Motive oder Video, kein Fake-Festpreis.
- **Wenn** "3 Angebote" **dann** Vergleichsdimensionen, eigenes Angebot stehen lassen.
- **Wenn** Entrümpelung + Scham **dann** Volumen-Fotos, kein Witz, kein 35a.
- **Wenn** illegale Entsorgung **dann** ablehnen.
- **Wenn** "seid ihr seriös" **dann** Impressum-Daten + ein echter Proof-Link, keine 5,0-Behauptung ohne n.
- **Wenn** Profil `transportversicherung_zusatz: false` **dann** niemals Versicherungs-Summe erfinden.
- **Wenn** Profil `kleinunternehmer: true` **dann** niemals "inkl. MwSt".
- **Wenn** Profil `familienbetrieb: false` oder `gruendungsjahr: 2023` **dann** "inhabergeführt seit 2023", nichts Älteres.

---

## Anti-Patterns / was professionell klingt und verliert

1. Das komplette Ist-Angebot aus `reaktion.md` (MwSt + Transportversicherung + Festnetz).
2. Lange Vertrauenspredigt vor der ersten Zahl.
3. "Wir sind seriös, im Gegensatz zu vielen auf Kleinanzeigen."
4. Rabatt, "weil Sie nett fragen".
5. § 35a alsCloser für Entrümpelung oder Firmenumzug.
6. "Vollkasko für Möbel."
7. Acht Emoji-Häkchen und drei Shield-Grafiken, null Adresse.
8. Den Kunden nach Budget fragen, *bevor* man selbst eine Spanne genannt hat (lädt Unter-Anker ein).
9. Am Umzugstag "es war mehr als auf den Fotos" ohne vorher schriftlich die Foto-Grundlage fixiert zu haben.
10. KI-Glätte: "Vielen Dank für Ihre Anfrage. Gerne unterbreiten wir Ihnen ein ganzheitliches Konzept für Ihren stressfreien Umzug."

---

## Offene Lücken (kein Gesetz daraus machen)

- Es gibt **keine** A-Studie zu Einwand-Häufigkeit im DE-Umzugs-WhatsApp. Die Top-Liste ist C.
- Die Behauptung "Verbraucherzentrale: nur Mobilnummer = Schwarzarbeit" ist im Profil hinterlegt. **Primärquelle in dieser Recherche nicht gefunden.** Nicht als Fakt ausgeben.
- Ob Kottke Betriebshaftpflicht, Verkehrshaftung, GüKG-Pflicht hat: nicht im Profil. Nicht behaupten.
- Ob Google-Reviews real existieren: `anzahl` und URL null. Nicht "5,0" schreiben.
- Ob § 19 2026 noch zutrifft: Umsatzhochrechnung spricht dagegen. Profil jedes Quartal prüfen.
- Decoy-Effekt in 1:1-WhatsApp: nicht gezeigt, nur Labor/E-Commerce.
- Conversion-Lift durch Face-Foto im Chat: unbelegt.
- Halteverbot-Gebühren Stuttgart: Stadtgebühr vs. Dienstleisterpreis schwankt, keine feste "60 Euro"-Wahrheit.
- Schlichtungsstelle Umzug / AMÖ-Mitgliedschaft: für Kottke ungeprüft.
- Widerruf: VZ NI sagt, bei termingebundener Umzugsleistung oft keines. Fernabsatz/außerhalb von Geschäftsräumen kann anders laufen. Das gehört in `research-recht-de.md`, hier nicht verhärten.
- Diese Datei ersetzt keine Steuer-, Versicherungs- oder Rechtsberatung.

---

## Quellen

### Recht und Behörden (A/B)

- [§ 35a EStG](https://www.gesetze-im-internet.de/estg/__35a.html): Steuerermäßigung haushaltsnahe Dienstleistungen / Handwerker. Rechnung + Kontozahlung: Abs. 5 S. 3.
- [Landesamt für Steuern Niedersachsen, FAQ § 35a](https://lstn.niedersachsen.de/steuer/haeufige_fragen_faq/haeufige-fragenfaq-118955.html): private Umzugskosten = haushaltsnahe Dienstleistungen; Material raus; Barzahlung ausgeschlossen.
- [Finanzamt Baden-Württemberg, haushaltsnahe Leistungen](https://finanzamt-bw.fv-bwl.de/,Lde/Startseite/Service/Was+versteht+man+unter+_haushaltsnahen+Beschaeftigungsverhaeltnissen_+_haushaltsnahen+Dienstleistungen_+und++_Handwerkerleistungen_+und+wie+sind+sie+steuerlich+zu+beruecksichtigen_): privat veranlasste Umzüge begünstigt; **Entrümpelung bei Haushaltsauflösung nicht**.
- BMF-Schreiben 09.11.2016, BStBl I S. 1213 (Anlage 1 Zuordnungsliste), zitiert über Finanzverwaltung / Finanztip.
- OFD Koblenz 08.05.2006, DStR 2006 S. 902: Umzugsspedition als haushaltsnahe Dienstleistung (über [Lohnsteuer kompakt, 2023](https://www.lohnsteuer-kompakt.de/steuerwissen/umzugskosten-zum-kostenabzug-bei-privaten-motiven/)).
- [§ 451e HGB Haftungshöchstbetrag](https://www.gesetze-im-internet.de/hgb/__451e.html): 620 EUR/m³.
- [§ 451f HGB Schadensanzeige](https://dejure.org/gesetze/HGB/451f.html): Tag danach / 14 Tage.
- § 451g HGB: Wegfall der Haftungsbegrenzung ohne Verbraucher-Unterrichtung.
- § 451d HGB: Ausschluss u. a. bei Selbstverpacken.
- [BGH 01.08.2013, VII ZR 6/13](https://dejure.org/dienste/vernetzung/rechtsprechung?Gericht=BGH&Datum=01.08.2013&Aktenzeichen=VII%20ZR%206/13): keine Gewährleistung bei Ohne-Rechnung-Abrede.
- BGH 10.04.2014, VII ZR 241/13: auch Teil-Schwarz: gesamter Vertrag nichtig, kein Werklohn.
- BGH 16.03.2017, VII ZR 197/16: nachträgliche Schwarzgeldabrede erfasst den ganzen Vertrag.
- [Zoll: Privatperson als Auftraggeber](https://www.zoll.de/DE/Privatpersonen/Arbeit/Privatperson-als-Auftraggeber/privatperson-als-auftraggeber_node.html): Bußgeld bis 50.000 EUR; BGH-Folgen.
- SchwarzArbG § 1, § 8: Definition und Bußgeldrahmen.
- § 19 UStG, § 14c UStG, § 34a UStDV: Kleinunternehmer, kein USt-Ausweis.
- [IHK Rhein-Neckar, Kleinunternehmer 2025](https://www.ihk.de/rhein-neckar/recht/steuerrecht/umsatzsteuer-national/kleinunternehmerregelung-in-der-umsatzsteuer-4675688): Grenzen 25.000 / 100.000.
- [§ 6 UWG vergleichende Werbung](https://dejure.org/gesetze/UWG/6.html); §§ 4, 5 UWG Herabsetzung / Irreführung.
- KrWG (Abfallerzeuger / Beauftragung Dritter): Haftungspfad bei Entsorgung.

### Verbraucherschutz und Haftung (B)

- [Verbraucherzentrale: Umzugsunternehmen, nicht auf Abzocker reinfallen](https://www.verbraucherzentrale.de/wissen/vertraege-reklamation/kundenrechte/umzugsunternehmen-so-fallen-sie-nicht-auf-umzugsabzocker-rein-10470) (11.06.2025): Festpreis, 15-20 % bei Stunde, 620 EUR/m³, Zeitwert, Fristen, Vergleichsangebote.
- [Verbraucherzentrale: Handwerker finden](https://www.verbraucherzentrale.de/wissen/vertraege-reklamation/kundenrechte/handwerker-finden-so-vermeiden-sie-boese-ueberraschungen-13664) (10.12.2025): 2-3 Angebote, schriftlich, Rechnung erst bei Fertigstellung vollständig.
- [VZ NRW: Handwerkerportale](https://www.verbraucherzentrale.nrw/wissen/vertraege-reklamation/kundenrechte/handwerkerportale-checkliste-fuer-die-handwerkersuche-im-netz-31533) (16.07.2026): Impressum/Profil, Bewertungen nur Orientierung.
- VZ Niedersachsen / Tiana Preuschoff (2021), wiedergegeben bei [platzda.de](https://www.platzda.de/blog/verbraucherzentrale-vz-niedersachsen-warnt-vor-unserioesen-umzugsunternehmen.html): in der Regel keine Anzahlung; keine zweite Vorauszahlung; Festpreis; kein Widerruf bei termingebundener Leistung; nicht drängen.
- [Finanztip, haushaltsnahe Dienstleistungen](https://www.finanztip.de/haushaltsnahe-dienstleistungen/) (09.07.2026): Umzug ja, Entrümpelung nein; Rechnung + Überweisung.
- [FSA24, Haftung Umzüge](https://www.fsa24.de/Haftung-Umzuege): 451e/f/g, Aufklärung, Zeitwert, Verkehrshaftung vs. Transportversicherung vs. Betriebshaftpflicht. Branchenmakler, inhaltlich am Gesetz.

### Psychologie (A, Übertragung oft Inferenz)

- Tversky, A. & Kahneman, D. (1974). Judgment under uncertainty: Heuristics and biases. *Science*, 185, 1124-1131.: Anchoring.
- Kahneman, D. & Tversky, A. (1979). Prospect Theory. *Econometrica*, 47(2), 263-292.: Loss Aversion.
- Galinsky, A. D. & Mussweiler, T. (2001). First offers as anchors. *JPSP*, 81(4), 657-669.
- Schweinsberg, M. et al. (2012). *JESP*: extreme Erstgebote, Impasse.
- Huber, J., Payne, J. W. & Puto, C. (1982). Adding asymmetrically dominated alternatives. *JCR*, 9(1), 90-98.: Decoy.
- Cialdini, R. B. (1984/2021). *Influence*. Prinzipien; ethischer Rahmen: [influenceatwork.com](https://www.influenceatwork.com/7-principles-of-persuasion/).
- Goldstein, N. J., Cialdini, R. B. & Griskevicius, V. (2008). A room with a viewpoint. *JCR*, 35(3), 472-482.: spezifischer Social Proof.

### VOC und Branchenpraxis (C/D)

- Reddit [r/wohnen: Umzugspreise 2025](https://www.reddit.com/r/wohnen/comments/1m7i5pb/wie_viel_habt_ihr_f%C3%BCr_euren_umzug_mit_einer/): Spanne 300-5.000 EUR; Kleinanzeigen-Schnäppchen + Pleite; Nachverhandeln trotz Besichtigung; Trinkgeld-Norm.
- Reddit [r/wohnen: worauf achten, 2023](https://www.reddit.com/r/wohnen/comments/12qjrwa/was_kostet_umzugsunternehmen_und_worauf_achten/): "schwarz 500 billiger"; Festpreis wichtiger als Besichtigung; Fotos für Schadenbeweis; 24-h-Frist verpasst.
- [Stadt Stuttgart, Halteverbotszone / Parkplatzabsperrung](https://www.stuttgart.de/organigramm/leistungen/parkplatzabsperrung-oder-halteverbotszone-fuer-umzug-beantragen); [service-bw, vorübergehendes Haltverbot](https://www.service-bw.de/zufi/leistungen/105): Antrag, Schilder i. d. R. 72 h vorher.
- jack-news.de (24.02.2026): fehlendes Festnetz als mögliches Seriositäts-Indiz (D, nicht VZ-Primärquelle).
- Bynder (2024): 50 % erkennen KI-Text. YouGov DE (13.05.2025): 54 % misstrauen KI-Nachrichten.
- Ist-Dateien: `~/.claude/skills/kleinanzeigen-umzuege/strategie/reaktion.md`, `profiles/kottke-umzuege.json`, `templates/beschreibung-skelett.md`.
