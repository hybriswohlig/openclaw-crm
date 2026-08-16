# Kanal-Psychologie und Kanal-Regeln für lokale DACH-Services

Recherche-Grundlage für einen späteren Texting-Skill. Stand: 2026-08-15.

In Deutschland ist WhatsApp der Default-Kanal für Handwerk, Umzug und Entrümpelung, nicht die E-Mail und nicht der Chat des Portals. Kunden bringen in jeden Kanal ein anderes Register, eine andere Geduld und ein anderes Betrugsradar mit. Wer Kleinanzeigen wie WhatsApp behandelt oder WhatsApp wie eine Angebotsmail, verliert den Auftrag, ohne dass der Text inhaltlich falsch wäre. Die härteste Variable ist nicht Höflichkeit, sondern Kanalpassung plus Geschwindigkeit plus der Moment, in dem man die Nummer zieht.

---

## Wozu diese Datei da ist

Ein künftiger Skill muss *vor* dem ersten Satz den Kanal lesen. Derselbe Inhalt (Festpreis nach Fotos, Termin, Ablehnung) klingt auf Kleinanzeigen, WhatsApp, Check24, Immoscout, Mail und Telefon wie fünf verschiedene Sprechakte. Diese Datei liefert:

1. was über Kanalverbreitung, Erwartungen und Plattformregeln in DACH **belastbar** ist,
2. wo US-Lead-Studien und Vendor-Quoten **nicht** als deutsche Umzugs-Wahrheit taugen,
3. welche Signale der Agent im Kunden-Text und im Kanal **diagnostizieren** muss, bevor er formuliert.

Sie ist keine Template-Sammlung. Sie ist keine Rechtsberatung (dafür `research-recht-de.md`). Sie ist keine Segment-Datei (dafür `research-segmente.md`). Sie prüft den Ist-Zustand in `~/.claude/skills/kleinanzeigen-umzuege/strategie/reaktion.md` und darf ihn widerlegen.

**Annahmen**

- Kontext: B2C/B2B Service-Verkauf (Umzug, Entrümpelung, später Handwerk), Region Stuttgart, Leads über Kleinanzeigen, Immoscout, Check24, Google; Chat primär WhatsApp.
- Sprache der Datei: Deutsch. Quellen DE/EN.
- Keine Em-Dashes. Inferenzen sind als Inferenz markiert.
- US-SMS/TCPA und US-Home-Service-CRMs sind Übertrag, nicht Gesetz.

---

## Kernsatz

Der Kanal ist kein Transportmittel. Der Kanal ist der Vertrag über Tempo, Nähe und Risiko.

Wer auf Kleinanzeigen zu früh die Handynummer verlangt, wirkt wie der Betrug, vor dem die Plattform warnt. Wer auf WhatsApp eine halbe Seite Behördendeutsch schickt, wirkt wie eine Firma, die den Kunden nicht sieht. Wer nach einer Chat-Frage ungefragt anruft, stiehlt Zeit. Wer auf Check24 Beziehungstext schreibt, während drei andere Anbieter eine Zahl liefern, verliert auf Preis, ohne je auf Vertrauen gewonnen zu haben.

---

## Wie Evidenz hier gelesen wird

| Stufe | Bedeutung |
|---|---|
| **A** | Peer-Review, Gesetzestext, BGH, große repräsentative DE/DACH-Umfrage (Bitkom, Destatis/Eurostat, ARD/ZDF, SIM/mpfs, Statista Consumer Insights mit n + Methode). |
| **B** | Eine starke Studie, Verbandsstudie (AMÖ, Verbraucherzentrale, Handwerkskammer/DHZ), große Plattform-Umfrage, belastbarer Journalismus mit Methode, OLG/klare Behördenlinie. |
| **C** | Wiederholte Erstberichte (Foren, Reddit, Kleinanzeigen-Erfahrungen, Handwerker-Blogs, Trustpilot-Verbatims). Gut für Textur, nicht für Quoten. |
| **D** | Einzelner Coach, Sales-Blog, Agentur-Whitepaper, Anekdote, US-Studie ohne DACH-Übertrag. |
| **E** | Folklore ("WhatsApp hat 98 Prozent Open Rate", "immer in der ersten Minute anrufen", "niemals Voice Note"). Oft falsch oder unbelegt. |

**Wichtige Lücke:** Es gibt keine peer-reviewte DACH-Studie, die *Umzugs-Leads × Kanal × Antwortzeit × Close-Rate* misst. Speed-to-Lead-Zahlen sind fast immer US-Home-Service oder B2B-Webformulare 2007–2011. Sie dürfen die Richtung stützen (schnell schlägt langsam), nicht die Prozentzahl im Skill.

---

## 1. WhatsApp als Default-Kanal

### 1.1 Verbreitung: nicht "jung", sondern Normalfall

- 83 Prozent der 16- bis 74-Jährigen in Deutschland nutzten im 1. Quartal 2025 Messengerdienste (WhatsApp, Signal, Telegram und andere). 2024 waren es 80 Prozent. Leicht über dem EU-Schnitt (82 Prozent). **A** — Destatis nach Eurostat, 2025/2026.
- Statista Consumer Insights 2025: rund 97 Prozent der Befragten in Deutschland kennen WhatsApp, 83 Prozent dieser Personen nutzen ihn regelmäßig. Spitzenposition vor Facebook Messenger (bekannt ca. 81 Prozent, genutzt ca. 44 Prozent). **A** — Statista Consumer Insights, Infografik Mai 2025.
- Superchat (Vendor) fasst 2026 zusammen: rund 76 Prozent der Deutschen nutzen WhatsApp; mehr als 50 Millionen täglich; Deutschland ca. 60 Millionen Nutzer. Das ist Sekundäraggregation, nicht Primärstudie. **D** — Superchat, Feb. 2026.
- Ältere, aber methodisch starke Referenz: ARD/ZDF-Onlinestudie 2021, 70 Prozent der Deutschen ab 14 nutzen WhatsApp täglich; über alle Altersgruppen hinweg mindestens wöchentlich sehr hoch. **A** (älter) — ARD/ZDF 2021, zitiert u. a. bei Lime/Userlike.
- Generation 60+: SIM-Studie 2024 (n = 2.000, telefonisch, Mai–August 2024). 87 Prozent der ab 60-Jährigen sind online. Unter den Onlinern nutzen 67 Prozent täglich Kurznachrichtendienste wie WhatsApp. 50 Prozent schreiben oder empfangen täglich E-Mails. Smartphone-Ausstattung 60+: 83 Prozent (2021: 72 Prozent). **A** — mpfs/LFK/SIM 2024.
- Messenger sind also auch bei Senioren der häufigste *tägliche* Digitalkanal. Das widerlegt die Folklore "Alte wollen nur Festnetz". Es widerlegt nicht, dass *hochpreisige, unsichere* Entscheidungen (Umzug, Entrümpelung der Wohnung der Eltern) oft noch den Anruf wollen. **Inferenz.**

**Skill-Folge:** WhatsApp-Fähigkeit darf nicht an Alter gekoppelt werden. Alter ändert den *Job* (Angebot schriftlich vs. erst mal sprechen), nicht die Existenz des Kanals.

### 1.2 Was Kunden über Messenger mit Firmen wollen

- YouGov 2018: meistgenannter Einsatzbereich für WhatsApp mit Unternehmen war Kundenservice (54 Prozent), Beratung 42 Prozent. **B** — YouGov via Statista, 2018 (alt, Absicht nicht Verhalten).
- Tyntec 2019: 51 Prozent wollten Versandbestätigung/Tracking per WhatsApp, ca. 50 Prozent Terminvereinbarung, 43 Prozent Verspätungsinfos, 39 Prozent Support statt Hotline. **B** (älter) — Tyntec/Statista.
- YouGov 2018 zu Vorteilen: keine Warteschleife, unabhängig von Öffnungszeiten, Medien mitschicken, keine Hotline-Kosten. **B**.
- Capterra 2021: 47 Prozent wollen immer oder oft mit Unternehmen über WhatsApp kommunizieren, weitere 34 Prozent gelegentlich; Bezahlen per WhatsApp sehen 48 Prozent kritisch. Attitude-Behavior-Gap gilt. **B**.
- Bitkom 2018 zu Funktionen (letzte 3 Monate): 85 Prozent Schreiben, 70 Prozent Bilder/Videos/GIFs/Links, 51 Prozent Telefonie über den Messenger. **A** (alt) — Bitkom, Aug. 2018.
- Bundesnetzagentur 2020 (via Lime): 81 Prozent nutzten bei ihrem bevorzugten Messenger täglich Sprach- *oder* Bildnachrichten; knapp die Hälfte täglich Sprachnachrichten. Videotelefonie nur 11 Prozent täglich. **B**.

