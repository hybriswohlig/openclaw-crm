/**
 * Lokale Testdaten für die Sichtprüfung der Akte (Plan 3, Task 10).
 *
 * Legt einen Workspace, den Nutzer Herr Testmann, zwei Betriebsgesellschaften
 * und vier Deals an:
 *   (a) Angebot, KV v2 gesendet, WhatsApp- und E-Mail-Gespräch, 3× geöffnet,
 *       offener Nachfass-Entwurf
 *   (b) Neue Anfrage ohne Gespräch
 *   (c) Durchgeführt, Rechnung, Rest 1.980 €, offene Meldung „bezahlt“
 *   (d) Verloren
 *
 * Erfundene Namen. Telefonnummern nur im Bereich +49 1550 000xxx.
 * E-Mail nur @example.com. Kanalzeilen ohne Zugangsdaten: Kanäle, Push und
 * Crons bleiben aus.
 *
 * Bricht ab, wenn die Authority von DATABASE_URL ein Komma oder mehr
 * als ein @ enthält, oder wenn postgres.js einen Host sieht, der nicht
 * 127.0.0.1 oder localhost ist.
 * Keine .env-Datei anlegen und keine Datei mit echten Zugangsdaten schreiben.
 * DATABASE_URL nur in der Shell setzen.
 *
 * Wegwerf-Datenbank im Scratchpad (Port 54331, nur TCP auf 127.0.0.1).
 * initdb-Nutzer ist postgres, derselbe Name wie in DATABASE_URL:
 *
 *   initdb -D /private/tmp/claude-501/m1c-t10-pg --username=postgres --auth=trust
 *   pg_ctl -D /private/tmp/claude-501/m1c-t10-pg -l /tmp/m1c-t10-pg.log \
 *     -o "-p 54331 -k /tmp -c listen_addresses=127.0.0.1" start
 *   createdb -h 127.0.0.1 -p 54331 -U postgres akte_testdaten
 *
 * Schema aus apps/web. drizzle-kit push legt auf einer leeren Datenbank
 * das ganze Schema an, einschließlich allem aus den Migrationen 0053 bis
 * 0058. Nichts davon muss von Hand nachgezogen werden. drizzle-kit liest
 * DATABASE_URL aus der Shell; keine .env mit echten Zugangsdaten im
 * Worktree lassen:
 *
 *   cd apps/web
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:54331/akte_testdaten \
 *     npx drizzle-kit push --force
 *
 * Danach dieses Skript:
 *
 *   cd apps/web
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:54331/akte_testdaten \
 *     npx tsx scripts/akte-testdaten.ts
 *
 * Sichtprüfung: `next dev` aus diesem Worktree, DATABASE_URL und
 * BETTER_AUTH_SECRET nur in der Shell. Anmeldung mit dem angelegten Nutzer
 * (siehe Konsolenausgabe). Kanäle, Push und Crons bleiben aus.
 *
 * Firma von (a) ist Kottke Testumzüge, damit der Nachfass-Schalter dort
 * nicht beendet ist. (b) und (c) bleiben bei Beispiel Transporte (fremde
 * Firma). (d) ist der verlorene Fall.
 */

import postgres from "postgres";

const EMAIL = "herr.testmann@example.com";
const PASSWORD = "Testdaten-Lokal-1";
const NAME = "Herr Testmann";

function abbruch(meldung: string): never {
  console.error(meldung);
  process.exit(1);
}

/** Teil zwischen "://" und dem ersten "/" oder "?". */
function autoritaet(raw: string): string | null {
  const marke = "://";
  const start = raw.indexOf(marke);
  if (start < 0) return null;
  const rest = raw.slice(start + marke.length);
  const ende = rest.search(/[/?]/);
  return ende === -1 ? rest : rest.slice(0, ende);
}

