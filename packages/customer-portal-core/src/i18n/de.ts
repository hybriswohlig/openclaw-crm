// packages/customer-portal-core/src/i18n/de.ts
//
// German portal copy — the source of truth for the key set. `en.ts` is typed
// against this object, so adding a key here without translating it there is a
// compile error, not a silently untranslated string in front of a customer.
//
// Conventions:
//   {placeholder}  interpolated by t()
//   {slot}         replaced by a React node (see <Slot> in portal-i18n.tsx),
//                  used where a sentence wraps a link or bold fragment
//
// Operator-typed content (KVA line-item labels, package names, notes) is NOT
// in here by design: it is contract text and gets shown exactly as written.

export const de = {
  // ── Header / chrome ──────────────────────────────────────────────────────
  "header.yourOrder": "Ihr Auftrag",
  "header.forCustomer": "für {name}",
  "header.stepsLabel": "Status-Schritte",
  "header.stage1": "Kostenvoranschlag",
  "header.stage1Short": "Angebot",
  "header.stage2": "Auftragsbestätigung",
  "header.stage2Short": "Bestätigt",
  "header.stage3": "Während des Umzugs",
  "header.stage3Short": "Umzug",
  "header.stage4": "Nach dem Umzug",
  "header.stage4Short": "Abschluss",
  "header.languageLabel": "Sprache / Language",
  "header.languageDe": "Deutsch",
  "header.languageEn": "English",

  // ── Stage 1: offer ───────────────────────────────────────────────────────
  "stage1.kvaPending":
    "Ihr Kostenvoranschlag wird gerade erstellt. Diese Seite aktualisiert sich automatisch, sobald das Angebot bereitsteht. Sie können die Seite einfach kurz später erneut öffnen.",
  "stage1.accepted": "Angebot angenommen",
  "stage1.confirmedOn": "Bestätigt am {date}.",
  "stage1.depositHint":
    "Damit Ihr Termin fest reserviert ist, überweisen Sie bitte die Anzahlung. Alle Zahlungsdaten finden Sie unten.",
  "stage1.abByEmail":
    "Sie erhalten Ihre Auftragsbestätigung in Kürze per E-Mail.",
  "stage1.summaryTitle": "Was umfasst der Auftrag",
  "stage1.showMore": "Mehr anzeigen",
  "stage1.showLess": "Weniger anzeigen",
  "stage1.breakdown": "Aufschlüsselung",
  "stage1.yourOffer": "Ihr Angebot",
  "stage1.offerFor": "Angebot für {name}",
  "stage1.chooseOfferBody":
    "Bitte wählen Sie nebenan Ihr passendes Paket bzw. einen Termin. Sobald Sie gewählt haben, sehen Sie hier den verbindlichen Preis und können den Auftrag annehmen.",
  "stage1.chooseOfferCta": "Angebot auswählen",
  "stage1.estimated": "Voraussichtlich",
  "stage1.fixedPriceInclVat": "Festpreis inkl. MwSt.",
  "stage1.fixedPrice": "Festpreis",
  "stage1.validUntil": "Gültig bis {date}",
  "stage1.expiredSuffix": " (abgelaufen)",
  "stage1.deposit": "Anzahlung",
  "stage1.depositLine": "{amount} zur Auftragsbestätigung.",
  "stage1.acceptCta": "Angebot verbindlich annehmen",
  "stage1.pickDateFirst": "Zuerst Termin wählen",
  "stage1.pickDateHint":
    "Bitte wählen Sie oben einen Termin, damit wir den Auftrag verbindlich für Sie reservieren können.",
  "stage1.acceptLegalHint":
    "Mit einem Klick bestätigen Sie den Auftrag rechtlich verbindlich (Textform gem. § 126b BGB). Sie erhalten eine Kopie per E-Mail.",
  "stage1.mobileAccept": "Angebot annehmen",
  "stage1.mobilePickDate": "Termin wählen",
  "stage1.expiredTitle": "Dieses Angebot ist abgelaufen.",
  "stage1.expiredBody":
    "Schreiben Sie uns kurz, wir prüfen die Verfügbarkeit und senden Ihnen ein aktualisiertes Angebot.",
  "stage1.expiredWaLabel": "Kurz nachfragen",
  "stage1.expiredWaMessage":
    "Guten Tag {firma}, das Angebot zu meinem Auftrag {dealNumber} ist abgelaufen. Können Sie mir bitte ein aktualisiertes Angebot senden?",
  "stage1.replyHint":
    "Antworten Sie einfach auf die Nachricht, mit der Sie diesen Link erhalten haben.",
  "stage1.trustVariable":
    "Versicherter Transport. Transparente Abrechnung nach Aufwand.",
  "stage1.trustFixed": "Versicherter Transport. Kein Aufpreis am Tag.",
  "stage1.trustContact": "Persönlicher Ansprechpartner bei {firma}.",
  "stage1.lineHelper": "Umzugshelfer",
  "stage1.lineTransporter": "Transporter",
  "stage1.lineOther": "Weitere Leistung",

  // Kalkulationsgrundlagen
  "stage1.assumptionsTitle": "Kalkulationsgrundlagen",
  "stage1.assumptionsTravel": "Anfahrt gesamt",
  "stage1.assumptionsTravelValue": "ca. {minutes} Min.",
  "stage1.assumptionsAssumedSuffix": " (Annahme)",
  "stage1.assumptionsFloorFrom": "Etage Beladestelle",
  "stage1.assumptionsFloorTo": "Etage Entladestelle",
  "stage1.assumptionsAccessFrom": "Zugang Beladestelle",
  "stage1.assumptionsAccessTo": "Zugang Entladestelle",
  "stage1.assumptionsScope": "Umfang",
  "stage1.assumptionsScopeValue": "{count} Positionen",
  "stage1.assumptionsVolumeSuffix": " · ca. {cbm} m³",
  "stage1.assumptionsDefaultNote":
    "Der Preis basiert auf diesen Angaben. Abweichende Gegebenheiten vor Ort (z. B. andere Etage, fehlender Aufzug, längere Trage- oder Anfahrtswege) können zu Mehrkosten führen.",

  // ── Acceptance dialog ────────────────────────────────────────────────────
  "confirm.title": "Verbindliche Annahme",
  "confirm.subtitle":
    "Bitte bestätigen Sie die folgenden Punkte. Eine Kopie der Annahme geht Ihnen anschließend per E-Mail zu.",
  "confirm.estimatedTotal": "Voraussichtlicher Gesamtbetrag",
  "confirm.fixedTotal": "Festpreis inkl. MwSt.",
  "confirm.moveDate": "Umzugstermin: {date}",
  "confirm.deposit": "Anzahlung: {amount} zur Auftragsbestätigung",
  "confirm.variableNote":
    "Die Abrechnung erfolgt nach tatsächlichem Aufwand. Verbindlich ist die finale Rechnung.",
  "confirm.offerCheckbox":
    "Ich habe das Angebot {slot} gelesen und stimme dem Inhalt zu.",
  "confirm.agbCheckbox": "Ich habe die {slot} gelesen und akzeptiere sie.",
  "confirm.agbLinkLabel": "Allgemeinen Geschäftsbedingungen (AGB)",
  /**
   * Only rendered when the portal is NOT in German: the AGB document itself is
   * German, so a non-German reader is told which version binds. Kept in this
   * dictionary for key parity.
   */
  "confirm.agbGermanOnlyNotice":
    "Die AGB liegen in deutscher Sprache vor; maßgeblich ist die deutsche Fassung.",
  "confirm.bindingCheckbox": "Mir ist bewusst, dass dies eine {slot} darstellt.",
  "confirm.bindingStrong": "verbindliche Beauftragung",
  "confirm.widerrufCheckbox":
    "Ich verzichte ausdrücklich auf mein Widerrufsrecht und stimme zu, dass mit der Erbringung der Dienstleistung {slot} begonnen wird (§ 356 Abs. 4 BGB). Der Umzugstermin liegt innerhalb von 14 Tagen.",
  "confirm.widerrufStrong": "vor Ablauf der Widerrufsfrist",
  "confirm.fullNameLabel": "Vollständiger Name (empfohlen)",
  "confirm.cancel": "Abbrechen",
  "confirm.submit": "Verbindlich annehmen",
  "confirm.submitting": "Wird gesendet…",
  "confirm.confirmAllFirst": "Bitte bestätigen Sie zuerst alle Punkte oben.",
  "confirm.legalFooter":
    "Mit Klick auf „Verbindlich annehmen“ kommt ein verbindlicher Vertrag über die vereinbarten Umzugsleistungen in Textform (§ 126b BGB) zwischen Ihnen und {firma} zustande. Zur Dokumentation werden Zeitpunkt, IP-Adresse und Browser-Kennung gespeichert.",
  "confirm.doneTitle": "Angebot angenommen",
  "confirm.doneSubtitle": "Eine Kopie geht Ihnen per E-Mail zu.",
  "confirm.doneDeposit":
    "Nur noch ein Schritt: Mit Eingang der Anzahlung ist Ihr Termin fest reserviert.",
  "confirm.doneNoDeposit":
    "Sie erhalten Ihre Auftragsbestätigung in Kürze per E-Mail.",
  "confirm.doneClose": "Fertig",

  // ── Packages ─────────────────────────────────────────────────────────────
  "packages.yourOffer": "Ihr Angebot",
  "packages.chooseFrom": "Wählen Sie aus {count} Optionen",
  "packages.tapToSelect": "Antippen zum Auswählen",
  "packages.yourChoice": "Ihre Wahl:",
  "packages.bindingSuffix": " (verbindlich)",
  "packages.canSwitchOption": ". Sie können oben jederzeit umwählen.",
  "packages.pickOneHint":
    "Wählen Sie eine der Optionen. Der angezeigte Gesamtpreis übernimmt Ihre Auswahl automatisch.",
  "packages.choosePackage": "Paket wählen",
  "packages.basedOnPackage": "Ihr Angebot basiert auf dem Paket",
  "packages.canSwitchPackage":
    ". Sie können oben jederzeit ein anderes Paket wählen",
  "packages.pickPackageHint":
    "Wählen Sie das Paket, das am besten zu Ihrem Umzug passt. Der angezeigte Gesamtpreis übernimmt Ihre Auswahl automatisch.",
  "packages.recommended": "Empfohlen",
  "packages.mostPopular": "Beliebteste Wahl",
  "packages.fixedPrice": "Festpreis",
  "packages.included": "Im Angebot enthalten",
  "packages.addable": "Auf Wunsch zubuchbar",
  "packages.excluded": "Nicht enthalten",
  "packages.saving": "Wird gespeichert…",
  "packages.selectOption": "Diese Option wählen",
  "packages.selectPackage": "Dieses Paket wählen",
  "packages.onRequest": "Auf Anfrage",
  "packages.priceFrom": "ab",
  "packages.individual": "Individuell",
  "packages.andMore": "und {count} weitere",
  "packages.waAskLabel": "Per WhatsApp anfragen",
  "packages.waAskMessage":
    "Hallo {firma}, ich interessiere mich für das Paket {package}. Können Sie mir dazu ein Angebot machen?",
  "packages.onRequestFallback":
    "Auf Anfrage. Antworten Sie uns einfach im Chat.",

  // ── Date offers ──────────────────────────────────────────────────────────
  "dates.yourDate": "Ihr gewählter Termin",
  "dates.change": "Ändern",
  "dates.changeTitle": "Termin ändern",
  "dates.pickTitle": "Bitte Termin wählen",
  "dates.proposals": "{count} Vorschläge",
  "dates.intro":
    "Wir haben Ihnen die folgenden Termine reserviert. Bitte wählen Sie eine Variante, damit wir verbindlich für Sie planen können.",
  "dates.noneFit": "Keiner der Termine passt?",
  "dates.waLabel": "Schreiben Sie uns kurz",
  "dates.waMessage":
    "Hallo {firma}, die vorgeschlagenen Termine passen bei mir leider nicht. Welche Alternativen gibt es?",
  "dates.waFallback":
    "Antworten Sie uns einfach auf die Nachricht, mit der Sie diesen Link erhalten haben.",
  "dates.keepCurrent": "Abbrechen und bei {date} bleiben",
  "dates.recommended": "Empfohlen",
  "dates.currentlySelected": "Aktuell gewählt",
  "dates.saving": "Wird gespeichert…",
  "dates.pickThis": "Diesen Termin wählen",

  // ── Payment ──────────────────────────────────────────────────────────────
  "payment.deposit": "Anzahlung",
  "payment.payment": "Zahlung",
  "payment.openAmount": "Offener Betrag",
  "payment.reference": "Verwendungszweck",
  "payment.thanks":
    "Danke! Wir prüfen den Zahlungseingang und melden uns sobald er bei uns angekommen ist.",
  "payment.reportedOn": "Gemeldet am {date}",
  "payment.iPaid": "Ich habe bezahlt",
  "payment.sending": "Wird gesendet…",
  "payment.sendFailed":
    "Konnte nicht gesendet werden. Bitte versuchen Sie es erneut.",
  "payment.qrHint":
    "Banking-App öffnen und QR-Code scannen: IBAN, Betrag und Verwendungszweck sind vorausgefüllt.",
  "payment.qrHintMobile":
    "Sie lesen das auf dem Handy? Machen Sie einen Screenshot und scannen Sie den Code in Ihrer Banking-App aus der Galerie. Oder kopieren Sie einfach die Felder unten.",
  "payment.accountHolder": "Kontoinhaber",
  "payment.iban": "IBAN",
  "payment.bic": "BIC",
  "payment.amount": "Betrag",
  "payment.paypalHint":
    "Tippen Sie auf den Button, um die Zahlung in der PayPal-App zu öffnen. Betrag und Empfänger sind vorausgefüllt.",
  "payment.paypalCta": "Mit PayPal bezahlen",
  "payment.cashTitle": "Zahlung bar bei Übergabe",
  "payment.cashBody":
    "Bitte halten Sie den passenden Betrag bereit. Eine Quittung erhalten Sie unmittelbar nach Abschluss des Umzugs.",
  "payment.cardTitle": "Kartenzahlung",
  "payment.cardBody":
    "Wir nehmen Visa, Mastercard und Girocard vor Ort entgegen. Eine Online-Kartenzahlung bauen wir gerade. Bei Fragen melden Sie sich bitte kurz bei Ihrem Ansprechpartner.",
  "payment.unconfigured":
    "Für diesen Auftrag sind noch keine Zahldaten hinterlegt. Bitte melden Sie sich kurz beim Ansprechpartner.",
  "payment.copyAria": "{label} kopieren",
  "payment.copiedAria": "{label} kopiert",

  // ── Scope summary ────────────────────────────────────────────────────────
  "scope.title": "Eckdaten",
  "scope.date": "Termin",
  "scope.from": "Abholung",
  "scope.to": "Ziel",
  "scope.floor": "Etage",
  "scope.volume": "Volumen",
  "scope.volumeValue": "ca. {cbm} m³",
  "scope.helpers": "Helfer",
  "scope.helpersValue": "{count} Personen",
  "scope.transporter": "Transporter",
  "scope.notes": "Notizen",

  // ── Inclusions ───────────────────────────────────────────────────────────
  "inclusions.title": "Leistungsumfang",
  "inclusions.included": "Im Angebot enthalten",
  "inclusions.optional": "Auf Wunsch zubuchbar",
  "inclusions.optionalHint":
    "Diese Leistungen sind im aktuellen Angebot nicht enthalten. Sagen Sie kurz Bescheid, wenn Sie etwas davon möchten.",

  // ── Documents ────────────────────────────────────────────────────────────
  "documents.title": "Ihre Unterlagen",
  "documents.acceptance": "Angebotsannahme",
  "documents.acceptedOn": "Verbindlich angenommen am {date}",
  "documents.acceptedAmountSuffix": " über {amount}",
  "documents.orderConfirmation": "Auftragsbestätigung (PDF)",
  "documents.invoice": "Rechnung (PDF)",
  "documents.open": "Öffnen",

  // ── Stage 2: confirmed, waiting ──────────────────────────────────────────
  "stage2.confirmedTitle": "Ihr Auftrag ist bestätigt.",
  "stage2.confirmedBody":
    "Wir freuen uns auf Ihren Umzug. Alle wichtigen Informationen finden Sie unten.",
  "stage2.abBelowSuffix":
    " Ihre Auftragsbestätigung finden Sie unten unter Ihren Unterlagen.",
  "stage2.rescheduleTrigger": "Termin passt nicht mehr? Terminänderung anfragen",
  "stage2.rescheduleTitle": "Terminänderung anfragen",
  "stage2.rescheduleIntro":
    "Nennen Sie uns gern bis zu drei Wunschtermine, wir prüfen die Verfügbarkeit und melden uns.",
  "stage2.yourCrew": "Ihre Crew",
  "stage2.questionTrigger": "Lieber schreiben? Nachricht senden",
  "stage2.questionTitle": "Nachricht an uns",
  "stage2.moveDay": "Ihr Umzugstag",
  "stage2.daysUntilBefore": "Noch",
  "stage2.daysUntilAfter": "Tage bis zu Ihrem Umzug",
  "stage2.tomorrow": "Morgen ist es so weit!",
  "stage2.today": "Heute ist Ihr Umzugstag!",
  "stage2.arrivalBetween": "Ankunft des Teams zwischen {start} und {end} Uhr",
  "stage2.arrivalAround": "Ankunft gegen {start} Uhr",
  "stage2.askQuestion": "Frage stellen",
  "stage2.askQuestionSub": "Direkt per WhatsApp an Ihren Ansprechpartner",
  "stage2.waMessage":
    "Hallo {firma}, ich habe eine Frage zu meinem Umzug {dealNumber}.",

  // ── Stage 3: live ────────────────────────────────────────────────────────
  "stage3.currentStatus": "Aktueller Status",
  "stage3.finished": "Umzug abgeschlossen. Aufräumen läuft.",
  "stage3.onsite": "Die Crew ist vor Ort und arbeitet.",
  "stage3.departed": "Die Crew ist auf dem Weg zur Abholadresse.",
  "stage3.running": "Der Umzug läuft.",
  "stage3.arrivalBetween": "Geplante Ankunft zwischen {start} und {end} Uhr",
  "stage3.arrivalAround": "Geplante Ankunft gegen {start} Uhr",
  "stage3.reliabilityNote":
    "Das Team meldet sich kurz vor der Ankunft bei Ihnen.",
  "stage3.milestoneTravel": "Anfahrt",
  "stage3.milestoneOnsite": "Vor Ort",
  "stage3.milestoneFinished": "Beendet",
  "stage3.pending": "ausstehend",

  // ── Hourly clock ─────────────────────────────────────────────────────────
  "hourly.title": "Live-Abrechnung (voraussichtlich)",
  "hourly.elapsed": "Bisherige Dauer",
  "hourly.rateLine":
    "{count} Helfer × {helperRate} + {transporterRate} Transporter",
  "hourly.note":
    "Diese Berechnung dient der Transparenz während des Auftrags. Verbindlich ist die finale Rechnung.",

  // ── Stage 4: done ────────────────────────────────────────────────────────
  "stage4.title": "Der Umzug ist abgeschlossen.",
  "stage4.thanksNamed":
    "Vielen Dank für Ihr Vertrauen, {name}, und einen guten Start im neuen Zuhause!",
  "stage4.thanks":
    "Vielen Dank für Ihr Vertrauen und einen guten Start im neuen Zuhause!",
  "stage4.damageTrigger": "Ist etwas zu Bruch gegangen oder lief etwas schief?",
  "stage4.damageTitle": "Schaden oder Problem melden",
  "stage4.damageIntro":
    "Beschreiben Sie kurz, was passiert ist. Wir kümmern uns umgehend darum.",
  "stage4.damagePhotosHint":
    "Fotos vom Schaden senden Sie uns am einfachsten per WhatsApp:",
  "stage4.damagePhotosCta": "Fotos per WhatsApp senden",
  "stage4.damageWaMessage":
    "Hallo {firma}, zu meinem Umzug {dealNumber}: ich möchte einen Schaden melden. Fotos anbei.",

  // ── Crew rating ──────────────────────────────────────────────────────────
  "rating.title": "Wie war Ihre Crew?",
  "rating.thanks": "Danke für Ihr Feedback!",
  "rating.already": "Sie haben Ihre Bewertung bereits abgegeben. Vielen Dank!",
  "rating.googleHint":
    "Wenn alles geklappt hat, freuen wir uns über eine öffentliche Google-Bewertung. Der Button dazu erscheint direkt darunter.",
  "rating.passOn": "Wir geben Ihr Feedback an die Crew weiter.",
  "rating.commentLabel": "Kommentar (optional)",
  "rating.commentPlaceholder": "Was lief gut? Wo können wir besser werden?",
  "rating.submit": "Bewertung abschicken",
  "rating.starAriaOne": "{n} Stern",
  "rating.starAriaMany": "{n} Sterne",

  // ── Google review ────────────────────────────────────────────────────────
  "review.title": "Hat alles geklappt?",
  "review.body": "Mit einer Google-Bewertung hilfst du uns sehr.",

  // ── Self-service request form ────────────────────────────────────────────
  "requestForm.preferredDate": "Wunschtermin {n}",
  "requestForm.yourMessage": "Ihre Nachricht",
  "requestForm.placeholderReschedule":
    "Was hat sich geändert? Welche Termine passen besser?",
  "requestForm.placeholderQuestion": "Ihre Frage an uns",
  "requestForm.placeholderDamage":
    "Was ist beschädigt? Wo ist es aufgefallen?",
  "requestForm.sending": "Wird gesendet…",
  "requestForm.submitDamage": "Schaden melden",
  "requestForm.submit": "Anfrage senden",
  "requestForm.cancel": "Abbrechen",
  "requestForm.doneTitle": "Anfrage gesendet.",
  "requestForm.doneBody": "Wir melden uns kurzfristig bei Ihnen.",

  // ── Email capture ────────────────────────────────────────────────────────
  "email.savedTitle": "E-Mail gespeichert",
  "email.savedBody":
    "Wir senden Ihnen die Bestätigung und alle Unterlagen zu Ihrem Umzug an diese Adresse.",
  "email.headlineRelay":
    "Wir haben Sie bisher nur über Kleinanzeigen erreicht.",
  "email.headlineMissing": "Wir haben noch keine E-Mail von Ihnen.",
  "email.bodyRelay":
    "Damit Sie Ihre Auftragsbestätigung, Rechnung und weitere Unterlagen direkt erhalten, geben Sie uns kurz Ihre echte E-Mail-Adresse.",
  "email.bodyMissing":
    "Damit Sie Ihre Auftragsbestätigung und Rechnung per E-Mail erhalten, hinterlegen Sie hier bitte Ihre Adresse.",
  "email.cta": "E-Mail hinterlegen",
  "email.placeholder": "ihre.adresse@beispiel.de",
  "email.privacyHint":
    "Wir verwenden Ihre Adresse nur für Unterlagen zu diesem Umzug.",
  "email.cancel": "Abbrechen",
  "email.save": "Speichern",

  // ── Preparation checklist ────────────────────────────────────────────────
  "checklist.title": "Gut vorbereitet in den Umzug",
  "checklist.progress": "{done} von {total} erledigt",
  "checklist.item1": "Kartons beschriften",
  "checklist.item1Detail": "Zielraum draufschreiben",
  "checklist.item2": "Halteverbotszone beantragen",
  "checklist.item2Detail": "Falls nötig, 7 bis 10 Tage Vorlauf",
  "checklist.item3": "Parkplatz für den Transporter freihalten",
  "checklist.item4": "Aufzug reservieren",
  "checklist.item4Detail": "Falls vorhanden",
  "checklist.item5": "Nachsendeauftrag stellen",
  "checklist.item6": "Zählerstände ablesen und fotografieren",
  "checklist.item7": "Wertsachen und Dokumente separat transportieren",
  "checklist.item8": "Kühlschrank 24 Stunden vorher abtauen",

  // ── Media feed / customer photos ─────────────────────────────────────────
  "media.title": "Bilder & Updates",
  "media.empty":
    "Noch keine Bilder von der Crew. Sobald euer Team Fotos sendet, erscheinen sie hier automatisch.",
  "media.closeAria": "Schließen",
  "photos.title": "Ihre Fotos ({count})",
  "photos.subtitle": "Die Fotos, die Sie uns geschickt haben",
  "photos.feedTitle": "Ihre Fotos",

  // ── Footer ───────────────────────────────────────────────────────────────
  "footer.questions": "Fragen zu Ihrem Umzug?",
  "footer.waLabel": "Per WhatsApp schreiben",
  "footer.impressum": "Impressum",
  "footer.datenschutz": "Datenschutz",
  "footer.agb": "AGB",

  // ── Standalone notices ───────────────────────────────────────────────────
  "notices.notFoundTitle": "Link nicht gefunden",
  "notices.notFoundBody":
    "Dieser Status-Link ist ungültig. Bitte überprüfen Sie die URL oder wenden Sie sich an Ihren Ansprechpartner.",
  "notices.notFoundHint":
    "Antworten Sie einfach auf die Nachricht, mit der Sie diesen Link erhalten haben. Wir helfen sofort weiter.",
  "notices.revokedTitle": "Link nicht mehr verfügbar",
  "notices.revokedBody":
    "Dieser Status-Link wurde geschlossen oder ist abgelaufen. Bitte kontaktieren Sie {firma}, falls Sie weiterhin Informationen zu Ihrem Umzug benötigen.",
  "notices.waQuestions": "Fragen? Per WhatsApp schreiben",
  "notices.disabledTitle": "Aktuell nicht verfügbar",
  "notices.disabledBody":
    "Das Status-Portal ist vorübergehend nicht erreichbar. Ihr Auftrag läuft davon unabhängig ganz normal weiter.",
  "notices.errorTitle": "Das hat gerade nicht geklappt.",
  "notices.errorBody":
    "Bitte laden Sie die Seite neu. Ihre Daten sind nicht verloren gegangen.",
  "notices.errorRetry": "Erneut versuchen",
  "notices.loading": "Wird geladen",

  // ── Page metadata / link preview ─────────────────────────────────────────
  "meta.fallbackTitle": "Auftrag",
  "meta.fallbackDescription": "Status, Angebot und Auftragsbestätigung.",
  "meta.title": "{firma} · Auftrag {dealNumber}",
  "meta.descriptionNamed":
    "Auftrag {dealNumber} für {name}: Angebot, Status und Bestätigung.",
  "meta.description":
    "Auftrag {dealNumber}: Angebot, Status und Bestätigung.",

  // ── WhatsApp ─────────────────────────────────────────────────────────────
  "whatsapp.defaultLabel": "Per WhatsApp schreiben",

  // ── Errors (shared across every portal POST) ─────────────────────────────
  "errors.generic": "Es ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut.",
  "errors.connection": "Verbindungsfehler. Bitte versuchen Sie es erneut.",
  "errors.noConnection": "Keine Verbindung. Bitte versuchen Sie es erneut.",
  "errors.revoked": "Dieser Link ist nicht mehr aktiv.",
  "errors.notFound": "Link nicht gefunden.",
  "errors.missingAcknowledgement":
    "Bitte bestätigen Sie alle erforderlichen Punkte.",
  "errors.widerrufRequired":
    "Für Termine innerhalb von 14 Tagen ist der Widerrufs-Verzicht erforderlich.",
  "errors.noQuotation":
    "Es liegt aktuell kein Angebot vor. Bitte kontaktieren Sie uns.",
  "errors.offerExpired":
    "Dieses Angebot ist inzwischen abgelaufen. Schreiben Sie uns kurz, wir prüfen die Verfügbarkeit und senden Ihnen ein aktualisiertes Angebot.",
  "errors.packageUnavailable":
    "Diese Option ist nicht mehr verfügbar. Bitte Seite neu laden.",
  "errors.alreadyAccepted":
    "Das Angebot wurde bereits verbindlich angenommen. Bitte kontaktieren Sie uns für eine Änderung.",
  "errors.noOperatingCompany": "Auftrag noch nicht vollständig zugeordnet.",
  "errors.dateUnavailable":
    "Dieser Termin ist nicht mehr verfügbar. Bitte Seite neu laden.",
  "errors.invalidSlot": "Ungültige Auswahl. Bitte erneut versuchen.",
  "errors.invalidEmail": "Bitte geben Sie eine gültige E-Mail-Adresse an.",
  "errors.relayNotAllowed":
    "Diese Adresse ist nur ein Weiterleitungs-Link. Bitte geben Sie Ihre echte Adresse an.",
  "errors.noContactProfile":
    "Es gibt aktuell kein Kontaktprofil. Bitte melden Sie sich kurz beim Ansprechpartner.",
  "errors.describeRequest": "Bitte beschreiben Sie Ihr Anliegen kurz.",
  "errors.rateLimited":
    "Sie haben bereits mehrere Anfragen gesendet. Wir melden uns schnellstmöglich.",
  "errors.sendFailed":
    "Konnte nicht gesendet werden. Bitte versuchen Sie es erneut.",
  "errors.ratingRequired": "Bitte vergeben Sie mindestens eine Bewertung.",
  "errors.ratingFailed": "Bewertung konnte nicht gespeichert werden.",
} as const;

/** Every translatable string in the portal is addressed by one of these. */
export type PortalMessageKey = keyof typeof de;

/** Shape every other locale must satisfy — enforced at compile time. */
export type PortalDictionary = Record<PortalMessageKey, string>;