**Inferenz für Umzug:** Der Kanal ist gebaut für (1) kurze Klärung, (2) Fotos statt Besichtigung, (3) Termin, (4) Status ("wir sind 20 Minuten verspätet"). Er ist nicht gebaut für acht Absätze AGB.

### 1.3 Business-Account vs. privates Handy

- Die private WhatsApp-App bestätigt in den AGB private Nutzung. WhatsApp Business ist der vorgesehene Betriebskanal: Unternehmensprofil (Adresse, Website, Öffnungszeiten, Beschreibung), damit auch Impressums-Informationen sichtbar, automatische Antworten, Abwesenheit, Labels, mehrere Admins. App selbst kostenlos; Kosten erst bei Cloud-API/CRM. **B** — Deutsche Handwerks Zeitung, April 2024, mit ibi research / HWK-Seminaren.
- DSGVO-Problem bleibt auf dem Smartphone: WhatsApp liest das Adressbuch. Empfehlung der Fachpresse: Firmenhandy, leeres Adressbuch, Sync aus; oder Kunde schreibt von sich aus die veröffentlichte Business-Nummer an. Daumen-hoch auf AGB-Hinweis ist Praxisrat, kein Gerichtsurteil. **B** für das Problem, **D** für die Daumen-hoch-Lösung. Details in `research-recht-de.md`.
- Sichtbarer Business-Account (grüner Punkt, Profil, Öffnungszeiten) senkt die Wahrscheinlichkeit, dass die Nummer wie ein privater Scam-Account wirkt. **Inferenz**, gestützt durch Kleinanzeigen-/Polizei-Warnungen vor unbekannten WhatsApp-Nummern.

**Ist-Zustand prüfen:** Kottke kommuniziert öffentlich WhatsApp `0151-59058963`. Für den Skill gilt: als Betriebskanal behandeln, nicht als Darios Privat-Chat. Online-Status und blaue Haken sind dann *Firmenverhalten*, nicht Privatsphäre-Theater.

### 1.4 Blaue Haken, Online-Status, Last Seen

- Mechanik (WhatsApp Help): ein Haken = gesendet, zwei grau = zugestellt, zwei blau = gelesen (wenn Lesebestätigung an). "Online" heißt: App offen und verbunden, *nicht* "hat deine Nachricht gelesen". Last Seen und Online sind getrennt einstellbar. **A** — WhatsApp FAQ.
- Lesebestätigung aus = man sieht selbst keine blauen Haken mehr. **A**.
- Psychologie ist fast nur C/D: gelesen und stundenlang nichts gilt als Unhöflichkeit oder Desinteresse. Im Privatleben deaktivieren viele die Haken genau deshalb. Im Geschäftskontakt wirkt "blau und stumm" härter als "grau, noch nicht gelesen". **Inferenz + C**.
- Online-Status während der Arbeitszeit, ohne zu antworten: der Kunde sieht, dass jemand da ist und ihn ignoriert. Nachts oder Sonntag "online" ohne Auto-Hinweis wirkt wie Bereitschaft, die man nicht leistet. **Inferenz**.

**Skill-Folge:** Erste Stunde nach *blau* ist teurer als erste Stunde nach *grau*. Wenn gelesen und der volle Preis noch nicht steht: eine Zeile "Wir rechnen das durch, Rückmeldung bis … Uhr" schlägt Stille. Das ist keine 3-Minuten-Folklore, das ist sichtbare Aufmerksamkeit.

### 1.5 Voice vs. Text vs. Foto

- YouGov, 17 Märkte, November 2023: 66 Prozent bevorzugen *Senden* als Text, 7 Prozent Audio, 21 Prozent beides gleich. Europa textlastiger als Asien. Briten 83 Prozent Text-Präferenz beim Senden. Beim *Empfangen* sind Italiener in Europa am ehesten audio-affin (10 Prozent), danach Deutsche. Exakte DE-Prozentzahl im frei lesbaren Text nicht ausgewiesen. **B** — YouGov, Feb. 2024.
- Großbritannien 2024/2026: YouGov nennt GB als voice-averse; 83 Prozent bevorzugen Text. Nicht 1:1 DACH, aber Richtungsgleich. **B** für UK, **D** für DE-Übertrag.
- Bitkom 2018: Bilder sind die zweithäufigste Messenger-Funktion. **A**.
- Superchat/Statista-Aggregation: weltweit täglich Milliarden Bilder über WhatsApp. Vendor-Zahl. **D**.

**Inferenz Betrieb:** Text ist der sichere Default. Foto ist der Arbeitskanal für Angebotskalkulation (passt zum Modell "verbindlicher Preis nach 5–10 WhatsApp-Fotos"). Voice Note vom *Kunden* annehmen und in Text spiegeln. Voice Note vom *Betrieb* nur, wenn der Kunde selbst per Voice kommt, oder für einen konkreten Zugang ("Einfahrt zweite rechts, Torcode folgt als Foto"). Unaufgeforderte Betriebs-Voice in der Erstansprache ist in Nordeuropa eher Last als Nähe.

---

## 2. Kleinanzeigen-Chat: knapp, anonym, betrugsgeschult

### 2.1 Warum der Ton dort so karg ist

Der Kleinanzeigen-Chat ist kein Kundenservice. Er ist ein Marktplatz-Filter zwischen Fremden.

Wiederholte Erstberichte (r/wasletztepreis, Foren, Feuilletons): oft kein Hallo, eine Zeile, Preis, Verfügbarkeit, "Geht das noch?". Das ist nicht Unhöflichkeit gegen den Betrieb, das ist die Norm des Kanals. **C**.

Drei strukturelle Gründe, keine Quote:

1. **Anonymität und Wegwerf-Accounts.** Registrierung braucht verifizierte Telefonnummer, aber nach außen reicht ein Nickname. Die Plattform veröffentlicht nur, was der Nutzer preisgibt. **A** — Kleinanzeigen-Hilfe zu Kontaktdaten.
2. **Betrugsradar.** Polizei, SWR, Händlerbund, Kleinanzeigen selbst: Kontaktaufnahme per WhatsApp/SMS *außerhalb* des Chats ist ein klassisches Phishing-Muster (Fake-PayPal, Kontoübernahme, "Geben Sie den SMS-Code ein"). Die Plattform trainiert Nutzer darauf, persönliche Daten im Chat als Warnsignal zu lesen. **A/B**.
3. **Niedrige Commitment-Kosten.** Eine Nachricht kostet Sekunden. Viele schreiben drei Anbieter parallel. Der Chat ist Vorzimmer, nicht Auftrag.

**Inferenz:** Knappheit auf Kleinanzeigen ist kein Segment-Signal für "Student, also Du". Es ist Kanal-Default. Anrede erst spiegeln, wenn der Kunde eine setzt.

### 2.2 Plattformregeln zu Kontaktdaten

- Private Nutzer: Feld Telefonnummer bei *neuen* Anzeigen entfernt, Begründung Phishing per SMS/Messenger. Bestehende Anzeigen können die Nummer noch zeigen. **A** — Kleinanzeigen-Hilfe.
- Gewerbliche Nutzer: Rufnummer im vorgesehenen Feld hinter dem Button "Anrufen", nur für angemeldete Nutzer einblendbar. **A**.
- AGB § 5: keine E-Mail-Adressen oder Rufnummern anderer Nutzer ohne deren Einwilligung sammeln oder verwenden. **A** — Nutzungsbedingungen ab 17.02.2024.
- Grundsätze: Teilen von Inhalten (auch via Nachricht), die gegen Gesetz, Grundsätze oder gute Sitte verstoßen, ist verboten. Reine Website-Werbung, Suchwort-Spam, Wegwerfadressen: verboten. **A** — themen.kleinanzeigen.de/policy.
- Sicherheitshinweise der Plattform: gefälschte Chat-Nachricht u. a. erkennbar an (3) Aufforderung, persönliche Daten im Chat zu veröffentlichen, und (4) wenn der Gesprächspartner selbst persönliche Daten im Chat veröffentlicht. **A** — Kleinanzeigen Sicherheitstipps.
- SHS-Regel mit Polizei: Stoppen, Hinterfragen, Schützen. Druck zu schnellen Entscheidungen ist Betrugsmuster. **A/B**.
- AGB § 1 Nr. 4: Aktivitätsindikatoren (Antwortrate, durchschnittliche Antwortzeit) können öffentlich am Profil stehen. **A**.
- Hilfe-Artikel bei ausbleibender Antwort: "Warte 2–3 Tage, bevor du nochmal schreibst." Das ist Rat *an Interessenten*, nicht SLA für Gewerbliche. **B**.

