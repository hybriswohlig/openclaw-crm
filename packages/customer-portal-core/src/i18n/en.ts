// packages/customer-portal-core/src/i18n/en.ts
//
// English portal copy. Typed as PortalDictionary, so a key added to de.ts
// without a translation here fails `tsc` rather than reaching a customer.
//
// Notes on wording:
//   - German statute references (§ 126b BGB, § 356 Abs. 4 BGB) stay as-is:
//     they name actual German law and translating them would be wrong.
//   - "AGB" is kept alongside the English gloss so the term matches the
//     document the customer opens, which is German.
//   - Formal-but-warm register, matching the German "Sie".

import type { PortalDictionary } from "./de";

export const en: PortalDictionary = {
  // ── Header / chrome ──────────────────────────────────────────────────────
  "header.yourOrder": "Your order",
  "header.forCustomer": "for {name}",
  "header.stepsLabel": "Status steps",
  "header.stage1": "Quotation",
  "header.stage1Short": "Offer",
  "header.stage2": "Order confirmed",
  "header.stage2Short": "Confirmed",
  "header.stage3": "Moving day",
  "header.stage3Short": "Move",
  "header.stage4": "After the move",
  "header.stage4Short": "Complete",
  "header.languageLabel": "Sprache / Language",
  "header.languageDe": "Deutsch",
  "header.languageEn": "English",

  // ── Stage 1: offer ───────────────────────────────────────────────────────
  "stage1.kvaPending":
    "Your quotation is being prepared. This page updates itself automatically as soon as the offer is ready — you can simply come back in a little while.",
  "stage1.accepted": "Offer accepted",
  "stage1.confirmedOn": "Confirmed on {date}.",
  "stage1.depositHint":
    "To lock in your date, please transfer the deposit. All payment details are below.",
  "stage1.abByEmail":
    "You will receive your order confirmation by email shortly.",
  "stage1.summaryTitle": "What this order covers",
  "stage1.showMore": "Show more",
  "stage1.showLess": "Show less",
  "stage1.breakdown": "Breakdown",
  "stage1.yourOffer": "Your offer",
  "stage1.offerFor": "Offer for {name}",
  "stage1.chooseOfferBody":
    "Please choose the package or date that suits you, shown alongside. Once you have chosen, the binding price appears here and you can accept the order.",
  "stage1.chooseOfferCta": "Choose an offer",
  "stage1.estimated": "Estimated",
  "stage1.fixedPriceInclVat": "Fixed price incl. VAT",
  "stage1.fixedPrice": "Fixed price",
  "stage1.validUntil": "Valid until {date}",
  "stage1.expiredSuffix": " (expired)",
  "stage1.deposit": "Deposit",
  "stage1.depositLine": "{amount} on order confirmation.",
  "stage1.acceptCta": "Accept offer (binding)",
  "stage1.pickDateFirst": "Choose a date first",
  "stage1.pickDateHint":
    "Please choose a date above so we can reserve the job for you on a binding basis.",
  "stage1.acceptLegalHint":
    "One click confirms the order as legally binding (text form under § 126b BGB). You will receive a copy by email.",
  "stage1.mobileAccept": "Accept offer",
  "stage1.mobilePickDate": "Choose date",
  "stage1.expiredTitle": "This offer has expired.",
  "stage1.expiredBody":
    "Send us a quick message — we will check availability and send you an updated offer.",
  "stage1.expiredWaLabel": "Ask us",
  "stage1.expiredWaMessage":
    "Hello {firma}, the offer for my order {dealNumber} has expired. Could you please send me an updated one?",
  "stage1.replyHint":
    "Simply reply to the message you received this link with.",
  "stage1.trustVariable":
    "Insured transport. Transparent billing based on actual time.",
  "stage1.trustFixed": "Insured transport. No surcharges on the day.",
  "stage1.trustContact": "A personal contact at {firma}.",
  "stage1.lineHelper": "Moving helper",
  "stage1.lineTransporter": "Van",
  "stage1.lineOther": "Additional service",

  // Basis of calculation
  "stage1.assumptionsTitle": "Basis of calculation",
  "stage1.assumptionsTravel": "Total travel time",
  "stage1.assumptionsTravelValue": "approx. {minutes} min.",
  "stage1.assumptionsAssumedSuffix": " (assumed)",
  "stage1.assumptionsFloorFrom": "Floor at pick-up",
  "stage1.assumptionsFloorTo": "Floor at destination",
  "stage1.assumptionsAccessFrom": "Access at pick-up",
  "stage1.assumptionsAccessTo": "Access at destination",
  "stage1.assumptionsScope": "Scope",
  "stage1.assumptionsScopeValue": "{count} items",
  "stage1.assumptionsVolumeSuffix": " · approx. {cbm} m³",
  "stage1.assumptionsDefaultNote":
    "The price is based on these details. Conditions on site that differ from them (for example a different floor, no lift, longer carrying or travel distances) may lead to additional costs.",

  // ── Acceptance dialog ────────────────────────────────────────────────────
  "confirm.title": "Binding acceptance",
  "confirm.subtitle":
    "Please confirm the points below. A copy of your acceptance will then be sent to you by email.",
  "confirm.estimatedTotal": "Estimated total",
  "confirm.fixedTotal": "Fixed price incl. VAT",
  "confirm.moveDate": "Moving date: {date}",
  "confirm.deposit": "Deposit: {amount} on order confirmation",
  "confirm.variableNote":
    "Billing is based on the actual time and effort required. The final invoice is what binds.",
  "confirm.offerCheckbox":
    "I have read offer {slot} and agree with its content.",
  "confirm.agbCheckbox": "I have read and accept the {slot}.",
  "confirm.agbLinkLabel": "General Terms and Conditions (AGB)",
  "confirm.agbGermanOnlyNotice":
    "The AGB are provided in German; the German version is the legally binding one.",
  "confirm.bindingCheckbox": "I understand that this constitutes a {slot}.",
  "confirm.bindingStrong": "binding order",
  "confirm.widerrufCheckbox":
    "I expressly waive my right of withdrawal and agree that performance of the service may begin {slot} (§ 356 Abs. 4 BGB). The moving date falls within 14 days.",
  "confirm.widerrufStrong": "before the withdrawal period expires",
  "confirm.fullNameLabel": "Full name (recommended)",
  "confirm.cancel": "Cancel",
  "confirm.submit": "Confirm and accept",
  "confirm.submitting": "Sending…",
  "confirm.confirmAllFirst": "Please confirm all the points above first.",
  "confirm.legalFooter":
    "By clicking “Confirm and accept” a binding contract for the agreed moving services is formed in text form (§ 126b BGB) between you and {firma}. The time, IP address and browser identifier are stored as documentation.",
  "confirm.doneTitle": "Offer accepted",
  "confirm.doneSubtitle": "A copy is on its way to you by email.",
  "confirm.doneDeposit":
    "One last step: once the deposit arrives, your date is firmly reserved.",
  "confirm.doneNoDeposit":
    "You will receive your order confirmation by email shortly.",
  "confirm.doneClose": "Done",

  // ── Packages ─────────────────────────────────────────────────────────────
  "packages.yourOffer": "Your offer",
  "packages.chooseFrom": "Choose from {count} options",
  "packages.tapToSelect": "Tap to select",
  "packages.yourChoice": "Your choice:",
  "packages.bindingSuffix": " (binding)",
  "packages.canSwitchOption": ". You can change your choice above at any time.",
  "packages.pickOneHint":
    "Choose one of the options. The total price shown updates with your selection automatically.",
  "packages.choosePackage": "Choose a package",
  "packages.basedOnPackage": "Your offer is based on the package",
  "packages.canSwitchPackage":
    ". You can pick a different package above at any time",
  "packages.pickPackageHint":
    "Choose the package that best suits your move. The total price shown updates with your selection automatically.",
  "packages.recommended": "Recommended",
  "packages.mostPopular": "Most popular",
  "packages.fixedPrice": "Fixed price",
  "packages.included": "Included in the offer",
  "packages.addable": "Available on request",
  "packages.excluded": "Not included",
  "packages.saving": "Saving…",
  "packages.selectOption": "Choose this option",
  "packages.selectPackage": "Choose this package",
  "packages.onRequest": "On request",
  "packages.priceFrom": "from",
  "packages.individual": "Individual",
  "packages.andMore": "and {count} more",
  "packages.waAskLabel": "Ask via WhatsApp",
  "packages.waAskMessage":
    "Hello {firma}, I am interested in the {package} package. Could you send me an offer for it?",
  "packages.onRequestFallback": "On request. Just reply to us in the chat.",

  // ── Date offers ──────────────────────────────────────────────────────────
  "dates.yourDate": "Your chosen date",
  "dates.change": "Change",
  "dates.changeTitle": "Change date",
  "dates.pickTitle": "Please choose a date",
  "dates.proposals": "{count} proposals",
  "dates.intro":
    "We have reserved the following dates for you. Please choose one so we can plan on a binding basis.",
  "dates.noneFit": "None of these dates work?",
  "dates.waLabel": "Send us a quick message",
  "dates.waMessage":
    "Hello {firma}, unfortunately none of the proposed dates work for me. What alternatives are there?",
  "dates.waFallback":
    "Simply reply to the message you received this link with.",
  "dates.keepCurrent": "Cancel and keep {date}",
  "dates.recommended": "Recommended",
  "dates.currentlySelected": "Currently selected",
  "dates.saving": "Saving…",
  "dates.pickThis": "Choose this date",

  // ── Payment ──────────────────────────────────────────────────────────────
  "payment.deposit": "Deposit",
  "payment.payment": "Payment",
  "payment.openAmount": "Amount due",
  "payment.reference": "Payment reference",
  "payment.thanks":
    "Thank you! We will check for the incoming payment and let you know once it has reached us.",
  "payment.reportedOn": "Reported on {date}",
  "payment.iPaid": "I have paid",
  "payment.sending": "Sending…",
  "payment.sendFailed": "Could not be sent. Please try again.",
  "payment.qrHint":
    "Open your banking app and scan the QR code: IBAN, amount and payment reference are pre-filled.",
  "payment.qrHintMobile":
    "Reading this on your phone? Take a screenshot and scan the code from your gallery in your banking app. Or simply copy the fields below.",
  "payment.accountHolder": "Account holder",
  "payment.iban": "IBAN",
  "payment.bic": "BIC",
  "payment.amount": "Amount",
  "payment.paypalHint":
    "Tap the button to open the payment in the PayPal app. Amount and recipient are pre-filled.",
  "payment.paypalCta": "Pay with PayPal",
  "payment.cashTitle": "Cash payment on handover",
  "payment.cashBody":
    "Please have the exact amount ready. You will receive a receipt immediately after the move is complete.",
  "payment.cardTitle": "Card payment",
  "payment.cardBody":
    "We accept Visa, Mastercard and Girocard on site. Online card payment is something we are still building. If you have questions, please get in touch with your contact.",
  "payment.unconfigured":
    "No payment details have been set up for this order yet. Please get in touch with your contact.",
  "payment.copyAria": "Copy {label}",
  "payment.copiedAria": "{label} copied",

  // ── Scope summary ────────────────────────────────────────────────────────
  "scope.title": "Key details",
  "scope.date": "Date",
  "scope.from": "Pick-up",
  "scope.to": "Destination",
  "scope.floor": "Floor",
  "scope.volume": "Volume",
  "scope.volumeValue": "approx. {cbm} m³",
  "scope.helpers": "Helpers",
  "scope.helpersValue": "{count} people",
  "scope.transporter": "Van",
  "scope.notes": "Notes",

  // ── Inclusions ───────────────────────────────────────────────────────────
  "inclusions.title": "What's included",
  "inclusions.included": "Included in the offer",
  "inclusions.optional": "Available on request",
  "inclusions.optionalHint":
    "These services are not part of the current offer. Just let us know if you would like any of them.",

  // ── Documents ────────────────────────────────────────────────────────────
  "documents.title": "Your documents",
  "documents.acceptance": "Offer acceptance",
  "documents.acceptedOn": "Accepted as binding on {date}",
  "documents.acceptedAmountSuffix": " for {amount}",
  "documents.orderConfirmation": "Order confirmation (PDF)",
  "documents.invoice": "Invoice (PDF)",
  "documents.open": "Open",

  // ── Stage 2: confirmed, waiting ──────────────────────────────────────────
  "stage2.confirmedTitle": "Your order is confirmed.",
  "stage2.confirmedBody":
    "We are looking forward to your move. All the important information is below.",
  "stage2.abBelowSuffix":
    " You will find your order confirmation below under your documents.",
  "stage2.rescheduleTrigger": "Date no longer works? Request a change",
  "stage2.rescheduleTitle": "Request a date change",
  "stage2.rescheduleIntro":
    "Feel free to give us up to three preferred dates — we will check availability and get back to you.",
  "stage2.yourCrew": "Your crew",
  "stage2.questionTrigger": "Prefer to write? Send a message",
  "stage2.questionTitle": "Message us",
  "stage2.moveDay": "Your moving day",
  "stage2.daysUntilBefore": "Only",
  "stage2.daysUntilAfter": "days until your move",
  "stage2.tomorrow": "Tomorrow is the day!",
  "stage2.today": "Today is your moving day!",
  "stage2.arrivalBetween": "The team arrives between {start} and {end}",
  "stage2.arrivalAround": "Arriving around {start}",
  "stage2.askQuestion": "Ask a question",
  "stage2.askQuestionSub": "Straight to your contact via WhatsApp",
  "stage2.waMessage":
    "Hello {firma}, I have a question about my move {dealNumber}.",

  // ── Stage 3: live ────────────────────────────────────────────────────────
  "stage3.currentStatus": "Current status",
  "stage3.finished": "Move complete. Tidying up now.",
  "stage3.onsite": "The crew is on site and working.",
  "stage3.departed": "The crew is on the way to the pick-up address.",
  "stage3.running": "The move is under way.",
  "stage3.arrivalBetween": "Scheduled arrival between {start} and {end}",
  "stage3.arrivalAround": "Scheduled arrival around {start}",
  "stage3.reliabilityNote":
    "The team will get in touch shortly before they arrive.",
  "stage3.milestoneTravel": "En route",
  "stage3.milestoneOnsite": "On site",
  "stage3.milestoneFinished": "Finished",
  "stage3.pending": "pending",

  // ── Hourly clock ─────────────────────────────────────────────────────────
  "hourly.title": "Live billing (estimated)",
  "hourly.elapsed": "Time so far",
  "hourly.rateLine":
    "{count} helpers × {helperRate} + {transporterRate} van",
  "hourly.note":
    "This calculation is for transparency during the job. The final invoice is what binds.",

  // ── Stage 4: done ────────────────────────────────────────────────────────
  "stage4.title": "The move is complete.",
  "stage4.thanksNamed":
    "Thank you for your trust, {name}, and all the best in your new home!",
  "stage4.thanks":
    "Thank you for your trust and all the best in your new home!",
  "stage4.damageTrigger": "Did something get broken or go wrong?",
  "stage4.damageTitle": "Report damage or a problem",
  "stage4.damageIntro":
    "Briefly describe what happened. We will take care of it right away.",
  "stage4.damagePhotosHint":
    "The easiest way to send us photos of the damage is via WhatsApp:",
  "stage4.damagePhotosCta": "Send photos via WhatsApp",
  "stage4.damageWaMessage":
    "Hello {firma}, regarding my move {dealNumber}: I would like to report damage. Photos attached.",

  // ── Crew rating ──────────────────────────────────────────────────────────
  "rating.title": "How was your crew?",
  "rating.thanks": "Thank you for your feedback!",
  "rating.already": "You have already submitted your rating. Thank you!",
  "rating.googleHint":
    "If everything went well, a public Google review would mean a lot to us. The button for it appears just below.",
  "rating.passOn": "We will pass your feedback on to the crew.",
  "rating.commentLabel": "Comment (optional)",
  "rating.commentPlaceholder": "What went well? Where can we do better?",
  "rating.submit": "Submit rating",
  "rating.starAriaOne": "{n} star",
  "rating.starAriaMany": "{n} stars",

  // ── Google review ────────────────────────────────────────────────────────
  "review.title": "Did everything go well?",
  "review.body": "A Google review would help us a great deal.",

  // ── Self-service request form ────────────────────────────────────────────
  "requestForm.preferredDate": "Preferred date {n}",
  "requestForm.yourMessage": "Your message",
  "requestForm.placeholderReschedule":
    "What has changed? Which dates would suit you better?",
  "requestForm.placeholderQuestion": "Your question for us",
  "requestForm.placeholderDamage":
    "What is damaged? Where did you notice it?",
  "requestForm.sending": "Sending…",
  "requestForm.submitDamage": "Report damage",
  "requestForm.submit": "Send request",
  "requestForm.cancel": "Cancel",
  "requestForm.doneTitle": "Request sent.",
  "requestForm.doneBody": "We will get back to you shortly.",

  // ── Email capture ────────────────────────────────────────────────────────
  "email.savedTitle": "Email saved",
  "email.savedBody":
    "We will send the confirmation and all documents for your move to this address.",
  "email.headlineRelay":
    "So far we have only been able to reach you via Kleinanzeigen.",
  "email.headlineMissing": "We do not have an email address for you yet.",
  "email.bodyRelay":
    "So that your order confirmation, invoice and other documents reach you directly, please give us your real email address.",
  "email.bodyMissing":
    "So that your order confirmation and invoice reach you by email, please enter your address here.",
  "email.cta": "Add email address",
  "email.placeholder": "your.address@example.com",
  "email.privacyHint":
    "We use your address only for documents relating to this move.",
  "email.cancel": "Cancel",
  "email.save": "Save",

  // ── Preparation checklist ────────────────────────────────────────────────
  "checklist.title": "Well prepared for your move",
  "checklist.progress": "{done} of {total} done",
  "checklist.item1": "Label the boxes",
  "checklist.item1Detail": "Write the destination room on them",
  "checklist.item2": "Apply for a no-parking zone",
  "checklist.item2Detail": "If needed, allow 7 to 10 days",
  "checklist.item3": "Keep a parking space free for the van",
  "checklist.item4": "Reserve the lift",
  "checklist.item4Detail": "If there is one",
  "checklist.item5": "Set up mail forwarding",
  "checklist.item6": "Read and photograph the meter readings",
  "checklist.item7": "Transport valuables and documents separately",
  "checklist.item8": "Defrost the fridge 24 hours beforehand",

  // ── Media feed / customer photos ─────────────────────────────────────────
  "media.title": "Photos & updates",
  "media.empty":
    "No photos from the crew yet. As soon as your team sends pictures, they appear here automatically.",
  "media.closeAria": "Close",
  "photos.title": "Your photos ({count})",
  "photos.subtitle": "The photos you sent us",
  "photos.feedTitle": "Your photos",

  // ── Footer ───────────────────────────────────────────────────────────────
  "footer.questions": "Questions about your move?",
  "footer.waLabel": "Message us on WhatsApp",
  "footer.impressum": "Legal notice",
  "footer.datenschutz": "Privacy",
  "footer.agb": "Terms (AGB)",

  // ── Standalone notices ───────────────────────────────────────────────────
  "notices.notFoundTitle": "Link not found",
  "notices.notFoundBody":
    "This status link is not valid. Please check the URL or get in touch with your contact.",
  "notices.notFoundHint":
    "Simply reply to the message you received this link with. We will help straight away.",
  "notices.revokedTitle": "Link no longer available",
  "notices.revokedBody":
    "This status link has been closed or has expired. Please contact {firma} if you still need information about your move.",
  "notices.waQuestions": "Questions? Message us on WhatsApp",
  "notices.disabledTitle": "Currently unavailable",
  "notices.disabledBody":
    "The status portal is temporarily unreachable. Your order continues as normal regardless.",
  "notices.errorTitle": "That did not work just now.",
  "notices.errorBody": "Please reload the page. None of your data has been lost.",
  "notices.errorRetry": "Try again",
  "notices.loading": "Loading",

  // ── Page metadata / link preview ─────────────────────────────────────────
  "meta.fallbackTitle": "Order",
  "meta.fallbackDescription": "Status, offer and order confirmation.",
  "meta.title": "{firma} · Order {dealNumber}",
  "meta.descriptionNamed":
    "Order {dealNumber} for {name}: offer, status and confirmation.",
  "meta.description": "Order {dealNumber}: offer, status and confirmation.",

  // ── WhatsApp ─────────────────────────────────────────────────────────────
  "whatsapp.defaultLabel": "Message us on WhatsApp",

  // ── Errors ───────────────────────────────────────────────────────────────
  "errors.generic": "Something went wrong. Please try again.",
  "errors.connection": "Connection error. Please try again.",
  "errors.noConnection": "No connection. Please try again.",
  "errors.revoked": "This link is no longer active.",
  "errors.notFound": "Link not found.",
  "errors.missingAcknowledgement": "Please confirm all the required points.",
  "errors.widerrufRequired":
    "For dates within 14 days, the waiver of the right of withdrawal is required.",
  "errors.noQuotation":
    "There is no offer at the moment. Please get in touch with us.",
  "errors.offerExpired":
    "This offer has since expired. Send us a quick message — we will check availability and send you an updated offer.",
  "errors.packageUnavailable":
    "This option is no longer available. Please reload the page.",
  "errors.alreadyAccepted":
    "The offer has already been accepted as binding. Please contact us to make a change.",
  "errors.noOperatingCompany": "This order has not been fully assigned yet.",
  "errors.dateUnavailable":
    "This date is no longer available. Please reload the page.",
  "errors.invalidSlot": "Invalid selection. Please try again.",
  "errors.invalidEmail": "Please enter a valid email address.",
  "errors.relayNotAllowed":
    "That address is only a forwarding link. Please give us your real address.",
  "errors.noContactProfile":
    "There is no contact profile at the moment. Please get in touch with your contact.",
  "errors.describeRequest": "Please describe your request briefly.",
  "errors.rateLimited":
    "You have already sent several requests. We will get back to you as soon as possible.",
  "errors.sendFailed": "Could not be sent. Please try again.",
  "errors.ratingRequired": "Please give at least one rating.",
  "errors.ratingFailed": "The rating could not be saved.",
};
