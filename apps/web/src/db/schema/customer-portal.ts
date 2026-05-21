import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspace";
import { records } from "./records";
import { employees } from "./employees";
import { users } from "./auth";

// ─── Operating-Company Portal Settings ────────────────────────────────────────
// One row per operating-company record (e.g. Kottke, Ceylan, future firmas).
// Lives in the customer-portal schema file because it's portal-specific config
// that doesn't belong in the EAV records system. Admin manages from
// /settings/customer-portal.

export const operatingCompanyPortalSettings = pgTable(
  "operating_company_portal_settings",
  {
    operatingCompanyRecordId: text("operating_company_record_id")
      .primaryKey()
      .references(() => records.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),

    // Feature toggle — when false, no customer link is auto-created for this
    // OC's deals and existing links return a "feature disabled" message.
    enabled: boolean("enabled").notNull().default(true),

    // Custom subdomain, e.g. "status.kottke-umzuege.de". Unique across the
    // whole workspace so different OCs can't accidentally claim the same host.
    customDomain: text("custom_domain"),

    // ── Domain / Vercel verification state ───────────────────────────────
    /**
     * State machine:
     *   unconfigured  — no domain saved
     *   pending_dns   — domain saved, DNS not yet resolving correctly
     *   pending_ssl   — DNS OK, Vercel still provisioning the certificate
     *   verified      — domain reachable over HTTPS, Vercel verified
     *   error         — last check failed; see domainLastCheckError
     */
    domainVerificationState: text("domain_verification_state")
      .notNull()
      .default("unconfigured"),
    domainAddedToVercelAt: timestamp("domain_added_to_vercel_at"),
    domainVerifiedAt: timestamp("domain_verified_at"),
    domainLastCheckedAt: timestamp("domain_last_checked_at"),
    domainLastCheckError: text("domain_last_check_error"),
    /**
     * Raw verification records the Vercel API returned (TXT challenges, etc.).
     * Shape: Array<{ type, domain, value, reason? }>.
     */
    vercelVerification: jsonb("vercel_verification"),

    // ── Branding ─────────────────────────────────────────────────────────
    /** Customer-facing display name. Falls back to OC record name. */
    displayName: text("display_name"),
    /** Hex without leading #. */
    primaryColor: text("primary_color"),
    logoUrl: text("logo_url"),
    footerText: text("footer_text"),

    // ── Contact / review ─────────────────────────────────────────────────
    googleReviewUrl: text("google_review_url"),
    /** E.164 without leading +. */
    whatsappNumberE164: text("whatsapp_number_e164"),

    // ── Payment defaults ─────────────────────────────────────────────────
    bankIban: text("bank_iban"),
    bankBic: text("bank_bic"),
    bankHolder: text("bank_holder"),
    /** Either an email or a paypal.me handle. */
    paypalHandle: text("paypal_handle"),

    // ── AGB ──────────────────────────────────────────────────────────────
    /**
     * Stored on every kva_confirmation as legal evidence of which AGB
     * version the customer accepted. Update when you change the AGB text.
     */
    agbVersion: text("agb_version"),
    agbPdfUrl: text("agb_pdf_url"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("op_portal_settings_workspace_idx").on(table.workspaceId),
    uniqueIndex("op_portal_settings_custom_domain_idx").on(table.customDomain),
  ]
);

// ─── Customer Status Links ────────────────────────────────────────────────────
// One row per deal. Public, token-scoped URL the customer can revisit through
// every stage of the move. Auto-created when a quotation is saved.

export const customerStatusLinks = pgTable(
  "customer_status_links",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    dealRecordId: text("deal_record_id")
      .notNull()
      .unique()
      .references(() => records.id, { onDelete: "cascade" }),
    /** 32 url-safe base64 chars = 192 bits of randomness. Unguessable. */
    token: text("token").notNull().unique(),
    /** Operator can revoke a link without deleting the row (audit trail). */
    revokedAt: timestamp("revoked_at"),
    /** Optional auto-expiry (e.g. 60 days after move). Null = no expiry. */
    expiresAt: timestamp("expires_at"),
    /** Cheap usage stats — surfaced in the operator's share panel. */
    firstViewedAt: timestamp("first_viewed_at"),
    lastViewedAt: timestamp("last_viewed_at"),
    viewCount: integer("view_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("customer_status_links_workspace_idx").on(table.workspaceId),
    index("customer_status_links_token_idx").on(table.token),
  ]
);

// ─── KVA Confirmations ────────────────────────────────────────────────────────
// Immutable evidence that the customer accepted a specific offer. The
// quotationSnapshot column is the legal record — never overwritten, even if
// the underlying quotation is later edited internally.

export const kvaConfirmations = pgTable(
  "kva_confirmations",
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
    customerLinkId: text("customer_link_id")
      .notNull()
      .references(() => customerStatusLinks.id, { onDelete: "cascade" }),
    /** Full snapshot of price + line items + notes at acceptance time. JSONB. */
    quotationSnapshot: jsonb("quotation_snapshot").notNull(),
    confirmedTotalCents: integer("confirmed_total_cents").notNull(),
    /** e.g. "kottke-2026-01" — links to a versioned AGB document on file. */
    agbVersionAccepted: text("agb_version_accepted").notNull(),
    /** § 356 Abs. 4 BGB — required when the move is < 14 days away. */
    widerrufVerzichtAccepted: boolean("widerruf_verzicht_accepted")
      .notNull()
      .default(false),
    ipAddress: text("ip_address").notNull(),
    userAgent: text("user_agent").notNull(),
    /** Optional self-typed full name. Strengthens evidence. */
    acceptedFullName: text("accepted_full_name"),
    signedAt: timestamp("signed_at").notNull().defaultNow(),
  },
  (table) => [
    index("kva_confirmations_deal_idx").on(table.dealRecordId),
    index("kva_confirmations_link_idx").on(table.customerLinkId),
  ]
);

// ─── Move Time Entries ────────────────────────────────────────────────────────
// Three timestamps the operator clicks during a move. Drives Stage-3 visibility
// (departureAt → unlock live view; finishedAt → flip to Stage 4).

export const moveTimeEntries = pgTable("move_time_entries", {
  dealRecordId: text("deal_record_id")
    .primaryKey()
    .references(() => records.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  departureAt: timestamp("departure_at"),
  onsiteAt: timestamp("onsite_at"),
  finishedAt: timestamp("finished_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Customer Employee Ratings ────────────────────────────────────────────────
// Stage-4 crew rating. One row per (deal, employee) submission.

export const customerEmployeeRatings = pgTable(
  "customer_employee_ratings",
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
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** 1-5 stars. */
    stars: integer("stars").notNull(),
    comment: text("comment"),
    /** Where the customer was when they rated (IP-based, optional). */
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("customer_employee_ratings_deal_employee_idx").on(
      table.dealRecordId,
      table.employeeId
    ),
    index("customer_employee_ratings_employee_idx").on(table.employeeId),
  ]
);