**Ist-Zustand:** `plattformregeln.md` im Kleinanzeigen-Skill fordert Festnetz prominent und WhatsApp-Hinweis in der Anzeige. Das ist für Gewerbliche im vorgesehenen Feld zulässig. Im *Chat* die Nummer in der ersten Antwort unaufgefordert zu posten, kollidiert mit dem Betrugsskript, das die Plattform selbst beschreibt.

### 2.3 Wann der Wechsel auf WhatsApp legitim ist

Wechsel ist ein Sprechakt, kein technischer Shortcut.

| Wer initiiert | Wann es trägt | Wann es Vertrauen kostet |
|---|---|---|
| Kunde schreibt "WhatsApp?", schickt selbst Nummer, oder bittet um Fotos/Standort | Sofort folgen, eine klare Nummer, kein zweiter Kanal gleichzeitig | Nummer plus Mail plus "rufen Sie uns an" in einem Block |
| Betrieb nach 2–3 sachlichen Turns, weil Fotos/Standort/PDF den In-App-Chat sprengen | Begründung nennen ("Fotos kommen bei uns zuverlässiger auf WhatsApp an") und Alternative lassen | Erste Antwort: "Schreiben Sie uns auf WhatsApp unter …" |
| Betrieb sofort, noch vor Adresse/Termin | — | Sieht aus wie die Masche, vor der Polizei warnt. **B** |

AMÖ listet "Anzeigen in Ebay-Kleinanzeigen oder ähnlichen Verkaufsplattformen" ausdrücklich unter den 10 Erkennungszeichen unseriöser Umzugsanbieter. **B** — AMÖ, "Worauf beim Umzug achten". Das ist Verbandsinteresse (Mitglieder vs. Plattform), aber es erklärt das Misstrauen: Wer auf Kleinanzeigen steht, muss *im Chat* seriöser wirken als die Plattform dem Verband gilt. Impressum, Festpreis-Logik, keine Bar-only-Forderung.

**Skill-Folge:** Auf Kleinanzeigen erst den Job im Chat erledigen (ob überhaupt Kapazität, grobe Spanne, welche Fotos). WhatsApp anbieten, nicht abverlangen. Nummer in der Anzeige (gewerbliches Feld) ist etwas anderes als Nummer in der ersten Chat-Zeile.

---

## 3. Immoscout, Check24, Google: Portal-Lead vs. direkte WhatsApp-Anfrage

### 3.1 Der Unterschied in einem Satz

Eine direkte WhatsApp-Anfrage sagt: "Ich habe *euch* gewählt." Ein Portal-Lead sagt: "Ich vergleiche *euch mit anderen*." Dasselbe Angebotstextfeld trifft auf zwei verschiedene psychologische Verträge.

### 3.2 Immoscout

- Kontakt läuft über Nachrichten-Manager / KontaktPlus: Formular, oft Pflichtfelder, automatische Antwort möglich. ImmoScout selbst schreibt: eine Antwort auf die Kontaktanfrage verbessert nachweislich die später vergebene Anbieterbewertung. Sammelantworten und Bausteine sind das vorgesehene Werkzeug *für Makler*. **B** — ImmoScout Anwenderhandbuch.
- Der Nutzer ist im Suchmodus Wohnung/Haus, nicht im Suchmodus Umzug. Umzugsanfragen sind Zusatzprodukt der Plattform ("Umzugsanfragen" im Hilfemenü). Erwartung: Vergleich, Stress, viele parallele Formulare, geringe Bindung an den Dienstleister. **Inferenz + B** (Produktlogik).
- Ton des Portals: Sie-Form, Formularprosa, "Ihre Anfrage". Wer dort mit "Hi, cool dass du schreibst" antwortet, bricht das Register. **Inferenz**.
- Trust-Währung der Plattform sind Anbieterbewertungen (Erreichbarkeit ist ein Kriterium). Schweigen nach Formular schadet doppelt: Lead weg *und* Note runter. **B**.

**Skill-Folge:** Immoscout-Lead wie eine schriftliche Anfrage behandeln: Name, Bezug zum Objekt/Umzugstermin, eine klare nächste Handlung, Angebot oder Quali. Nicht so tun, als wäre man schon im WhatsApp-Alltag. Kanalwechsel auf WhatsApp nur mit Nutzen ("Fotos der Wohnung für den Festpreis").

### 3.3 Check24 / Vergleichsportal

- Check24 Profis / Umzug: Kunde gibt Eckdaten ein, bekommt mehrere Angebote, soll vergleichen. Marketingversprechen Richtung "bis zu 43 Prozent sparen", "günstigere Angebote". Bewertungen nach Abschluss. **B** — Check24-eigene Seiten.
- Anbieterseite: Anfragen per Mail oder App, oft an mehrere Profis gleichzeitig, Pay-per-Lead-Logik (Handwerker-Berichte: Gebühr auch ohne Auftrag; automatisierte Preise; Kalender, der nicht zur Realität passt). **C** — u. a. Malermeister Heinrich, April 2025; branchentypische Berichte 2025/26.
- Kundenerwartung, die das Portal selbst erzeugt: Preisvergleich, Unverbindlichkeit, mehrere parallele Anbieter, wenig Beziehung. Testimonial-Ton: "eins der günstigeren Angebote … zufrieden". **B**.
- AMÖ warnt vor Plattformen, bei denen man nicht weiß, wer kommt; empfiehlt umzug.org (eigene Mitglieder). **B**. Das erklärt, warum Check24-Kunden *trotzdem* Preis zuerst lesen: das Portal hat ihnen genau diesen Job gegeben.

**Inferenz für Länge und Festpreis:** Auf Check24 gewinnt Klarheit der Zahl und des Leistungsumfangs, nicht Wärme. Lange Trust-Biografie wirkt wie Ausweichen. Festpreis mit Leistungsgrenzen (Stockwerk, Aufzug, Halteverbot, Klavier) ist die einzige seriöse Antwort auf Preisdruck. Stundenpreis ohne Deckel ist auf diesem Kanal ein Einladungsbrief zum Weiterklicken.

### 3.4 Google: Business Messages ist tot, WhatsApp-Button ist der Nachfolger

- Google Business Messages (Chat in Maps/Suche) wurde zum 31. Juli 2024 eingestellt. **A** — Google Developers Release Notes.
- Nachfolger für lokale Betriebe: WhatsApp- oder SMS-Option im Google Unternehmensprofil. Offizielle WhatsApp-Hilfe: Nummer im Profil hinterlegen, Kunden sehen einen Click-to-Chat-Button in Search/Maps (mobil). **A** — WhatsApp FAQ / Google Business Support.
- Der Lead *sieht aus wie* Google, *landet* aber in WhatsApp. Erwartung: Maps-Nutzer, oft unterwegs, Bewertungssterne im Blick, kurze Frage ("Habt ihr nächste Woche noch was frei?", "Was kostet 2-Zimmer Stuttgart-West?"). **Inferenz**.
- Google-Währung sind Bewertungen und Antwortgeschwindigkeit auf öffentliche Reviews (eigenes Thema). Der Chat erbt die Ungeduld der Suche: wer oben steht und nicht antwortet, wird weggewischt. **Inferenz**, Richtungsgleich mit US-Local-Service-Daten (unten, Stufe D).

**RCS:** In DE im Kommen (Android Messages), von Carriern gepusht. Für einen 5-Personen-Umzugsbetrieb 2026 kein Kunden-Erwartungskanal. Nicht gegen WhatsApp ausspielen. **D**.

---

## 4. E-Mail vs. WhatsApp vs. Anruf: Job, nicht Generation allein

### 4.1 E-Mail ist nicht tot

- Bitkom Research, KW 41–46 2025, n = 1.002 ab 16, davon 928 Internetnutzer, telefonisch, repräsentativ: durchschnittlich 13 private E-Mails pro Tag (vor zwei Jahren 10). Nur 1 Prozent der Internetnutzer hat keine private Mailadresse. E-Mail bleibt in allen Altersklassen relevant. **A** — Bitkom, 11.12.2025.
- SIM 2024: 50 Prozent der Onliner 60+ täglich E-Mail; E-Mail-Kompetenz 86 Prozent (60–69), 77 Prozent (70–79), 45 Prozent (80+). **A**.
- Superchat-interne Verteilung (Vendor-Kunden, nicht repräsentativ DE): WhatsApp 76 Prozent der gesendeten / 65 Prozent der empfangenen Nachrichten; E-Mail 5 Prozent gesendet / 19 Prozent empfangen. First Response auf WhatsApp mehr als doppelt so schnell wie Mail. **D** — Superchat 2026, Selektion: Betriebe, die eine Messaging-Plattform bezahlen.

