import {
  pgTable,
  pgEnum,
  text,
  integer,
  boolean,
  numeric,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspace";
import { records } from "./records";
import { inboxMessageAttachments } from "./inbox";

// ─── Umzugs-Inventar (AI-Umzugsanalyse Phase 2) ───────────────────────────────
// Strukturierte Item-Liste pro Deal — ersetzt perspektivisch das Freitext-Feld
// `inventory_notes` als Quelle für Angebot, Zeitschätzung (Volumen) und die
// Auftragsanweisung (Phase 3: was mitkommt und was NICHT). Zeilen entstehen
// aus der Chat-Extraktion, der Foto-Analyse oder von Hand; `source` +
// `confidence` machen die Herkunft sichtbar, damit der Operator KI-Zeilen von
// bestätigten unterscheiden kann.

export const inventorySourceEnum = pgEnum("inventory_source", [
  "chat", // KI-Extraktion aus dem Gesprächsverlauf
  "foto", // KI-Foto-Analyse (Phase 2b)
  "operator", // von Hand angelegt/bestätigt — wird von Re-Extraktionen NIE überschrieben
]);

export const inventorySizeClassEnum = pgEnum("inventory_size_class", [
  "klein", // Karton-Format, trägt eine Person nebenbei
  "mittel", // Stuhl, Regal, Nachttisch
  "gross", // Sofa, Schrank, Bett
  "sperrig", // Klavier, Schrankwand, US-Kühlschrank — Spezialfall fürs Equipment
]);

export const inventoryConfidenceEnum = pgEnum("inventory_confidence", [
  "hoch",
  "mittel",
  "niedrig",
]);

export const dealInventoryItems = pgTable(
  "deal_inventory_items",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    dealRecordId: text("deal_record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Freitext-Kategorie in Deutsch (Möbel, Elektrogerät, Karton, Pflanze, …) —
    // bewusst kein Enum: die KI liefert natürliche Kategorien, das UI gruppiert.
    category: text("category"),
    quantity: integer("quantity").notNull().default(1),
    sizeClass: inventorySizeClassEnum("size_class"),
    heavyFlag: boolean("heavy_flag").notNull().default(false),
    fragileFlag: boolean("fragile_flag").notNull().default(false),
    // Muss zerlegt werden (Schrank, Bett) — fließt in Equipment + Zeitschätzung.
    disassemblyRequired: boolean("disassembly_required").notNull().default(false),
    // false = ausdrücklich NICHT mitnehmen (bleibt / wird entsorgt) — die
    // Negativliste ist für die Auftragsanweisung genauso wichtig wie die Positivliste.
    moveFlag: boolean("move_flag").notNull().default(true),
    // Kundenfoto, auf dem das Item zu sehen ist (Phase 2b Matching).
    photoAttachmentId: text("photo_attachment_id").references(
      () => inboxMessageAttachments.id,
      { onDelete: "set null" }
    ),
    // Grobe Maße als Anzeige-String ("ca. 200×60×220 cm") — immer Schätzung.
    dimensionsEstimate: text("dimensions_estimate"),
    volumeCbmEstimate: numeric("volume_cbm_estimate"),
    confidence: inventoryConfidenceEnum("confidence"),
    source: inventorySourceEnum("source").notNull().default("chat"),
    // KI-Entscheidung: wichtig genug, um den Kunden um ein Foto zu bitten —
    // Kleinkram bleibt false und erzeugt keine Nachfrage (Phase 2b Frage-Chips).
    needsPhoto: boolean("needs_photo").notNull().default(false),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("deal_inventory_deal_idx").on(table.dealRecordId),
    index("deal_inventory_workspace_idx").on(table.workspaceId),
  ]
);
