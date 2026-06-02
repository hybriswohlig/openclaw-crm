import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  real,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaces } from "./workspace";
import { records } from "./records";
import { users } from "./auth";

// ─── Identity graph (KOT-IDENTITY) ────────────────────────────────────────────
// One golden person (a `people` record) carries many channel identifiers
// (person_identifiers) and a merge ledger (person_merge_edges). HARD kinds
// (phone, email) participate in a partial UNIQUE index and in the D1 silent
// auto-merge; SOFT kinds (relay, pseudonym, names, lid) are stored for lineage
// and the async matcher but never auto-merge.

export const personIdentifierKindEnum = pgEnum("person_identifier_kind", [
  "phone", // HARD — canonical E.164
  "email", // HARD — lowercased + trimmed
  "ka_relay_email", // Kleinanzeigen rotating relay — not a mailable identity
  "ka_pseudonym", // Kleinanzeigen display pseudonym
  "wa_name", // WhatsApp pushName
  "wa_lid", // Baileys @lid — not a phone number
]);

export const personIdentifierSourceEnum = pgEnum("person_identifier_source", [
  "email",
  "kleinanzeigen",
  "whatsapp",
  "sms",
  "operator", // operator-pasted (e.g. a phone typed into a KA thread)
  "import", // backfill / immoscout / csv import
]);

export const personIdentifierTrustEnum = pgEnum("person_identifier_trust", [
  "verified", // channel-authenticated (the WhatsApp wa_id, a real email From)
  "operator", // a human typed/pasted it
  "claimed", // self-asserted, unverified
]);

export const personMergeMethodEnum = pgEnum("person_merge_method", [
  "deterministic", // D1 hard-key auto-merge
  "suggested", // soft Fellegi-Sunter candidate accepted by an operator
  "manual", // operator-initiated merge with no prior suggestion
]);

export const personMergeStatusEnum = pgEnum("person_merge_status", [
  "suggested", // in the queue, awaiting an operator decision
  "applied", // merge performed (deterministic rows are born here)
  "rejected", // operator dismissed the suggestion (no merge happened)
  "reverted", // a previously-applied merge was split back out via the snapshot
]);

// ─── person_identifiers ───────────────────────────────────────────────────────
export const personIdentifiers = pgTable(
  "person_identifiers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // The people record this identifier currently belongs to. A merge rewrites
    // this to the survivor (UPDATE), it never relies on the cascade.
    personRecordId: text("person_record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    kind: personIdentifierKindEnum("kind").notNull(),
    // Exactly as observed on the wire. Never used for equality; kept for audit.
    valueRaw: text("value_raw").notNull(),
    // Canonicalized comparison key. phone → E.164, email → lowercased+trimmed.
    // Nullable for soft kinds that fail to canonicalize; HARD kinds must be
    // non-null (enforced by app code + the partial unique index below).
    valueCanonical: text("value_canonical"),
    source: personIdentifierSourceEnum("source").notNull(),
    trust: personIdentifierTrustEnum("trust").notNull().default("claimed"),
    firstSeen: timestamp("first_seen").notNull().defaultNow(),
    lastSeen: timestamp("last_seen").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("person_identifiers_workspace_idx").on(table.workspaceId),
    index("person_identifiers_person_idx").on(table.personRecordId),
    index("person_identifiers_canonical_idx").on(
      table.workspaceId,
      table.kind,
      table.valueCanonical
    ),
    // HARD-KEY uniqueness, phone/email + non-null canonical only. A second
    // person carrying the same E.164 is impossible once the substrate is clean;
    // a collision on insert is the D1 silent-merge trigger. Safe to ship in
    // 0030 because the table is brand new (empty).
    uniqueIndex("person_identifiers_hardkey_uniq")
      .on(table.workspaceId, table.kind, table.valueCanonical)
      .where(
        sql`${table.kind} in ('phone','email') and ${table.valueCanonical} is not null`
      ),
  ]
);

// ─── person_merge_edges ───────────────────────────────────────────────────────
// The merge ledger. A deterministic D1 merge inserts method='deterministic',
// status='applied'. The async matcher inserts method='suggested',
// status='suggested'. splitPersons sets status='reverted'. The snapshot column
// holds the pre-merge lineage for a lossless un-merge (D3).
export const personMergeEdges = pgTable(
  "person_merge_edges",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // Records are soft-deleted (not hard-deleted) on merge, so these FKs hold.
    survivorRecordId: text("survivor_record_id")
      .notNull()
      .references(() => records.id),
    absorbedRecordId: text("absorbed_record_id")
      .notNull()
      .references(() => records.id),
    method: personMergeMethodEnum("method").notNull(),
    status: personMergeStatusEnum("status").notNull(),
    // Fellegi-Sunter posterior for suggested rows; 1.0 for deterministic.
    confidence: real("confidence"),
    // Per-signal scoring inputs (weights, JW name score, temporal decay, ad_id,
    // rare-token overlap, vetoes). Lets the UI explain a suggestion and lets
    // active learning re-tune without re-deriving from raw messages.
    signals: jsonb("signals").$type<Record<string, unknown>>().notNull().default({}),
    // Operator-facing evidence: which conversations/messages, the pasted phone
    // that bridged the link. Distinct from `signals` (scores).
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    // PRE-MERGE LINEAGE for lossless split. Captures, for the absorbed record,
    // its prior identifier ownership, the record_value rows + referenced ids it
    // owned, the inbox_contacts pointers, the deal blast-radius rows rewritten,
    // and the AI state of affected conversations. splitPersons replays this.
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    // Set when an operator accepts/rejects a suggestion; equals created_at for
    // deterministic rows (decided at insert).
    decidedAt: timestamp("decided_at"),
    revertedAt: timestamp("reverted_at"),
  },
  (table) => [
    index("person_merge_edges_workspace_idx").on(table.workspaceId),
    index("person_merge_edges_survivor_idx").on(table.survivorRecordId),
    index("person_merge_edges_absorbed_idx").on(table.absorbedRecordId),
    index("person_merge_edges_status_idx").on(table.workspaceId, table.status),
    // At most one SUGGESTED row per unordered pair per workspace (no duplicate
    // suggestions). applied/reverted rows are exempt so a pair can be merged,
    // split, and re-merged over time. The matcher stores the pair
    // lexicographically as a dedup placeholder; the accept path passes the
    // operator-chosen survivor/absorbed direction into mergePersons.
    uniqueIndex("person_merge_edges_suggested_pair_uniq")
      .on(table.workspaceId, table.survivorRecordId, table.absorbedRecordId)
      .where(sql`${table.status} = 'suggested'`),
  ]
);