function datenbankHosts(): string[] {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    abbruch("Abbruch: DATABASE_URL fehlt. Nur eine lokale Wegwerf-Datenbank ist erlaubt.");
  }
  const teil = autoritaet(raw);
  if (teil === null) {
    abbruch("Abbruch: DATABASE_URL ist keine gültige URL.");
  }
  const atZeichen = teil.split("@").length - 1;
  if (teil.includes(",") || atZeichen > 1) {
    abbruch(
      "Abbruch: DATABASE_URL nennt mehrere Hosts oder mehrere @. Nur 127.0.0.1 oder localhost ist erlaubt."
    );
  }

  let client: postgres.Sql | undefined;
  let hosts: string[] = [];
  let ungueltig = false;
  try {
    client = postgres(raw);
    hosts = client.options.host;
  } catch {
    ungueltig = true;
  } finally {
    if (client) void client.end({ timeout: 0 });
  }
  if (ungueltig) {
    abbruch("Abbruch: DATABASE_URL ist keine gültige URL.");
  }
  const fremd = hosts.filter((host) => host !== "127.0.0.1" && host !== "localhost");
  if (hosts.length === 0 || fremd.length > 0) {
    abbruch(
      `Abbruch: DATABASE_URL zeigt auf ${hosts.join(", ") || "keinen Host"}, nicht auf 127.0.0.1 oder localhost.`
    );
  }
  return hosts;
}

datenbankHosts();

const STUFEN: Record<string, { titel: string; kategorie: string; endstufe: boolean }> = {
  Inquiry: { titel: "Neue Anfrage", kategorie: "open_new", endstufe: false },
  Contacted: { titel: "In Kontakt", kategorie: "open_engaged", endstufe: false },
  "Information gathered": { titel: "Informationen da", kategorie: "open_engaged", endstufe: false },
  Quoted: { titel: "Angebot", kategorie: "quoted", endstufe: false },
  Planned: { titel: "Geplant", kategorie: "booked", endstufe: false },
  Done: { titel: "Durchgeführt", kategorie: "done_unpaid", endstufe: true },
  Paid: { titel: "Bezahlt", kategorie: "paid", endstufe: true },
  Lost: { titel: "Verloren", kategorie: "lost", endstufe: true },
};

function adresse(line1: string, city: string, postcode: string) {
  return { line1, line2: "", city, state: "", postcode, country: "DE" };
}