**Lesen:** E-Mail ist der Kanal für *Artefakt* (Angebot, Rechnung, Bestätigung, Weiterleiten an Partner/Steuer/Arbeitgeber). WhatsApp ist der Kanal für *Bewegung* (klären, Fotos, "passt"). Telefon ist der Kanal für *Unsicherheit* und für Menschen, die tippen nicht wollen oder nicht können.

### 4.2 Welches Segment welchen Kanal für welchen Job nutzt

Das ist die härteste Stelle dieser Datei: belastbare DE-Quoten *pro Segment × Kanal × Umzug* fehlen. Die folgende Matrix mischt A/B-Nutzung mit C-Textur und Ist-Zustand. Keine Close-Rate erfinden.

| Segment (grob) | Kanal für Erstkontakt | Kanal für Angebot | Kanal für Unsicherheit / Close | Typischer Fail |
|---|---|---|---|---|
| Student / WG | Kleinanzeigen-Chat oder WhatsApp, oft Du, oft eine Zeile | WhatsApp-Zahl reicht, PDF optional | Chat. Anruf wirkt wie Kontrolle | Lange Sie-Mail, "Liebe Interessenten" |
| Berufstätige Familie | WhatsApp oder Kleinanzeigen, Sie | WhatsApp plus PDF oder kurze Mail zum Weiterleiten an Partner | WhatsApp; Anruf nur nach Ankündigung | Unangekündigter Anruf in der Mittagspause |
| Senior / Verkleinerung | Telefon oder Formular, oft Angehörige schreiben | Schriftlich (Mail/PDF), große Schrift, eine Ansprechperson | Anruf. WhatsApp als Ergänzung, nicht Ersatz | Nur Chat, keine Stimme, Voice Note statt Gespräch |
| Firma / Office | Mail oder LinkedIn/Webformular | Mail mit PDF, USt, Leistungsbeschreibung | Telefon nach Termin | Emoji-WhatsApp an die Info-Adresse |
| Expat | WhatsApp oder Mail, oft EN | WhatsApp + PDF | WhatsApp; Telefon nur wenn Englisch sicher | DE-Behördendeutsch, Umlaute-PDF ohne EN |
| Check24-Vergleicher | Portal, anonym | Kurze Zahl + Leistung, Portal oder Mail | Portal/WhatsApp, wenig Smalltalk | Beziehungsaufbau vor der Zahl |
| Google-Maps-Klick | WhatsApp-Button oder Anruf | WhatsApp | Wer zuerst sinnvoll antwortet | Öffnungszeiten-Lüge, blaue Haken, dann nichts |

**Ist-Zustand `segmente.md`:** Senioren-CTA betont Festnetz; Studenten WhatsApp/Du; Firma Mail/Festnetz. Das hält der Recherche stand als *Regler*, nicht als Gesetz. SIM 2024 zeigt: viele 60–79-Jährige *können* Messenger. Der Skill muss den vom Kunden eröffneten Kanal respektieren. Wer auf WhatsApp schreibt, bekommt WhatsApp, auch mit 72.

### 4.3 Schriftliches Angebot

Verbraucherzentrale (Stand 11.06.2025): Vergleichsangebote einholen, alle Teilleistungen schriftlich fixieren, Festpreis in den meisten Fällen empfehlenswert, MwSt ausweisen, Leistungsumfang exakt. Haftung gesetzlich § 451e HGB 620 EUR/m³ (VZ-Text; Kottke-Brief nennt § 451g, das ist Rechtsabgleich für `research-recht-de.md`). **A/B**.

AMÖ: drei Angebote seriöser Firmen, kühl vergleichen, Bauchgefühl, nicht nur Preis. **B**.

**Inferenz Kanal:** Das verbindliche Angebot braucht ein weiterleitbares Artefakt. WhatsApp-Fließtext allein ist für Paare und Firmen schwach (Partner sieht ihn nicht in der gemeinsamen Mail). PDF oder saubere Mail *nach* der WhatsApp-Klärung ist der Job, nicht der Einstieg.

---

## 5. Antwortzeit-SLA: Richtung ja, Prozent nein

### 5.1 Was die großen Studien wirklich messen

- MIT / InsideSales, James Oldroyd, 2007: Odds of *contact* 100-mal höher bei Anruf innerhalb 5 Minuten vs. 30 Minuten; Odds of *qualification* 21-mal höher. B2B-Web-Leads, USA, Telefon-Nachfassen. **B** als Studie, **D** als DE-WhatsApp-Umzug.
- HBR, Oldroyd / McElheran / Elkington, März 2011: viele Firmen antworten viel zu langsam; oft zitiert: Qualifikation 7-mal wahrscheinlicher innerhalb 1 Stunde vs. 2 Stunden; Durchschnitt damals viele Stunden bis Tage. Paywall, Sekundärzitate inflationär. **B** (Richtung), **D** (die im Netz wandernden Multiplikatoren).
- Diese Studien messen *Kontaktieren eines Formular-Leads*, nicht *Qualität einer WhatsApp-Antwort um 21:40 Uhr*.

### 5.2 Local Service, fast nur USA

Vendor- und Plattformzahlen 2024–2026 (ServiceTitan, Hatch, HomeAdvisor/Angi, PipelineOn-Aggregation):

- Erster Rückrufer bekommt den Job in der Größenordnung 78 Prozent (HomeAdvisor-Umgebung, parallele Anfragen an 3–4 Firmen). **D**.
- ServiceTitan 2025 (100.000+ Accounts, US): unter 2 Minuten Conversion 62 Prozent vs. 28 Prozent bei 42 Minuten Branchenschnitt; 23 Prozent der Leads bekommen nie eine Antwort. **D**.
- Hatch 2024, 132.188 HVAC-Kampagnen: nur 12 Prozent antworten in 5 Minuten, 37 Prozent erst am nächsten Tag. **D**.
- Nachts ohne Automation: oft zitiert 34 Prozent Verlust durch Next-Day. **D**.

Richtung, die den Atlantik überlebt: Bei *Vergleichs-Leads* (Check24, Immoscout-Zusatz, Google-Anzeige, teilweise Kleinanzeigen) gewinnt der erste *brauchbare* Mensch. Bei *gewählter* WhatsApp-Nummer (Kunde hat die 0151 extra angetippt) ist Tempo wichtig, aber nicht identisch mit Callcenter-Speed-to-Lead.

### 5.3 Was für DACH lokal trägt

- Kleinanzeigen zeigt Antwortrate und Antwortzeit öffentlich. Langsame Gewerbliche werden unsichtbar schlechter. **A** (Mechanik).
- DHZ / ibi: WhatsApp kennt keine Geschäftszeiten; Kunden wollen schnelle Antwort *oder* die Gewissheit, dass das Anliegen da ist. Auto-Reply ist genau dafür gebaut. **B**.
- ImmoScout: Antwort verbessert die Bewertung. **B**.
- Ist-Zustand `reaktion.md`: Ziel 1 Stunde werktags (Mo–Fr 8–20), Sa 2 Stunden, So 4 Stunden; wenn unhaltbar, nicht versprechen. Das ist als *interne* Disziplin vernünftig und ehrlicher als "5 Minuten oder tot".

**Inferenz SLA, ohne erfundene Close-Rate:**

| Fenster | Was der Kunde liest | Was der Betrieb tun muss |
|---|---|---|
| 0–15 Min, Portal- oder Ads-Lead | "Die sind da" | Menschliche Erstzeile oder ehrliche Auto-Zeile + echte Quali |
| Erste Stunde, Werktag | Normaler Handwerksstandard 2026 | Ziel halten oder in der Anzeige nicht versprechen |
| Gelesen (blau) + >30–60 Min nichts | Ignoriert | Zwischenstand, auch eine Zeile |
| Nacht 22–7, Sonntag | Nicht "unprofessionell langsam", solange Montag früh etwas kommt | Auto: empfangen, wann echte Antwort, Notfall-Nummer nur wenn man rangeht |
| >24 h ohne Wort | Tod bei Vergleichs-Leads; bei ruhiger Mail noch rettbar | Nachfassen einmal, dann Tempo des Kunden |

