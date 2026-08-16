# Kunden-Texting (Kottke Umzüge)

Recherche für einen späteren Diagnose-Skill. Stand: 2026-08-15.

**Methode:** wie [`../f-texting/`](../f-texting/) (Evidenzstufen, Diagnose vor Entwurf, Register-Leiter, harte Schienen). **Kontext:** lokaler Service in DACH, nicht Dating.

Noch kein `SKILL.md`. Spec: [`RESEARCH-BRIEF.md`](RESEARCH-BRIEF.md).

---

## Kern in fünf Sätzen

Der Kunde führt die Anrede. Der Betrieb folgt, ohne Slang, Tippfehler oder Kumpel zu kopieren. Ungefragtes Du ist der teurere Fehler als ein zu warmes Sie.

Der Funnel stirbt selten am Preis. Er stirbt an der nächsten Frage, die zu früh, zu viele oder die falsche ist.

WhatsApp ist der Default-Kanal. Die bestehenden Brief-Templates (6-Punkte-Liste, "inkl. 19 % MwSt", "Transportversicherung") sind auf diesem Kanal zu lang und an drei Stellen sachlich falsch.

---

## Dateien

| Datei | Job | Härteste Linie |
|---|---|---|
| [research-register-ton.md](research-register-ton.md) | Sie/Du, Spiegeln, Register-Leiter | Kunde führt. Eine Stufe förmlicher ist erlaubt, eine lockerer nicht. Default ohne Signal: warmes Sie oder pronoun-frei. |
| [research-linguistik-chat.md](research-linguistik-chat.md) | Länge, Emoji, KI-Ton, Tempo, Punkt | Professionell heißt klar, kurz, konsistent, menschlich. 12 % nutzen Emoji gegenüber Dienstleistern. KI-Glätte ist ein Trust-Kill. |
| [research-kanaele.md](research-kanaele.md) | WhatsApp, Kleinanzeigen, Portale, Mail, Anruf | Kanal lockert Länge, nicht automatisch das Pronomen. Nummer zu früh ziehen kostet Trust. |
| [research-funnel.md](research-funnel.md) | Erstkontakt → Quali → Angebot → Close | Erste Bubble: eine Lücke, nicht die 6er-Liste. Chat-Angebot = eine Zahl, nie "ab". |
| [research-follow-up.md](research-follow-up.md) | Nachfassen, Ghosting, aufhören | Nach Angebot höchstens 2–3 Touches mit neuem Grund, dann Close. RAIN-8 gehört nicht auf WhatsApp. |
| [research-einwaende-trust.md](research-einwaende-trust.md) | Preis, Schwarz, Versicherung, Fotos | Preis ist oft das Wort für Risiko. Nicht knicken, nicht lügen. Haftung heißt 620 EUR/m³, nicht "vollversichert". |
| [research-service-recovery.md](research-service-recovery.md) | Verspätung, Schaden, Reklamation | Funkstille ist schlimmer als der Fehler. Ablaufverantwortung ja, Haftungszusage in Bubble 1 nein. |
| [research-recht-de.md](research-recht-de.md) | UWG, DSGVO, Widerruf, Preise | Antwort auf Kundenanfrage grün. Kalte Werbung auf gespeicherter Nummer rot. Recherche, keine Rechtsberatung. |
| [research-kuechenbau.md](research-kuechenbau.md) | Was sich ändert, wenn Küche kommt | Umzugs-SLA und Foto-Festpreis auf Küche übertragen klingt unseriös, nicht schnell. |
| [research-segmente.md](research-segmente.md) | Wer schreibt wie | Segment aus dem ersten Satz ableiten, nicht fragen. Ist-USPs an mehreren Stellen widerlegt. |

---

## Was der spätere Skill zuerst lesen muss

Im **ersten Kundensatz**, bevor eine Zeile Entwurf entsteht:

1. **Pronomen** — `du/dir/kannst` vs. `Sie/Ihnen` vs. keines
2. **Gruß** — Sehr geehrte / Guten Tag / Hallo / Hi / Hey / keiner
3. **Nähe-Morphologie** — Telegramm, "kannste", Kleinschreibung, Emoji-Zahl
4. **Rolle** — Firma, Hausverwaltung, WG, Senior, EN, "im Auftrag"
5. **Kanal** — Kleinanzeigen, WhatsApp, Mail, Portal
6. **Stadium** — roh / Quali / Angebot draußen / zugesagt / Job / danach / Streit
7. **Job der nächsten Bubble** — genau einer (gesehen, eine Frage, Preis, Close, Status, Entschuldigung)

Ohne 1–5: **Stufe 5, warmes Sie, oder Stufe 3 pronoun-frei.** Nie Peer-Du.

---

## Register-Leiter (Kurz)

Ausführlich in der Register-Datei. Der Betrieb hält die Kundenstufe oder geht **eine Stufe nach oben**.

| Stufe | Name | Typischer Kundensatz | Betrieb |
|---|---|---|---|
| 7 | Amts-Sie | "Sehr geehrte… hiermit bitte ich" | Nachname, MfG, keine Emoji |
| 6 | Förmliches Sie | "Guten Tag, könnten Sie…" | Guten Tag, Sie, Liste |
| 5 | Warmes Sie | "Hallo, wir bräuchten…" | **Default Privat 30–60** |
| 4 | Hamburger Sie | Vorname + Sie / WhatsApp ohne Pronomen | Hallo Vorname + Sie |
| 3 | Pronoun-frei | "2Zi 15.9. Preis?" | Inhalt ohne du/Sie |
| 2 | Warmes Du | "hi kannst du mir n preis sagen" | Hi Vorname, Du, kein Slang |
| 1 | Peer-Du | "hey kannste… 😂" | Kurz und klar, **kein** Slang-Echo |

---

## Ist-Templates, die die Recherche bricht

`~/.claude/skills/kleinanzeigen-umzuege/strategie/reaktion.md` ist als Tempo-Idee richtig und als Text falsch:

| Im Template | Recherche |
|---|---|
| 6-Punkte-Brief als Erstantwort | Eine fehlende Info, dann Gespräch. Interview-Stapel tötet. |
| "inkl. 19 % MwSt" | Kleinunternehmer §19. Falsch und abmahnrelevant. |
| "Transportversicherung" | Gesetzliche Mindesthaftung §451g HGB, 620 EUR/m³. |
| "Mit freundlichen Grüßen" jede WhatsApp | Ab Nachricht 3 Chat-Fluss, nicht Geschäftsbrief. |
| Festnetznummer im Text | Existiert nicht. Reine Mobilnummer nicht als Trust-Lüge kaschieren. |
| Studenten-Du automatisch | Nur wenn der *Satz* duzt. Anzeige-Du ist kein Vertrag. |
| 8 Nachfassen / "wir haben ein Fenster frei" auf alter Nummer | UWG-rot. |

---

## Bau-Stand

Spec: [`skill-build.md`](skill-build.md). RED ohne Skill: [`red/baseline/SUMMARY.md`](red/baseline/SUMMARY.md) (10/10 Fail).

Skill: [`SKILL.md`](SKILL.md) (`service-chat-diagnose`). GREEN: [`red/green/SUMMARY.md`](red/green/SUMMARY.md) 10/10.

Offen beim Menschen: 5 eigene Nachrichten als Stimme, echte anonymisierte Chats. Weiches Restloch: Steuerhinweis ohne Zahl in Schwarz-Absage.

Keine Em-Dashes in Entwürfen. Keine erfundenen Conversion-Prozente.