async function main(): Promise<void> {
  const { randomUUID } = await import("node:crypto");
  const { and, eq } = await import("drizzle-orm");
  const { hashPassword } = await import("better-auth/crypto");
  const { db } = await import("@/db");
  const { users, accounts } = await import("@/db/schema/auth");
  const { workspaces, workspaceMembers } = await import("@/db/schema/workspace");
  const { objects, attributes, statuses, selectOptions } = await import("@/db/schema/objects");
  const { userSettings } = await import("@/db/schema/user-settings");
  const { dealCalculationVersions } = await import("@/db/schema/deal-calculation-versions");
  const { quotations } = await import("@/db/schema/quotations");
  const { customerStatusLinks } = await import("@/db/schema/customer-portal");
  const { agentDrafts } = await import("@/db/schema/agent");
  const {
    channelAccounts,
    inboxContacts,
    inboxConversations,
    inboxMessages,
  } = await import("@/db/schema/inbox");
  const { seedWorkspaceObjects } = await import("@/services/workspace");
  const { createRecord } = await import("@/services/records");
  const { upsertQuotation } = await import("@/services/quotations");
  const { createDealDocument } = await import("@/services/deal-documents");
  const { createPayment } = await import("@/services/financial");
  const { emitEvent } = await import("@/services/activity-events");
  const { ensureCustomerStatusLink } = await import("@/services/customer-portal-data");
  const { ladeZahlungsmeldungen } = await import("@/services/zahlungsmeldungen");
  const { aktualisiereWartet } = await import("@/services/wartet");

  const [vorhanden] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
  if (vorhanden) {
    throw new Error("In der Datenbank liegt schon ein Workspace. Nur eine leere Wegwerf-Datenbank verwenden.");
  }

  const [workspace] = await db
    .insert(workspaces)
    .values({ name: "Testdaten Akte", slug: "testdaten-akte", settings: {} })
    .returning();
  if (!workspace) throw new Error("Workspace wurde nicht angelegt.");
  await seedWorkspaceObjects(workspace.id);

  const stufenZeilen = await db
    .select({ id: statuses.id, title: statuses.title })
    .from(statuses)
    .innerJoin(attributes, eq(attributes.id, statuses.attributeId))
    .innerJoin(objects, eq(objects.id, attributes.objectId))
    .where(and(eq(objects.workspaceId, workspace.id), eq(objects.slug, "deals"), eq(attributes.slug, "stage")));
  for (const zeile of stufenZeilen) {
    const ziel = STUFEN[zeile.title];
    if (!ziel) continue;
    await db
      .update(statuses)
      .set({
        title: ziel.titel,
        stageCategory: ziel.kategorie,
        isTerminal: ziel.endstufe,
        isActive: true,
      })
      .where(eq(statuses.id, zeile.id));
  }

  const userId = randomUUID();
  await db.insert(users).values({
    id: userId,
    name: NAME,
    email: EMAIL,
    emailVerified: true,
    approvalStatus: "approved",
    isAppAdmin: true,
    role: "staff",
  });
  await db.insert(accounts).values({
    id: randomUUID(),
    accountId: userId,
    providerId: "credential",
    userId,
    password: await hashPassword(PASSWORD),
  });
  await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId, role: "admin" });
  await db.insert(userSettings).values({ userId, uiVersion: "neu", ansichten: {} });

  async function objektId(slug: string): Promise<string> {
    const [zeile] = await db
      .select({ id: objects.id })
      .from(objects)
      .where(and(eq(objects.workspaceId, workspace.id), eq(objects.slug, slug)))
      .limit(1);
    if (!zeile) throw new Error(`Objekt ${slug} fehlt.`);
    return zeile.id;
  }

  async function stufeId(titel: string): Promise<string> {
    const [zeile] = await db
      .select({ id: statuses.id })
      .from(statuses)
      .innerJoin(attributes, eq(attributes.id, statuses.attributeId))
      .innerJoin(objects, eq(objects.id, attributes.objectId))
      .where(
        and(
          eq(objects.workspaceId, workspace.id),
          eq(objects.slug, "deals"),
          eq(attributes.slug, "stage"),
          eq(statuses.title, titel)
        )
      )
      .limit(1);
    if (!zeile) throw new Error(`Stufe ${titel} fehlt.`);
    return zeile.id;
  }

  async function optionId(objekt: string, slug: string, titel: string): Promise<string> {
    const [zeile] = await db
      .select({ id: selectOptions.id })
      .from(selectOptions)
      .innerJoin(attributes, eq(attributes.id, selectOptions.attributeId))
      .where(and(eq(attributes.objectId, objekt), eq(attributes.slug, slug), eq(selectOptions.title, titel)))
      .limit(1);
    if (!zeile) throw new Error(`Option ${slug}/${titel} fehlt.`);
    return zeile.id;
  }

  async function datensatz(objekt: string, werte: Record<string, unknown>): Promise<string> {
    const zeile = await createRecord(objekt, werte, userId);
    if (!zeile) throw new Error("Datensatz wurde nicht angelegt.");
    return zeile.id;
  }

  const firmaObjekt = await objektId("operating_companies");
  const dealObjekt = await objektId("deals");
  const kottke = await datensatz(firmaObjekt, {
    name: "Kottke Testumzüge",
    legal_name: "Kottke Testumzüge",
    phone: "+49 1550 000101",
    whatsapp: "+49 1550 000101",
    email: "muster@example.com",
    street: "Beispielweg 1",
    postal_code: "70173",
    city: "Stuttgart",
    website: "https://muster.example.com",
  });
  const beispiel = await datensatz(firmaObjekt, {
    name: "Beispiel Transporte",
    legal_name: "Beispiel Transporte GmbH",
    phone: "+49 1550 000102",
    whatsapp: "+49 1550 000102",
    email: "transporte@example.com",
    street: "Probenstraße 2",
    postal_code: "73728",
    city: "Esslingen",
    website: "https://beispiel.example.com",
  });

  const angebotStufe = await stufeId("Angebot");
  const anfrageStufe = await stufeId("Neue Anfrage");
  const durchgefuehrtStufe = await stufeId("Durchgeführt");
  const verlorenStufe = await stufeId("Verloren");
  const quelleWhatsapp = await optionId(dealObjekt, "source_channel", "WhatsApp");
  const quelleTelefon = await optionId(dealObjekt, "source_channel", "Telefon");
  const quelleEmpfehlung = await optionId(dealObjekt, "source_channel", "Empfehlung");
  const verlustZuTeuer = await optionId(dealObjekt, "loss_reason", "zu teuer");

  const weber = await datensatz(dealObjekt, {
    name: "Familie Weber",
    stage: angebotStufe,
    operating_company: kottke,
    source_channel: quelleWhatsapp,
    zimmer: 3,
    move_date: "2026-11-20",
    first_reply_at: new Date("2026-11-04T09:15:00+01:00"),
    move_from_address: adresse("Beispielweg 12", "Stuttgart-West", "70178"),
    move_to_address: adresse("Probenstraße 4", "Esslingen", "73728"),
  });

  const v1 = randomUUID();
  const v2 = randomUUID();
  const gesperrtAm = new Date("2026-11-04T11:00:00+01:00");
  const gesendetAm = new Date("2026-11-04T11:20:00+01:00");
  await db.insert(dealCalculationVersions).values([
    {
      id: v1,
      workspaceId: workspace.id,
      dealRecordId: weber,
      version: 1,
      status: "gesperrt",
      pricingMode: "fest",
      referenceDate: "2026-11-03",
      priceCents: 175000,
      kvItems: [{ bezeichnung: "Umzug", betragCent: 175000 }],
      rechnerResult: { volumen: { nettoCbm: 32 }, preis: { selbstkosten: 1100, margeProzent: 37 } },
      lockedAt: new Date("2026-11-03T16:00:00+01:00"),
      lockedBy: userId,
      createdBy: userId,
    },
    {
      id: v2,
      workspaceId: workspace.id,
      dealRecordId: weber,
      version: 2,
      status: "gesperrt",
      pricingMode: "fest",
      referenceDate: "2026-11-04",
      priceCents: 189000,
      kvItems: [{ bezeichnung: "Umzug, 3 Zimmer", betragCent: 189000 }],
      rechnerResult: { volumen: { nettoCbm: 38 }, preis: { selbstkosten: 1240, margeProzent: 34 } },
      lockedAt: gesperrtAm,
      lockedBy: userId,
      sentAt: gesendetAm,
      sentVia: "whatsapp",
      createdBy: userId,
    },
  ]);
  await upsertQuotation(weber, {
    fixedPrice: "1890.00",
    isVariable: false,
    summary: "Umzug Stuttgart-West nach Esslingen, 3 Zimmer.",
    validUntil: "2026-11-18",
    serviceType: "move",
    lineItems: [{ type: "other", description: "Umzug, 3 Zimmer", quantity: 1, unitRate: "1890.00", sortOrder: 0 }],
  });
  await db.update(quotations).set({ calculationVersionId: v2 }).where(eq(quotations.dealRecordId, weber));

  const pdf = Buffer.from("%PDF-1.1\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
  const pdfB64 = pdf.toString("base64");
  await createDealDocument({
    workspaceId: workspace.id,
    dealRecordId: weber,
    documentType: "quotation",
    fileName: "KV-Familie-Weber-v2.pdf",
    fileSize: pdf.length,
    mimeType: "application/pdf",
    fileContent: pdfB64,
    notifyCustomer: false,
    calculationVersionId: v2,
  });

  const [waKonto] = await db
    .insert(channelAccounts)
    .values({
      workspaceId: workspace.id,
      operatingCompanyRecordId: kottke,
      channelType: "whatsapp",
      name: "Muster WhatsApp",
      address: "+491550000101",
      waDisplayPhoneNumber: "+49 1550 000101",
      waPhoneNumberId: "155000000101",
      credential: null,
      isActive: false,
    })
    .returning();
  const [mailKonto] = await db
    .insert(channelAccounts)
    .values({
      workspaceId: workspace.id,
      operatingCompanyRecordId: kottke,
      channelType: "email",
      name: "Muster Post",
      address: "anfragen@example.com",
      credential: null,
      isActive: false,
    })
    .returning();
  if (!waKonto || !mailKonto) throw new Error("Kanal wurde nicht angelegt.");

  const [kontakt] = await db
    .insert(inboxContacts)
    .values({
      workspaceId: workspace.id,
      displayName: "Familie Weber",
      email: "familie.weber@example.com",
      phone: "+491550000201",
      phoneCanonical: "+491550000201",
      emailCanonical: "familie.weber@example.com",
    })
    .returning();
  if (!kontakt) throw new Error("Kontakt wurde nicht angelegt.");

  const [waGespraech] = await db
    .insert(inboxConversations)
    .values({
      workspaceId: workspace.id,
      channelAccountId: waKonto.id,
      contactId: kontakt.id,
      externalThreadId: "+491550000201",
      status: "open",
      dealRecordId: weber,
      lastMessageAt: new Date("2026-11-06T08:40:00+01:00"),
      lastMessagePreview: "Guten Tag, anbei der Kostenvoranschlag.",
      unreadCount: 0,
    })
    .returning();
  const [mailGespraech] = await db
    .insert(inboxConversations)
    .values({
      workspaceId: workspace.id,
      channelAccountId: mailKonto.id,
      contactId: kontakt.id,
      externalThreadId: "familie.weber@example.com",
      subject: "Umzug Stuttgart-West",
      status: "open",
      dealRecordId: weber,
      lastMessageAt: new Date("2026-11-05T15:10:00+01:00"),
      lastMessagePreview: "Können Sie den Termin noch bestätigen?",
      unreadCount: 1,
    })
    .returning();
  if (!waGespraech || !mailGespraech) throw new Error("Gespräch wurde nicht angelegt.");

  await db.insert(inboxMessages).values([
    {
      workspaceId: workspace.id,
      conversationId: waGespraech.id,
      direction: "inbound",
      status: "received",
      fromAddress: "+491550000201",
      toAddress: "+491550000101",
      body: "Guten Tag, wir möchten von Stuttgart-West nach Esslingen ziehen. Drei Zimmer.",
      sentAt: new Date("2026-11-04T09:05:00+01:00"),
    },
    {
      workspaceId: workspace.id,
      conversationId: waGespraech.id,
      direction: "outbound",
      status: "sent",
      fromAddress: "+491550000101",
      toAddress: "+491550000201",
      body: "Guten Tag, anbei der Kostenvoranschlag.",
      sentAt: gesendetAm,
    },
    {
      workspaceId: workspace.id,
      conversationId: mailGespraech.id,
      direction: "inbound",
      status: "received",
      fromAddress: "familie.weber@example.com",
      toAddress: "anfragen@example.com",
      subject: "Umzug Stuttgart-West",
      body: "Können Sie den Termin noch bestätigen?",
      isRead: false,
      sentAt: new Date("2026-11-05T15:10:00+01:00"),
    },
  ]);

  await db.insert(agentDrafts).values({
    workspaceId: workspace.id,
    dealRecordId: weber,
    conversationId: waGespraech.id,
    channelAccountId: waKonto.id,
    messageClass: "followup",
    sequenceId: "nachfass",
    sequenceStep: 1,
    draftText:
      "Guten Tag, kurze Nachfrage zum Kostenvoranschlag. Melden Sie sich gern, wenn noch etwas unklar ist.",
    status: "pending",
    expiresAt: new Date("2026-11-13T12:00:00+01:00"),
  });

  const link = await ensureCustomerStatusLink({
    workspaceId: workspace.id,
    dealRecordId: weber,
    createdBy: userId,
  });
  if (!link.created || !link.token) throw new Error("Kundenlink wurde nicht angelegt.");
  await db
    .update(customerStatusLinks)
    .set({
      viewCount: 3,
      sessionCount: 3,
      firstViewedAt: new Date("2026-11-04T18:00:00+01:00"),
      lastViewedAt: new Date("2026-11-06T07:12:00+01:00"),
    })
    .where(eq(customerStatusLinks.dealRecordId, weber));

  const anfrage = await datensatz(dealObjekt, {
    name: "Herr Testmann",
    stage: anfrageStufe,
    operating_company: beispiel,
    source_channel: quelleTelefon,
    zimmer: 2,
    move_from_address: adresse("Musterstraße 8", "Tübingen", "72072"),
    move_to_address: adresse("Probenweg 3", "Reutlingen", "72764"),
  });

  const sommer = await datensatz(dealObjekt, {
    name: "Familie Sommer",
    stage: durchgefuehrtStufe,
    operating_company: beispiel,
    source_channel: quelleEmpfehlung,
    zimmer: 4,
    move_date: "2026-11-03",
    move_completed_at: new Date("2026-11-03T16:30:00+01:00"),
    rechnung_faellig_am: "2026-11-17",
    move_from_address: adresse("Beispielallee 5", "Ludwigsburg", "71638"),
    move_to_address: adresse("Musterplatz 9", "Stuttgart", "70174"),
  });
  await upsertQuotation(sommer, {
    fixedPrice: "2480.00",
    isVariable: false,
    summary: "Umzug Ludwigsburg nach Stuttgart, durchgeführt.",
    serviceType: "move",
    lineItems: [{ type: "other", description: "Umzug, 4 Zimmer", quantity: 1, unitRate: "2480.00", sortOrder: 0 }],
  });
  await createDealDocument({
    workspaceId: workspace.id,
    dealRecordId: sommer,
    documentType: "invoice",
    fileName: "RE-Familie-Sommer.pdf",
    fileSize: pdf.length,
    mimeType: "application/pdf",
    fileContent: pdfB64,
    notifyCustomer: false,
  });
  await createPayment(workspace.id, sommer, {
    date: "2026-11-01",
    amount: "500.00",
    payer: "Familie Sommer",
    paymentMethod: "bank_transfer",
    reference: "Anzahlung Testdaten",
  });
  await emitEvent({
    workspaceId: workspace.id,
    recordId: sommer,
    objectSlug: "deals",
    eventType: "customer.marked_paid",
    payload: { amountCents: 198000, variant: "final", method: "bank_transfer" },
  });
  const meldungen = await ladeZahlungsmeldungen(workspace.id, sommer);
  if (meldungen.length !== 1 || meldungen[0]?.betragCent !== 198000) {
    throw new Error("Offene Meldung „bezahlt“ fehlt.");
  }

  const probe = await datensatz(dealObjekt, {
    name: "Herr Probe",
    stage: verlorenStufe,
    operating_company: kottke,
    source_channel: quelleWhatsapp,
    loss_reason: verlustZuTeuer,
    loss_reason_note: "Testdaten: Angebot zu teuer.",
    zimmer: 1,
    move_from_address: adresse("Probenring 2", "Böblingen", "71032"),
    move_to_address: adresse("Beispielpfad 6", "Sindelfingen", "71063"),
  });

  for (const id of [weber, anfrage, sommer, probe]) {
    await aktualisiereWartet(workspace.id, id);
  }

  const ergebnis = {
    workspaceId: workspace.id,
    userId,
    email: EMAIL,
    password: PASSWORD,
    firmen: { kottke, beispiel },
    deals: {
      angebot: weber,
      anfrage,
      durchgefuehrt: sommer,
      verloren: probe,
    },
  };
  console.log("Testdaten angelegt.");
  console.log(`Anmeldung: ${EMAIL} / ${PASSWORD}`);
  console.log(JSON.stringify(ergebnis, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
