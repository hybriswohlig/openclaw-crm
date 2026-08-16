# Research-Brief: Kunden-Texting für lokale Service-Firmen (DACH)

Stand: 2026-08-15. Das ist die **gemeinsame Spec** für die Parallel-Recherche. Noch kein Skill. Kein `SKILL.md` schreiben.

**Vorbild:** `/Users/dariushk/Documents/claude-skills/f-texting/` (Diagnose vor Entwurf, Evidenzstufen, Register-Leiter, harte Schienen). Anderer Kontext: **B2C/B2B Service-Verkauf**, nicht Dating.

**Zielprodukt später:** ein Diagnose-Instrument, das gelegentlich einen WhatsApp-/Kleinanzeigen-/E-Mail-Entwurf schreibt. Kein Template-Generator. Der Agent muss zuerst Ton, Segment, Stadium und Kanal lesen, dann maximal 1–2 Varianten in der *passenden* Stimme liefern.

---

## Firma (Kontext, nicht als Marketing-Fakten erfinden)

- **Name:** Kottke Umzüge (Kottke & Ceylan). Inhabergeführt, Einzelunternehmen, Kleinunternehmer §19 UStG.
- **Heute:** Privatumzug, Firmenumzug, Entrümpelung, Möbelmontage, Einlagerung, Kartons, Halteverbot. Region Metropolregion Stuttgart (Stuttgart, Tübingen, Pforzheim, Herrenberg, ca. 60 km).
- **Modell:** Festpreis-Spannen in der Anzeige, verbindlicher Preis nach 5–10 WhatsApp-Fotos. Haftung gesetzliche Mindesthaftung §451g HGB (620 EUR/m³), keine Extra-Transportversicherung kommunizieren.
- **Team:** 5 Personen, max 3 pro Auftrag. Sprachen DE + EN. WhatsApp `0151-59058963`, Mail `kontakt@kottke-umzuege.de`.
- **Kanäle Lead:** Kleinanzeigen (wichtig), Immoscout, Check24, Google/SEO, WhatsApp als Haupt-Chat.
- **Bald:** Erweiterung Richtung Küchenbau / Innenausbau / Handwerk. Recherche soll **erweiterbar** sein, nicht nur Umzug.
- **Bestehende Anzeigen-Tonalität:** Sie-Form Standard, Du nur Studentensegment. Keine Em-Dashes. Sachlich-warm.
- **Bestehende Antwort-Templates:** `~/.claude/skills/kleinanzeigen-umzuege/strategie/reaktion.md` und `templates/segmente.md`. Nicht als Wahrheit behandeln, sondern als Ist-Zustand, den die Recherche prüfen oder widerlegen darf.

Dario schreibt oft selbst mit Kunden (Akquise + Conversion). Nuri macht Operations.

---

## Was gebaut werden soll (später)

Ein Skill, der:

1. den **letzten Turn** des Kunden diagnostiziert (Ton, Anrede, Stadium, Job der nächsten Nachricht),
2. den **Ton des Kunden matched** (Sie/Du, Länge, Emoji, Tempo, Kanal),
3. **professionell** bleibt (kein Kumpel-Theater, kein Behördendeutsch),
4. den Sales-Job erledigt (qualifizieren, Angebot, Nachfassen, ablehnen, Schaden klären),
5. rechtlich in DE nicht ins offene Messer läuft (UWG, DSGVO, Widerruf, Preisangaben, WhatsApp).

Diese Recherche liefert die Evidenz. Sie schreibt noch keine Skill-Regeln als Gesetz, wo die Evidenz dünn ist.

---

## Evidenzstufen (verbindlich, wie f-texting)

| Stufe | Bedeutung |
|---|---|
| **A** | Peer-Review, Gesetzestext, BGH/höchstrichterlich, große repräsentative DE/DACH-Umfrage (Bitkom, Destatis, Statista mit n + Methode, Verbraucherzentrale mit Quelle). |
| **B** | Eine starke Studie, Verbandsstudie (AMÖ, ZVKK, Handwerkskammer), große Plattform-Umfrage, belastbarer Journalismus mit Methode, OLG/klare Behördenlinie. |
| **C** | Wiederholte Erstberichte (Foren, Reddit, Kleinanzeigen-Erfahrungen, Handwerker-Facebook, Trustpilot-Verbatims). Gut für Textur, nicht für Quoten. |
| **D** | Einzelner Coach, Sales-Blog, Agentur-Whitepaper, Anekdote, US-Studie ohne DACH-Übertrag. |
| **E** | Folklore ("immer siezen", "niemals Emoji", "3-Tage-Regel", "Kunden lieben KI-Texte"). Oft falsch. |

Jede belastbare Aussage bekommt **Stufe + Quelle + Jahr + Link**. Inferenzen explizit als Inferenz markieren. US-SMS/TCPA nicht als DE-WhatsApp-Gesetz verkaufen.

---

## Output-Vertrag pro Datei

Jede Datei ist **Deutsch**, ohne Em-Dashes (Gedankenstriche). Bindestriche in Komposita sind ok. Keine Secrets.

Pflichtstruktur:

1. **Titel + Stand-Datum + 4-Satz-Kern**
2. **Wozu die Datei da ist** (und was sie *nicht* ist)
3. **Kernsatz** (eine härteste Wahrheit)
4. **Evidenz-Tabelle / Befunde** mit Stufen
5. **Regler vs. Invarianten** (was sich ändert vs. was immer gilt)
6. **Diagnose-Signale** für den späteren Skill (was der Agent im Kunden-Text lesen muss)
7. **Skill-Folgen** (konkrete If-then, keine Line-Bibliothek)
8. **Anti-Patterns / Kill-shots** (was professionell klingt und trotzdem verliert)
9. **Offene Lücken** (was diese Recherche *nicht* als Gesetz machen darf)
10. **Quellen** am Ende, klickbar

Länge: lieber 8–20 Seiten Substanz als 3 Seiten Platitüden. Lieber eine ehrliche C/D-Markierung als eine erfundene A-Zahl.

**Nicht tun:**
- kein `SKILL.md`
- keine Template-Friedhöfe ("10 WhatsApp-Vorlagen")
- keine erfundenen Conversion-Prozente
- keine US-Compliance als DE-Recht
- keine Dating-Übertragung aus f-texting (nur die *Methode*)
- keine Dateien außerhalb von `customer-texting/` anfassen

---

## Datei-Lage (ein Home pro Bereich)

```
customer-texting/
  RESEARCH-BRIEF.md                 # diese Datei
  research-register-ton.md          # Sie/Du, Accommodation, Spiegeln
  research-kanaele.md               # WhatsApp, Kleinanzeigen, Mail, Telefon, Portale
  research-funnel.md                # Erstkontakt → Quali → Angebot → Close
  research-recht-de.md              # UWG, DSGVO, WhatsApp, Widerruf, Preise
  research-segmente.md              # Studenten, Senioren, Familien, Firma, Expat
  research-follow-up.md             # Nachfassen, Ghosting, wann aufhören
  research-einwaende-trust.md       # Preis, Schwarz, Versicherung, Fotos
  research-service-recovery.md      # Verspätung, Schaden, Reklamation
  research-linguistik-chat.md       # Länge, Emoji, KI-Ton, Tempo, Voice
  research-kuechenbau.md            # Erweiterung Handwerk / Küche
```