Sonntag: Umzugstermine sind oft Wochenende, Anfragen auch. Wer So komplett tot ist, verliert die Samstags-Googler. Wer So um 11 Uhr eine volle Kalkulation schreibt, setzt eine Erwartung für jeden Sonntag. **Inferenz:** So Empfang bestätigen, Preis wenn Kapazität da ist, nicht als 24/7-Service verkaufen.

---

## 6. Medien: Fotos, Pins, Voice, PDF

### 6.1 Fotos vom Kunden

Verbraucherzentrale und AMÖ: seriöse Kalkulation braucht Kenntnis von Volumen, Lage, Zugang. Klassisch Vor-Ort. Marktstandard 2025/26 vieler Festpreis-Anbieter: Möbelliste, Fotos/Video oder Besichtigung. **B** + Branchenpraxis **C**.

Kottke-Modell: Festpreis-Spanne in der Anzeige, verbindlich nach 5–10 WhatsApp-Fotos. Das ist operativ plausibel. Es ist kein Naturgesetz.

**Inferenz, wie viele und wann:**

- Zu früh ("schicken Sie erst 10 Fotos, dann sage ich ob wir Zeit haben"): hohe Reibung, wirkt wie Arbeit ohne Gegenleistung.
- Zu spät (Preis ohne Fotos, später Nachschlag): genau die Abzocke, vor der VZ warnt.
- Besser: 1. Turn Kapazität + grobe Spanne oder "geht grundsätzlich". 2. Turn 5–8 Fotos mit Auftrag (Wohnung leer/voll, großes Möbel, Zugang/Treppe, Sonderdinge). 3. Fehlt etwas, gezielt nachfordern (Keller, Dachboden, Klavier), nicht "noch mal alles".
- Mehr als ca. 12 Fotos in der ersten Bitte: Drop-off, besonders Studenten. **Inferenz**.
- Video-Rundgang: effizient, aber nur anbieten, nicht verlangen. Senioren und viele Familien fotografieren lieber.

Rechtlich/Trust: Fotos der Wohnung sind intim. Nicht in die Story, nicht an Dritte, nicht in die interne Gruppe mit Witz über "Messie". Das ist Service-Recovery- und DSGVO-Nachbar, hier als Kanalregel: WhatsApp-Medien sind nicht Marketingmaterial.

### 6.2 Standort-Pins

WhatsApp-Live-Location und Pins sind im Betrieb Alltag (Anfahrt, enge Gasse, Hinterhof). Studien zur Conversion: keine gefunden.

**Inferenz:** Pin *erbitten*, wenn Adresse unklar oder Zufahrt kritisch. Nicht als ersten Quali-Schritt ("teilen Sie Ihren Standort"). Das wirkt nach Tracking. Besser: "Können Sie uns die Einfahrt als Standort-Pin oder Foto vom Schild schicken?" nach dem Termin-Ja.

### 6.3 Voice Notes vom Betrieb

YouGov 2023: Text bleibt Default in Europa. Deutsche beim Empfangen etwas offener als Briten/Dänen, aber nicht Indien/UAE. **B**.

C-Textur (Reddit, LinkedIn, Bank-Berater-Beschwerden): ungefragte Voice Notes gelten als rücksichtslos (Kopfhörer, Open Office, kein Transkript, 3 Minuten "also ähm"). **C**.

| Situation | Voice vom Betrieb | Urteil |
|---|---|---|
| Erstkontakt, Quali, Preis | nein | cringe / Last |
| Kunde hat selbst Voice geschickt | kurze Voice *oder* Text-Spiegel der Punkte | professionell, wenn Inhalt strukturiert |
| Zufahrt, Treppenhaus, "wir stehen vor der Tür" | 15–25 Sekunden ok | funktional |
| Senior, der nicht tippt, aber WhatsApp hat | erst Anruf anbieten, Voice nur wenn er so macht | Anruf > Voice |
| Lärm auf der Ladefläche, Wind, Radio | nie | unprofessionell |

**Skill-Folge:** Default Text. Voice nicht erzeugen, außer der User-Kontext sagt "Kunde spricht schon per Voice" oder "Zugang erklären, 20 Sekunden". Nie Preis nur in einer Voice (nicht weiterleitbar, nicht belegbar).

### 6.4 PDF-Angebot per WhatsApp

Technisch Alltag, rechtlich sinnvoll als Textform-Artefakt (Details Recht-Datei). Verbraucherzentrale will Schriftlichkeit der Leistungen. **B**.

**Inferenz Register:** PDF darf nicht wie eine Behörde aussehen, wenn der Chat bisher acht Wörter hatte. Eine WhatsApp-Zeile mit den drei Zahlen (Preis, Datum, was drin ist) plus PDF "zum Weiterleiten an Ihren Partner / zur Unterlage". Acht Seiten AGB im Erst-PDF ohne die Zahl auf dem Lockscreen: Kill-shot.

Firmenkunden: PDF per Mail *zusätzlich*, weil Weiterleiten in Freigabe-Ketten über WhatsApp bricht.

---

## 7. Kanalwechsel als Sprechakt

Kommunikationstheorie (Communication Accommodation): Menschen belohnen, wer ihrem Medium und Tempo entgegenkommt. Das ist allgemeine Pragmatik, hier **Inferenz** auf Service-Chat, nicht Dating-Übertrag.

### 7.1 "Können wir auf WhatsApp wechseln?"

Vom Betrieb:

- Kostet Trust, wenn der Chat noch null Substanz hat (siehe Betrugsskript Kleinanzeigen).
- Trägt, wenn der Nutzen konkret ist (Fotos, Standort, schnellere Absprache am Umzugstag) und der alte Kanal offen bleibt.
- Formulierung als Bitte plus Grund, nicht als Befehl. Nummer in einem Stück, nicht "ich schreib Ihnen, wie heißen Sie bei WhatsApp".

Vom Kunden:

- Sofort folgen. Das ist Opt-in. Nicht noch einmal Mail *und* Anruf *und* SMS legen.

### 7.2 Telefon anbieten vs. anrufen

Anbieten ("Wenn es Ihnen lieber ist, rufen wir Sie um 17 Uhr an, geht das?") ist Service. Anrufen, weil der Kunde eine Chat-Frage gestellt hat, ist ein Kanalbruch.

Warum der Bruch weh tut:

- WhatsApp ist niedrig-invasiv (Bitkom/YouGov: man stört weniger als mit Anruf). Der Kunde hat *absichtlich* nicht angerufen.
- Unangekündigter Anruf nach Chat = der Betrieb nimmt sich das Recht auf die Zeit des Kunden. Besonders hart bei Berufstätigen, Lehrern, im Open Space.
- Senioren und Hochunsichere *wollen* oft den Anruf. Dann steht im Text oft "können Sie mich anrufen?" oder eine Festnetznummer ohne Chat-Verlauf.

**Regel:** Anrufen nur nach Einladung oder nach einem bestätigten Zeitfenster. Ausnahme: vereinbarter Umzugstag, Zugang klappt nicht, letzte Meile.

### 7.3 Mail nach WhatsApp

Sinnvoll als Kopie des Angebots, Rechnung, Halteverbot-Bescheid. Nicht als "wir haben Ihnen eine Mail geschickt" ohne den Inhalt im Chat. Viele öffnen geschäftliche Mail selten; Bitkom zeigt Volumen, nicht Aufmerksamkeit.

---

## 8. Gruppen, Weiterleitungen, Screenshots

Keine DACH-Studie zum Umzugs-Gruppenchat. Die Regel folgt aus Publikum und Datenschutz, Stufe **C/Inferenz**, plus DSGVO-Logik **A** (Zweckbindung, keine Extra-Empfänger ohne Grund).

Typische Gruppen: Kunde + Partner, Kunde + erwachsene Kinder, Kunde + Vermieter/Hausmeister, Kunde + Facility (Firma).

**Schreiben, als sähe der strengste Mitleser mit.**

- Kein Du in der Gruppe, wenn einer siezt.
- Keine internen Spitznamen, kein "die alte Wohnung ist eine Zumutung".
- Preisänderungen begründet, weil der Partner den ersten Preis als Screenshot hat.
- Fotos der Wohnung nicht mit Witz kommentieren.
- Vermieter in der Gruppe: keine Aussagen über Schäden, die wie Schuldeingeständnis klingen, bevor der Auftrag das hergibt.

Weiterleiten:

