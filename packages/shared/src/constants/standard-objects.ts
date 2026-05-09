import type { AttributeType } from "./attribute-types";

export interface StandardAttribute {
  slug: string;
  title: string;
  type: AttributeType;
  isSystem: boolean;
  isRequired: boolean;
  isUnique: boolean;
  isMultiselect: boolean;
  config?: Record<string, unknown>;
  /** For `select` attributes: default options when seeding a workspace */
  selectOptions?: { title: string; color?: string }[];
  /**
   * For `status` attributes: default statuses when seeding a workspace.
   * The legacy `deals.stage` attribute is still seeded from DEAL_STAGES;
   * any other status attribute defines its statuses inline here.
   */
  statuses?: { title: string; color?: string; sortOrder?: number; isActive?: boolean; celebrationEnabled?: boolean }[];
}

export interface StandardObject {
  slug: string;
  singularName: string;
  pluralName: string;
  icon: string;
  isAlwaysOn: boolean;
  attributes: StandardAttribute[];
}

export const STANDARD_OBJECTS: StandardObject[] = [
  {
    slug: "people",
    singularName: "Person",
    pluralName: "People",
    icon: "users",
    isAlwaysOn: true,
    attributes: [
      { slug: "name", title: "Name", type: "personal_name", isSystem: true, isRequired: true, isUnique: false, isMultiselect: false },
      { slug: "email_addresses", title: "Email Addresses", type: "email_address", isSystem: true, isRequired: false, isUnique: true, isMultiselect: true },
      { slug: "phone_numbers", title: "Phone Numbers", type: "phone_number", isSystem: true, isRequired: false, isUnique: false, isMultiselect: true },
      { slug: "job_title", title: "Job Title", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "company", title: "Company", type: "record_reference", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false, config: { targetObjectSlug: "companies" } },
      { slug: "location", title: "Location", type: "location", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      {
        slug: "lead_source",
        title: "Lead source",
        type: "select",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: false,
        selectOptions: [
          { title: "ImmobilienScout", color: "#f97316" },
          { title: "Check24", color: "#0369a1" },
          { title: "WhatsApp / Website", color: "#16a34a" },
          { title: "Kleinanzeigen", color: "#ca8a04" },
          { title: "Introduced by others", color: "#7c3aed" },
        ],
      },
      { slug: "description", title: "Description", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
    ],
  },
  {
    slug: "companies",
    singularName: "Company",
    pluralName: "Companies",
    icon: "building-2",
    isAlwaysOn: true,
    attributes: [
      { slug: "name", title: "Name", type: "text", isSystem: true, isRequired: true, isUnique: true, isMultiselect: false },
      { slug: "domains", title: "Domains", type: "domain", isSystem: true, isRequired: false, isUnique: true, isMultiselect: true },
      { slug: "description", title: "Description", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "team", title: "Team", type: "record_reference", isSystem: true, isRequired: false, isUnique: false, isMultiselect: true, config: { targetObjectSlug: "people" } },
      { slug: "primary_location", title: "Primary Location", type: "location", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      {
        slug: "lead_source",
        title: "Lead source",
        type: "select",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: false,
        selectOptions: [
          { title: "ImmobilienScout", color: "#f97316" },
          { title: "Check24", color: "#0369a1" },
          { title: "WhatsApp / Website", color: "#16a34a" },
          { title: "Kleinanzeigen", color: "#ca8a04" },
          { title: "Introduced by others", color: "#7c3aed" },
        ],
      },
      { slug: "categories", title: "Categories", type: "select", isSystem: true, isRequired: false, isUnique: false, isMultiselect: true },
    ],
  },
  {
    slug: "operating_companies",
    singularName: "Operating company",
    pluralName: "Operating companies",
    icon: "truck",
    isAlwaysOn: true,
    attributes: [
      {
        slug: "name",
        title: "Name",
        type: "text",
        isSystem: true,
        isRequired: true,
        isUnique: true,
        isMultiselect: false,
      },
      {
        slug: "notes",
        title: "Notes",
        type: "text",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: false,
      },
    ],
  },
  {
    slug: "deals",
    singularName: "Lead",
    pluralName: "Leads",
    icon: "handshake",
    isAlwaysOn: true,
    attributes: [
      { slug: "name", title: "Name", type: "text", isSystem: true, isRequired: true, isUnique: false, isMultiselect: false },
      {
        slug: "operating_company",
        title: "Receiving company",
        type: "record_reference",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: false,
        config: { targetObjectSlug: "operating_companies" },
      },
      { slug: "stage", title: "Stage", type: "status", isSystem: true, isRequired: true, isUnique: false, isMultiselect: false },
      { slug: "value", title: "Quote value", type: "currency", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      {
        slug: "expected_close_date",
        title: "Expected decision date",
        type: "date",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: false,
      },
      { slug: "move_date", title: "Move date", type: "date", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "move_from_address", title: "Abholadresse", type: "location", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "move_to_address", title: "Zieladresse", type: "location", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "floors_from", title: "Stockwerk (Abholung)", type: "number", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "floors_to", title: "Stockwerk (Ziel)", type: "number", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      {
        slug: "elevator_from",
        title: "Zugang Abholung",
        type: "select",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: false,
        selectOptions: [
          { title: "Aufzug", color: "#16a34a" },
          { title: "Treppe", color: "#ea580c" },
          { title: "Erdgeschoss", color: "#0ea5e9" },
          { title: "Nicht nötig (Einfamilienhaus)", color: "#6366f1" },
        ],
      },
      {
        slug: "elevator_to",
        title: "Zugang Ziel",
        type: "select",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: false,
        selectOptions: [
          { title: "Aufzug", color: "#16a34a" },
          { title: "Treppe", color: "#ea580c" },
          { title: "Erdgeschoss", color: "#0ea5e9" },
          { title: "Nicht nötig (Einfamilienhaus)", color: "#6366f1" },
        ],
      },
      {
        slug: "company",
        title: "Client company",
        type: "record_reference",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: false,
        config: { targetObjectSlug: "companies" },
      },
      { slug: "associated_people", title: "Associated People", type: "record_reference", isSystem: true, isRequired: false, isUnique: false, isMultiselect: true, config: { targetObjectSlug: "people" } },
      {
        slug: "inventory_notes",
        title: "Inventory / goods (notes)",
        type: "text",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: false,
      },
      {
        slug: "moving_lead_payload",
        title: "Moving lead (structured import)",
        type: "json",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: false,
        config: {
          description:
            "ImmobilienScout / IS24-style moving lead JSON (LeadType, addresses, UGL, dates, etc.). Optional; use inventory notes for free text.",
        },
      },
      { slug: "owner", title: "Owner", type: "actor_reference", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      // Stamps for the n8n insights auto-loop and reminder bot. Read by external orchestration to gate work.
      { slug: "last_insights_at", title: "Last KI-Analyse", type: "timestamp", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "last_reminder_at", title: "Last reminder sent", type: "timestamp", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },

      // ── Post-move reviews engine (KOT-603 / KOT-614) ────────────
      // Trigger anchor: set by the crew lead at sign-off. The 15-min cron
      // job ([KOT-622]) selects deals whose move_completed_at falls in the
      // 4–24 h send window and runs the negative-experience valve before
      // dispatching an SMS review request.
      { slug: "move_completed_at", title: "Move completed at", type: "timestamp", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "internal_quality_rating", title: "Internal quality rating", type: "rating", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "internal_quality_notes", title: "Internal quality notes", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "crew_positive_note", title: "Crew positive note (Variant B)", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      {
        slug: "review_request_status",
        title: "Review request status",
        type: "status",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: false,
        statuses: [
          { title: "not_due", color: "#94a3b8", sortOrder: 0, isActive: true },
          { title: "scheduled", color: "#6366f1", sortOrder: 1, isActive: true },
          { title: "sent_sms", color: "#0ea5e9", sortOrder: 2, isActive: true },
          // sent_whatsapp is reserved for Phase 2 (KOT-618); Phase 1 is SMS-only.
          { title: "sent_whatsapp", color: "#22c55e", sortOrder: 3, isActive: true },
          { title: "clicked", color: "#a855f7", sortOrder: 4, isActive: true },
          { title: "review_left", color: "#15803d", sortOrder: 5, isActive: false, celebrationEnabled: true },
          { title: "complaint_routed", color: "#dc2626", sortOrder: 6, isActive: false },
          { title: "failed", color: "#ef4444", sortOrder: 7, isActive: false },
          { title: "suppressed", color: "#64748b", sortOrder: 8, isActive: false },
        ],
      },
      {
        slug: "review_request_variant",
        title: "Review request variant",
        type: "select",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: false,
        selectOptions: [
          { title: "A", color: "#6366f1" },
          { title: "B", color: "#a855f7" },
        ],
      },
      { slug: "review_request_sent_at", title: "Review request sent at", type: "timestamp", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "review_request_clicked_at", title: "Review request clicked at", type: "timestamp", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "review_request_left_at", title: "Review left at", type: "timestamp", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "review_request_attempt_count", title: "Review request attempts", type: "number", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      {
        slug: "review_destination",
        title: "Review destination",
        type: "select",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: false,
        selectOptions: [
          { title: "google_kottke", color: "#16a34a" },
          { title: "google_ceylan", color: "#0ea5e9" },
          { title: "trustpilot_kottke", color: "#00b67a" },
        ],
      },
      {
        slug: "customer_locale",
        title: "Customer locale",
        type: "select",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: false,
        selectOptions: [
          { title: "de", color: "#000000" },
          { title: "en", color: "#1e3a8a" },
        ],
      },
      { slug: "complaint_keywords_hit", title: "Complaint keywords hit", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "do_not_contact_review", title: "Do not contact for reviews", type: "checkbox", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      // DSGVO consent gate (CEO default 3 on KOT-603). Cron job filters
      // review_contact_consent_at IS NOT NULL — booking-form checkbox
      // ([KOT-620]) writes the timestamp on submit.
      { slug: "review_contact_consent_at", title: "Review contact consent at", type: "timestamp", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      {
        slug: "brand",
        title: "Brand",
        type: "select",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: false,
        selectOptions: [
          { title: "kottke", color: "#16a34a" },
          { title: "ceylan", color: "#0ea5e9" },
        ],
      },
    ],
  },
  {
    slug: "auftraege",
    singularName: "Auftrag",
    pluralName: "Aufträge",
    icon: "clipboard-list",
    isAlwaysOn: true,
    attributes: [
      { slug: "name", title: "Auftrag", type: "text", isSystem: true, isRequired: true, isUnique: false, isMultiselect: false },
      {
        slug: "deal",
        title: "Deal",
        type: "record_reference",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: false,
        config: { targetObjectSlug: "deals" },
      },
      {
        slug: "operating_company",
        title: "Ausführende Firma",
        type: "record_reference",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: false,
        config: { targetObjectSlug: "operating_companies" },
      },
      // (Mitarbeiter-Zuweisung läuft über die `dealEmployees`-Tabelle —
      // single source of truth, geteilt mit Operations + Financials.)

      // ── Logistik ────────────────────────────────────────────────
      {
        slug: "transporter",
        title: "Transporter",
        type: "select",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: false,
        selectOptions: [
          { title: "Auto", color: "#22c55e" },
          { title: "Mercedes Sprinter kurz", color: "#0ea5e9" },
          { title: "Mercedes Sprinter lang", color: "#6366f1" },
          { title: "Peugeot Boxer 3,5 t", color: "#ea580c" },
        ],
      },
      { slug: "worker_count", title: "Anzahl Arbeiter", type: "number", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "time_window_start", title: "Start (geplant)", type: "timestamp", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "time_window_end", title: "Ende (geplant)", type: "timestamp", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "parking_halteverbot_needed", title: "Halteverbot benötigt", type: "checkbox", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "walking_distance_from_m", title: "Laufweg Abholung (m)", type: "number", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "walking_distance_to_m", title: "Laufweg Ziel (m)", type: "number", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },

      // ── Umfang ──────────────────────────────────────────────────
      { slug: "volume_cbm", title: "Volumen (m³)", type: "number", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "boxes_needed", title: "Kartons benötigt", type: "number", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "dismantling_required", title: "Demontage erforderlich", type: "checkbox", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "packing_service", title: "Einpackservice", type: "checkbox", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "piano_transport", title: "Klaviertransport", type: "checkbox", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "disposal_required", title: "Sperrmüll / Entsorgung", type: "checkbox", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "storage_required", title: "Einlagerung", type: "checkbox", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },

      // ── Werkzeug / Material ─────────────────────────────────────
      {
        slug: "equipment_needed",
        title: "Werkzeug / Material",
        type: "select",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: true,
        selectOptions: [
          { title: "Sackkarre", color: "#6366f1" },
          { title: "Möbelhund", color: "#8b5cf6" },
          { title: "Gurte", color: "#a855f7" },
          { title: "Decken", color: "#ec4899" },
          { title: "Werkzeugkoffer", color: "#f43f5e" },
          { title: "Kleiderboxen", color: "#f97316" },
          { title: "Folie / Stretch", color: "#eab308" },
          { title: "Leiter", color: "#84cc16" },
          { title: "Rampe", color: "#22c55e" },
          { title: "Klaviergurt", color: "#14b8a6" },
        ],
      },

      // ── Kontakte am Tag ─────────────────────────────────────────
      { slug: "contact_pickup_name", title: "Kontakt Abholort (Name)", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "contact_pickup_phone", title: "Kontakt Abholort (Telefon)", type: "phone_number", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "contact_dropoff_name", title: "Kontakt Zielort (Name)", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "contact_dropoff_phone", title: "Kontakt Zielort (Telefon)", type: "phone_number", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },

      // ── Zahlung ─────────────────────────────────────────────────
      {
        slug: "payment_method",
        title: "Zahlungsart",
        type: "select",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: false,
        selectOptions: [
          { title: "Bar", color: "#22c55e" },
          { title: "Überweisung", color: "#0ea5e9" },
          { title: "Bereits bezahlt", color: "#6366f1" },
        ],
      },
      { slug: "amount_outstanding", title: "Offener Betrag", type: "currency", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },

      // ── Sonderwünsche / Checkliste / Notizen ────────────────────
      { slug: "special_requests", title: "Sonderwünsche", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      {
        slug: "checklist",
        title: "Checkliste",
        type: "json",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: false,
        config: {
          description:
            "Array of { key, label, done, note? } items. Default template seeded on auftrag creation; workers tick off before / during / after the job.",
        },
      },
      { slug: "notes", title: "Notizen", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
    ],
  },
];

/**
 * Default checklist template seeded when a new Auftrag is created.
 * Items are { key, label, done } — `done` starts false; workers tick them off.
 */
export const DEFAULT_AUFTRAG_CHECKLIST: { key: string; label: string; done: boolean }[] = [
  { key: "halteverbot_beantragt", label: "Halteverbot beantragt (falls nötig)", done: false },
  { key: "kartons_geliefert", label: "Kartons geliefert", done: false },
  { key: "werkzeug_eingepackt", label: "Werkzeug eingepackt", done: false },
  { key: "lkw_getankt", label: "LKW getankt", done: false },
  { key: "mitarbeiter_informiert", label: "Mitarbeiter informiert", done: false },
  { key: "anfahrt_geklaert", label: "Anfahrt & Parksituation geklärt", done: false },
  { key: "zahlung_bestaetigt", label: "Zahlung bestätigt", done: false },
  { key: "uebergabeprotokoll", label: "Übergabeprotokoll unterschrieben", done: false },
];

/** Pipeline stages for moving-company inquiries through payment */
export const DEAL_STAGES = [
  { title: "Inquiry", color: "#6366f1", sortOrder: 0, isActive: true, celebrationEnabled: false },
  { title: "Contacted", color: "#7c3aed", sortOrder: 1, isActive: true, celebrationEnabled: false },
  { title: "Information gathered", color: "#8b5cf6", sortOrder: 2, isActive: true, celebrationEnabled: false },
  { title: "Quoted", color: "#a855f7", sortOrder: 3, isActive: true, celebrationEnabled: false },
  { title: "Planned", color: "#d946ef", sortOrder: 4, isActive: true, celebrationEnabled: false },
  { title: "Done", color: "#22c55e", sortOrder: 5, isActive: false, celebrationEnabled: true },
  { title: "Paid", color: "#15803d", sortOrder: 6, isActive: false, celebrationEnabled: false },
  { title: "Lost", color: "#ef4444", sortOrder: 7, isActive: false, celebrationEnabled: false },
];