- Kunden-Chat nicht an Subunternehmer weiterleiten, wenn dort Private auftauchen. Zusammenfassung + nötige Fotos.
- Screenshots von Verhandlungen an Dritte (andere Kunden, Facebook-Gruppen) sind Trust- und oft Rechtsbruch.
- Der Kunde leitet *euren* Chat weiter. Deshalb keine Sätze, die nur im 1:1 funktionieren ("unter uns, bar ginge günstiger").

---

## 9. Check24- und Vergleichston

Implikationen, zusammengezogen aus Portal-Design (**B**) und Handwerker-Verbatims (**C**):

1. Der Kunde hat den Job "günstig genug und nicht unseriös", nicht den Job "Familienbetrieb kennenlernen".
2. Mehrere Angebote parallel: eure Nachricht wird neben einer Zahl gelesen. Lange Texte werden nicht gelesen.
3. Anonymität: "Sie" bleibt, bis der Kunde den Namen und Du anbietet.
4. Festpreis-Klarheit schlägt Charm. Was *nicht* drin ist, muss in derselben Nachricht stehen wie die Zahl (Halteverbot, Etage ohne Aufzug, Keller, Entsorgung).
5. Nachverhandeln ist eingeplant. Eine begründete Untergrenze ist besser als "wir sind eben Qualität".
6. Bewertungen auf dem Portal sind Teil des Produktes. Nach dem Auftrag um Bewertung bitten (Portal-Logik), nicht im Erstchat.

AMÖ-Konflikt ernst nehmen: Billigster Klick vs. seriöse Kalkulation. Der Skill darf auf Check24 nicht so tun, als gäbe es keinen Preisdruck, und nicht so tun, als müsse man unter Kosten gehen.

---

## 10. Kanal-Matrix

Erwartetes Register, Länge, Geschwindigkeit, Job, Fail. Länge in Wörtern der *typischen Betrieb-Antwort*, nicht der Anzeige.

| Kanal | Erwartetes Register | Typische Länge | Geschwindigkeit | Typischer Job | Typischer Fail |
|---|---|---|---|---|---|
| Kleinanzeigen-Chat | Knapp, Sie bis gespiegelt, kein Briefkopf, keine Floskelwüste | 1–6 Sätze, oder 5 Bullet-Fragen max. | Sichtbar schnell (Profil-Indikator); erste brauchbare Antwort < 1–2 h wertvoll | Filtern: passt Strecke/Termin, grobe Spanne, Fotos anbahnen | Nummer in Satz 1; "Liebe Interessenten"; 400-Wort-Mail; Du ohne Signal |
| WhatsApp 1:1 (Kunde schrieb selbst) | Mündlich-schriftlich, Sie/Du wie Kunde, 0–1 Emoji nur wenn Kunde | 1–4 Blasen à 1–3 Sätze; Angebot: Zahl + 4–6 Leistungszeilen | Minuten bis eine Werktagsstunde; nach *blau* Zwischenstand | Quali, Fotos, Festpreis, Termin, Status am Tag | Behördendeutsch; ungefragte Voice; Anruf ohne Ansage; AGB-Wand |
| WhatsApp nach Google-Button | Wie 1:1, noch etwas förmlicher, Bewertungsbewusst | Kurz, erste Blase = ja wir machen das / wann | Sehr schnell, Suchmodus | Erst: Verfügbarkeit und grobe Größe, dann Fotos | Auto-Menü ohne Mensch; Öffnungszeiten-Lüge |
| WhatsApp-Gruppe | Das förmlichste Register der Teilnehmer; keine Insider | Klar, datiert, preisstabile Sätze | Wie 1:1, aber nichts "unter uns" | Koordination Partner/Vermieter | Witz über Wohnung; Du/Sie-Mix; Preis nur mündlich |
| Check24 / Vergleichsportal | Sachlich, Sie, preisgeführt, leistungsklar | Zahl + Leistung + 2 Rückfragen | Erster sinnvoller Mensch gewinnt; Ziel < 1 h, besser < 15 Min | Festpreis gegen parallele Angebote halten | Biografie zuerst; Stundenpreis ohne Deckel; Beziehungstext |
| Immoscout / Formularportal | Schriftlich, Sie, Bezug zur Anfrage | Kurzer Brief, 80–180 Wörter, oder strukturierte Punkte | Antwort zählt für Bewertung; gleiche Session ideal | Quali + Terminlogik, dann Wechsel WhatsApp für Fotos | Chat-Slang; Sammel-Absage-Ton; kein Name |
| E-Mail | Sie, vollständiger Satz, Signatur, weiterleitbar | 120–250 Wörter oder PDF plus 5-Zeilen-Mail | Gleicher Werktag; 24 h noch akzeptabel | Artefakt: Angebot, Rechnung, Bestätigung | WhatsApp-Fetzen ohne Anrede; 5 Nachfass-Mails in 2 Tagen |
| Telefon (angekündigt oder vom Kunden gewollt) | Stimme, langsam bei Senioren, Punkte hinterher schriftlich | Gespräch; danach 3–6 Zeilen Protokoll auf WhatsApp/Mail | Rückruf im versprochenen Fenster | Unsicherheit, Umfang, Vertrauen, Senior | Nach Chat-Frage einfach anrufen; nichts Schriftliches danach |
| SMS | Nur Notnagel | Ein Satz + Rückkanal | Sofort | "WhatsApp kommt nicht durch", Zufahrt | Marketing-SMS, lange Links |

---

## Regler vs. Invarianten

**Regler** (ändert sich mit Kanal, Segment, Stadium)

- Anrede Sie/Du
- Länge und Satzbau
- Emoji, Voice, Foto-Menge
- Wie schnell der volle Preis steht
- Ob Telefon angeboten wird
- Ob PDF/Mail zusätzlich nötig ist (Partner, Firma, Steuer)
- Wie hart der Preisdruck ist (Check24 vs. direkte WA-Wahl)

**Invarianten** (kanalübergreifend)

- Den vom Kunden eröffneten Kanal nicht ohne Nutzen und Einladung verlassen.
- Keine Kontaktdaten abpressen, bevor Substanz da ist. Besonders Kleinanzeigen.
- Nach Lesen (blau / "online") nicht stumm bleiben, wenn eine Frage im Raum steht.
- Verbindlicher Preis erst, wenn die Daten (Fotos/Zugang) das hergeben. Sonst Spanne plus nächster Schritt.
- Schriftliches Artefakt für das, was später Streit wird (Preis, Leistung, Datum).
- Gruppe und Weiterleitung: schreiben, als läse der Partner und später das Gericht mit.
- Kein Kumpel-Theater, kein Behördendeutsch. Sachlich-warm, wie die bestehende Anzeigen-Tonlage.
- Nacht und Sonntag: Empfang ≠ Vollservice. Lügen über 24/7 zerstören den nächsten Werktag.

---

## Diagnose-Signale (was der Agent im Kunden-Text lesen muss)

Bevor eine Zeile entsteht, Kanal *und* diese Marker:

1. **Kanal-ID:** Kleinanzeigen-Thread, WhatsApp-1:1, Gruppe, Check24-Mail/App, Immoscout, Google-WA, reine Mail, Rückrufbitte.
2. **Wer hat den Kanal gewählt?** Kunde tippte 0151 / Maps-Button vs. Portal hat Lead gespuckt.
3. **Anrede und Länge der Kundenzeile:** 3 Wörter ohne Hallo = Kanal-Default, nicht unbedingt Du.
4. **Initiiert der Kunde Wechsel?** "WhatsApp?", Nummer, "können Sie anrufen?", Mail-Signatur.
5. **Vergleichsspuren:** "Ich habe schon 3 Angebote", Check24-Vorgangsnummer, "bei Ihnen war es teurer".
6. **Medien:** Foto schon da, Voice, Pin, PDF-Nachfrage, "mein Mann soll das auch sehen".
7. **Zeitstempel:** 23:40, Sonntag, und ob *wir* schon blau gesetzt haben.
8. **Mitleser:** "wir", "meine Frau", "der Vermieter", Gruppenheader.
9. **Betrugsangst:** "Warum WhatsApp?", "bleiben wir hier im Chat", "keine Anzahlung über Link".
10. **Job der nächsten Nachricht:** nur Verfügbarkeit, Fotos holen, Zahl nennen, ablehnen, Schaden, Nachfassen.

---

## Skill-Folgen (If-then, keine Line-Bibliothek)

- **Wenn Kleinanzeigen und Erstkontakt:** im Chat bleiben. Kapazität + eine sachliche Rückfrage oder 3–5 konkrete Infopunkte. WhatsApp erst nach Nutzen oder wenn der Kunde wechselt.
- **Wenn der Kunde unaufgefordert die Nummer schickt:** auf WhatsApp spiegeln, Kleinanzeigen kurz schließen ("schreibe Ihnen dort").
- **Wenn Check24/Vergleich:** erste Nachricht leistungsklare Zahl oder klarer Grund, warum die Zahl noch Fotos braucht. Keine Firmengeschichte vor der Zahl.
- **Wenn Immoscout/Formular:** Namen nutzen, Anfrage referenzieren, Sie-Register, eine nächste Handlung.
- **Wenn Google-Maps-WhatsApp:** erste Blase beantwortet die sichtbare Frage (frei ja/nein, grobe Größe). Dann Quali.
- **Wenn WhatsApp und Kunde siezt / duzt:** matchen. Kanal ändert das nicht.
- **Wenn WhatsApp und Kunde schreibt 8 Wörter:** nicht mit 180 Wörtern antworten. Zahl oder nächster Schritt, Rest als Bullet.
- **Wenn blaue Haken und offene Frage:** Zwischenstand vor neuer Quali-Liste.
- **Wenn nach 22 Uhr oder Sonntag und keine Notfall-Kapazität:** Empfang + Zeitpunkt der echten Antwort. Keinen Festpreis versprechen, den montags niemand hält.
- **Wenn Kunde Voice schickt:** Inhalt in Textpunkten wiederholen (auch fürs Protokoll), optional kurze Voice zurück.
- **Wenn Betrieb Voice will:** nur Zugang/Status, unter 30 Sekunden, Preis nie nur audio.
- **Wenn Fotos nötig:** erst sagen, *warum* (Festpreis ohne Nachschlag), dann 5–8 gezielte Motive, nicht "schicken Sie alles".
- **Wenn Partner/Gruppe sichtbar:** förmlichstes Register, stabile Preise, keine Nebenabsprachen.
- **Wenn Kunde nur Chat-Frage gestellt hat:** nicht anrufen. Telefon anbieten mit Fenster.
- **Wenn Kunde um Anruf bittet oder Senior-Unsicherheit + Nummer:** Fenster vorschlagen, nach dem Gespräch 5 Zeilen schriftlich.
- **Wenn Angebot steht:** Chat-Kurzfassung + weiterleitbares PDF/Mail. Firma: Mail führen.
- **Wenn Ablehnung:** im selben Kanal, kurz, ohne Moral, ohne Nachfass-Schleife.

---

## Anti-Patterns / Kill-shots

Professionell klingend, kanalverlierend:

1. **400-Wort-Mail-Ton auf WhatsApp.** Anrede, drei Absätze Versicherung, Signaturblock, Disclaimer. Der Kunde wollte eine Zahl oder einen Termin.
2. **"Liebe Interessenten" / "Sehr geehrte Damen und Herren" im 1:1.** Portal-Sammelbaustein im privaten Chat. Macht aus einem Menschen eine Warteschlange.
3. **Anruf ohne Vorwarnung nach einer Chat-Frage.** Kanalbruch. Wirkt bedrängend, oft nicht angenommen, dann zweite Demütigung über Mailbox.
4. **Handynummer als erste Kleinanzeigen-Antwort.** Das Betrugsskript der Plattform und der Polizei.
5. **Gelesen (blau), dann Stille.** Schlimmer als ungelesen. Besonders nach "was kostet das?"
6. **Unaufgeforderte Betriebs-Voice** mit Straßenlärm und "Ja hallo hier ist der Chef". In DE eher peinlich als nah.
7. **Preis nur in Voice oder nur mündlich am Telefon**, nichts Schriftliches. Partner kann es nicht prüfen; Streit vorprogrammiert.
8. **Check24 mit Beziehungsroman.** Während der andere 1.890 EUR brutto inkl. Halteverbot schreibt.
9. **Stundenpreis ohne Deckel auf einem Vergleichsportal.** Liest sich wie die Falle, vor der VZ warnt.
10. **Foto-Dump verlangen, bevor irgendetwas zurückkommt.** Arbeit ohne Gegengabe.
11. **Gruppe wie interner Teamchat.** Witz über Keller, "Messie", Du an die Tochter und Sie an die Mutter.
12. **Drei Kanäle gleichzeitig aufmachen.** WhatsApp *und* Mail *und* Anruf nach einer Zeile. Wirkt nach Jagd.
13. **Auto-Reply, der wie ein Mensch lügt.** "Wir schreiben in 5 Minuten", dann 6 Stunden. Ein ehrliches Zeitfenster hält.
14. **Online-Status nachts ohne Hinweis.** Bereitschaft simulieren, die niemand bedient.
15. **Ist-Zustand-Risiko:** das Erst-Template in `reaktion.md` ist eine nummerierte 6-Punkte-Liste im Briefstil. Auf Kleinanzeigen und WhatsApp ist das oft zu viel für den ersten Turn. Inhaltlich richtig (Quali), kanalisch schwer. Besser staffeln: erst 2–3 Blocker (Ort, Termin, Größe), dann Fotos.

---

## Offene Lücken (kein Gesetz daraus machen)

- Keine unabhängige DE-Messung: Umzug × Kleinanzeigen vs. WhatsApp vs. Check24 × Minuten bis Antwort × Close-Rate. Die 62-Prozent- und 78-Prozent-Zahlen sind US-Vendor. Nicht in den Skill als Fakt.
- "98 Prozent WhatsApp-Open-Rate" ist Marketing-Folklore (oft Meta/Agenturen, Methode unklar, häufig mit SMS verwechselt). Stufe **E** als Gesetz, **D** als "Nachrichten werden eher gesehen als Mail".
- Keine Quote, wie oft Kleinanzeigen-Kunden den Wechsel auf WhatsApp selbst wollen.
- Keine belastbare DE-Zahl zu Voice Notes *im Handwerk*. YouGov ist Ländervergleich, nicht Gewerk.
- Business vs. privat: Kundenerwartung an den grünen Business-Punkt ist plausibel, nicht gemessen.
- Blaue-Haken-Stress: Alltagspsychologie, keine Service-RCT.
- Google-WhatsApp-Button: Nutzung in DE lokal nicht quantifiziert.
- Immoscout-Umzugsleads: Volumen und Qualität für einen Stuttgarter Kleinbetrieb unbekannt.
- Check24-Leadpreis und Close für Umzug Stuttgart: nur C-Anekdoten, stark schwankend.
- Gruppenchats und Screenshot-Praxis: keine Studie, nur Pragmatik.
- Ob 5–10 Fotos das Conversion-Optimum sind: Betriebsmodell, kein Experiment.
- Sonntags-SLA: Norm vs. Erwartung nicht erhoben. Nicht "Kunden erwarten 24/7" als A verkaufen.
- AMÖ gegen Kleinanzeigen: Interessenkonflikt. Seriosität entsteht im Chat, nicht durch Verbandsmitgliedschaft allein.

---

## Quellen

### A / hohe DACH-Primärquellen

- Destatis nach Eurostat (1. Quartal 2025, Auszug 27.01.2026): [Nutzung von Messengerdiensten in Europa 2025](https://www.destatis.de/Europa/DE/Thema/Wissenschaft-Technologie-digitaleGesellschaft/Digitale_Kommunikation.html)
- Statista Consumer Insights, Infografik 06.05.2025: [WhatsApp ist der Top-Messenger der Deutschen](https://de.statista.com/infografik/34411/anteil-der-befragten-die-diese-messenger-kennen-und-nutzen/)
- Bitkom Research, 11.12.2025, n = 1.002 / 928 Onliner, KW 41–46 2025: [Private Mailpostfächer werden voller](https://www.bitkom.org/Presse/Presseinformation/Private-Mailpostfaecher-werden-voller)
- Bitkom, 02.05.2018 (älter, Funktionen/Verbreitung): [Neun von zehn Internetnutzern verwenden Messenger](https://www.bitkom.org/Presse/Presseinformation/Neun-von-zehn-Internetnutzern-verwenden-Messenger.html)
- Bitkom, 08.08.2018: [Jeder zweite Messenger-Nutzer telefoniert per App](https://www.bitkom.org/Presse/Presseinformation/Jeder-zweite-Messenger-Nutzer-telefoniert-per-App.html)
- mpfs / LFK, SIM-Studie 2024, n = 2.000 ab 60, Mai–Aug. 2024: [SIM-Studie 2024](https://www.lfk.de/forschung/mediennutzungsstudien/sim-studie-2024) und [PDF](https://www.lfk.de/fileadmin/PDFs/Publikationen/Studien/SIM-Studie/sim-studie-2024.pdf)
- ARD/ZDF-Onlinestudie 2021 (WhatsApp täglich ca. 70 Prozent; älter, aber Methode stark), Einstieg: [ARD/ZDF-Medienstudie](https://www.ard-zdf-medienstudie.de/)
- Kleinanzeigen Nutzungsbedingungen ab 17.02.2024: [Allgemeine Nutzungsbedingungen](https://themen.kleinanzeigen.de/nutzungsbedingungen/)
- Kleinanzeigen Grundsätze: [Policy](https://themen.kleinanzeigen.de/policy/)
- Kleinanzeigen Sicherheitstipps (SHS, Chat-Phishing, persönliche Daten): [Sicherheitshinweise](https://themen.kleinanzeigen.de/sicherheitshinweise/)
- Kleinanzeigen-Hilfe: [Wieso kann ich meine Telefonnummer nicht mehr angeben?](https://hilfe.kleinanzeigen.de/hc/de/articles/17084840600348-Wieso-kann-ich-meine-Telefonnummer-nicht-mehr-angeben)
- Kleinanzeigen-Hilfe: [Kontaktdaten ändern / was veröffentlicht wird](https://hilfe.kleinanzeigen.de/hc/de/articles/17125807841180-Wie-kann-ich-meine-Kontaktdaten-wie-Telefonnummer-Name-oder-Anschrift-%C3%A4ndern)
- WhatsApp Help: [About last seen and online](https://faq.whatsapp.com/419827870318306)
- WhatsApp Help: [WhatsApp-Link im Google Business Profile](https://faq.whatsapp.com/712818078160617)
- Google Developers: [Update on Google Business Messages](https://developers.google.com/business-communications/business-messages/resources/release-notes/update-on-gbm) (Ende 31.07.2024)
- Google Support: [Chat with customers from your Business Profile](https://support.google.com/business/answer/15013580?hl=en)
- Verbraucherzentrale, 11.06.2025: [Umzugsunternehmen: So fallen Sie nicht auf Umzugs-Abzocker rein](https://www.verbraucherzentrale.de/wissen/vertraege-reklamation/kundenrechte/umzugsunternehmen-so-fallen-sie-nicht-auf-umzugsabzocker-rein-10470)

### B / Verbände, Plattform, belastbarer Journalismus, starke Umfragen

- AMÖ: [Worauf beim Umzug achten](https://amoe.de/worauf-beim-umzug-achten/) (u. a. Kleinanzeigen als Warnsignal, drei Angebote, Kostenfallen)
- Deutsche Handwerks Zeitung, 04.04.2024: [WhatsApp Business: Die bessere Alternative für Betriebe?](https://www.deutsche-handwerks-zeitung.de/whatsapp-business-unterschied-336149/)
- YouGov, 09.02.2024 (Erhebung Nov. 2023, 17 Märkte): [Do consumers prefer sending and receiving messages in audio or text form?](https://yougov.com/articles/48604-do-consumers-prefer-sending-and-receiving-messages-in-audio-or-text-form)
- YouGov UK, 2022/2026 zu Voice Notes (Übertrag begrenzt): [How many Britons like voice notes?](https://yougov.com/en-gb/articles/42817-how-many-britons-voice-notes)
- Oldroyd, McElheran, Elkington, HBR März 2011: [The Short Life of Online Sales Leads](https://hbr.org/2011/03/the-short-life-of-online-sales-leads)
- InsideSales / Oldroyd 2007, zitiert im Lead-Response-Report 2014: [PDF-Spiegel](https://resources.insidesales.com/wp-content/uploads/2019/11/2014-Lead-Response-Report.pdf)
- Check24 Umzug / Profis (Produktlogik, Vergleich, Testimonials): [CHECK24 Umzugsunternehmen](https://umzug.check24.de/umzug/umzugsunternehmen), [CHECK24 Profis](https://consumer.profis.check24.de/portal/cs/willkommen), [Als Profi Kundenanfragen](https://experts.profis.check24.de/portal/cs/unternehmen)
- ImmoScout Nachrichten-Manager / KontaktPlus: [Nachrichten-Manager](https://www.immobilienscout24.de/anbieten/gewerbliche-anbieter/tipps/anwender-handbuch/nachrichtenmanager.html), [KontaktPlus](https://www.immobilienscout24.de/anbieten/gewerbliche-anbieter/tipps/anwender-handbuch/kontaktplus.html)
- Kleinanzeigen-Hilfe bei Nicht-Antwort (2–3 Tage Nachfassen für Nutzer): [Keine Antwort vom Anbieter](https://hilfe.kleinanzeigen.de/hc/de/articles/17144978833180-Keine-Antwort-vom-Anbieter-oder-Interessenten-M%C3%B6gliche-Gr%C3%BCnde-und-L%C3%B6sungen)
- SWR, 12.04.2022: [Polizei warnt vor Betrugsmasche bei eBay Kleinanzeigen](https://www.swr.de/leben/verbraucher/polizei-warnt-vor-betrugsmasche-bei-ebay-kleinanzeigen-100.html)
- Lime Technologies / Userlike, 23.01.2025 (Aggregation ARD/ZDF, Bitkom, YouGov, Tyntec, Capterra): [WhatsApp-Nutzerzahlen Deutschland](https://connect.lime-technologies.com/de/blog/whatsapp-nutzerzahlen/)

### C / wiederholte Praxis, Textur

- Malermeister Heinrich, 08.04.2025: [Warum wir Check24 Profi als Handwerker nicht mehr nutzen](https://www.malermeister-heinrich.berlin/post/check24-erfahrung-und-ei-appell-an-handwerker-und-kunden)
- CHIP zu Kleinanzeigen-Profilindikatoren (Antwortrate, Antwortzeit): [Nutzer bewerten](https://www.chip.de/ratgeber/wifi-dsl-internet/nutzer-bewerten-ebay-kleinanzeigen-so-finden-sie-die-funktion_14a4538c-a14f-47b6-9db1-5f2eac31f20c.html)
- Lautschrift / Uni-Alltag Kleinanzeigen-Chat ohne Hallo (2020): [Wohnsinn: Ebay Kleinanzeigen](https://www.lautschrift.org/2020/12/04/wohnsinn-ebay-kleinanzeigen-wartest-du-noch-oder-verkaufst-du-schon/)
- Reddit/Foren zu Voice Notes im professionellen Kontext und zu Kleinanzeigen-Nummer-Fragen (wiederholtes Muster, keine Quote).

### D / Vendor, USA, Aggregation ohne Primärmethode

- Superchat, 16.02.2026: [WhatsApp Statistik 2026](https://www.superchat.de/blog/whatsapp-statistiken)
- PipelineOn, 27.07.2026 (US Home Service, ServiceTitan/Hatch/HomeAdvisor aggregiert): [Lead Response Time Home Service](https://pipelineon.com/blog/lead-response-time-home-service/)
- ServiceTitan 2025 Home Services Benchmark Report (in obiger Aggregation zitiert)
- Handwerk-digitalisieren / HelloMateo u. a. (oft HubSpot-10-Minuten- oder 85-Prozent-Messenger-Wunsch ohne nachvollziehbare DE-Methode)

### E / Folklore, nicht als Skill-Gesetz

- "WhatsApp Open Rate 98 Prozent" (Meta-Marketing, Agenturblogs, oft ohne Methodenpapier). Beispielhafte Verbreitung: [WhatsApp Business Blog 2023](https://whatsappbusiness.com/blog/use-whatsapp-business-goals/). Nicht als DACH-Local-Service-Conversion verwenden.
- "Antwort in 5 Minuten oder der Lead ist tot" als universelle Umzugsregel. Herkunft: US-B2B-Telefon 2007.
- "Kunden lieben Voice Notes vom Handwerker."
- "Senioren nutzen kein WhatsApp." (durch SIM 2024 widerlegt als Pauschale)

### Ist-Zustand intern (prüfen, nicht als Wahrheit)

- `~/.claude/skills/kleinanzeigen-umzuege/strategie/reaktion.md` (SLA 1 h / 2 h / 4 h; Erst-Template als 6-Punkte-Brief)
- `~/.claude/skills/kleinanzeigen-umzuege/strategie/plattformregeln.md`
- `~/.claude/skills/kleinanzeigen-umzuege/templates/segmente.md` (Senior = Telefon, Student = Chat/Du)
