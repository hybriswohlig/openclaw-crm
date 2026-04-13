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
  selectOptions?: { title: string; color: string }[];
}

export interface StandardObject {
  slug: string;
  singularName: string;
  pluralName: string;
  icon: string;
  isAlwaysOn: boolean;
  attributes: StandardAttribute[];
}

/** Countries relevant to N&E Asia + Europe markets */
export const COUNTRY_OPTIONS = [
  // Europe
  { title: "Germany", color: "#6366f1" },
  { title: "France", color: "#7c3aed" },
  { title: "United Kingdom", color: "#0369a1" },
  { title: "Netherlands", color: "#f97316" },
  { title: "Switzerland", color: "#dc2626" },
  { title: "Belgium", color: "#ca8a04" },
  { title: "Austria", color: "#dc2626" },
  { title: "Sweden", color: "#0369a1" },
  { title: "Denmark", color: "#dc2626" },
  { title: "Norway", color: "#0369a1" },
  { title: "Finland", color: "#0369a1" },
  { title: "Poland", color: "#dc2626" },
  { title: "Italy", color: "#16a34a" },
  { title: "Spain", color: "#ca8a04" },
  { title: "Portugal", color: "#16a34a" },
  { title: "Czech Republic", color: "#0369a1" },
  // Asia
  { title: "Singapore", color: "#dc2626" },
  { title: "China", color: "#dc2626" },
  { title: "Japan", color: "#dc2626" },
  { title: "South Korea", color: "#0369a1" },
  { title: "India", color: "#f97316" },
  { title: "Taiwan", color: "#0369a1" },
  { title: "Thailand", color: "#0369a1" },
  { title: "Malaysia", color: "#16a34a" },
  { title: "Australia", color: "#16a34a" },
  { title: "Other", color: "#94a3b8" },
];

export const STANDARD_OBJECTS: StandardObject[] = [
  // ─── Contacts ────────────────────────────────────────────────────────────
  {
    slug: "people",
    singularName: "Contact",
    pluralName: "Contacts",
    icon: "users",
    isAlwaysOn: true,
    attributes: [
      { slug: "name", title: "Name", type: "personal_name", isSystem: true, isRequired: true, isUnique: false, isMultiselect: false },
      { slug: "email_addresses", title: "Email Addresses", type: "email_address", isSystem: true, isRequired: false, isUnique: true, isMultiselect: true },
      { slug: "phone_numbers", title: "Phone Numbers", type: "phone_number", isSystem: true, isRequired: false, isUnique: false, isMultiselect: true },
      { slug: "job_title", title: "Job Title", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "department", title: "Department", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "company", title: "Company", type: "record_reference", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false, config: { targetObjectSlug: "companies" } },
      { slug: "country", title: "Country", type: "select", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false, selectOptions: COUNTRY_OPTIONS },
      { slug: "linkedin", title: "LinkedIn", type: "domain", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "description", title: "Notes", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
    ],
  },

  // ─── Companies (Leads & Customers) ───────────────────────────────────────
  {
    slug: "companies",
    singularName: "Company",
    pluralName: "Companies",
    icon: "building-2",
    isAlwaysOn: true,
    attributes: [
      { slug: "name", title: "Name", type: "text", isSystem: true, isRequired: true, isUnique: true, isMultiselect: false },
      { slug: "domains", title: "Website", type: "domain", isSystem: true, isRequired: false, isUnique: true, isMultiselect: true },
      {
        slug: "status",
        title: "Status",
        type: "select",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: false,
        selectOptions: [
          { title: "Lead", color: "#6366f1" },
          { title: "Qualified Lead", color: "#8b5cf6" },
          { title: "Customer", color: "#22c55e" },
          { title: "Former Customer", color: "#94a3b8" },
          { title: "Lost", color: "#ef4444" },
        ],
      },
      {
        slug: "country",
        title: "Country",
        type: "select",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: false,
        selectOptions: COUNTRY_OPTIONS,
      },
      {
        slug: "lead_source",
        title: "Lead Source",
        type: "select",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: false,
        selectOptions: [
          { title: "Trade Fair", color: "#f97316" },
          { title: "Introduction / Referral", color: "#7c3aed" },
          { title: "Cold Approach", color: "#0369a1" },
          { title: "Own Network", color: "#16a34a" },
          { title: "Inbound / Website", color: "#ca8a04" },
        ],
      },
      {
        slug: "industry",
        title: "Industry",
        type: "select",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: false,
        selectOptions: [
          { title: "Pharma", color: "#6366f1" },
          { title: "Biotech", color: "#0891b2" },
          { title: "Medical Devices", color: "#7c3aed" },
          { title: "Life Sciences", color: "#16a34a" },
          { title: "Research / Academia", color: "#ca8a04" },
          { title: "CRO / CMO", color: "#f97316" },
          { title: "Food & Beverage", color: "#84cc16" },
          { title: "Cosmetics", color: "#ec4899" },
          { title: "Chemical", color: "#94a3b8" },
          { title: "Other", color: "#64748b" },
        ],
      },
      { slug: "primary_location", title: "Location / Address", type: "location", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "description", title: "Company Description", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "customer_needs", title: "Customer Needs / Pain Points", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "products_of_interest", title: "Products of Interest", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "estimated_quantity", title: "Estimated Quantity / Scale", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "current_supplier", title: "Current Supplier", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "decision_timeline", title: "Decision Timeline", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "owner", title: "Account Owner", type: "actor_reference", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
    ],
  },

  // ─── Leads / Pipeline ────────────────────────────────────────────────────
  {
    slug: "deals",
    singularName: "Lead",
    pluralName: "Leads",
    icon: "target",
    isAlwaysOn: true,
    attributes: [
      { slug: "name", title: "Name", type: "text", isSystem: true, isRequired: true, isUnique: false, isMultiselect: false },
      { slug: "stage", title: "Stage", type: "status", isSystem: true, isRequired: true, isUnique: false, isMultiselect: false },
      {
        slug: "company",
        title: "Company",
        type: "record_reference",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: false,
        config: { targetObjectSlug: "companies" },
      },
      {
        slug: "associated_contacts",
        title: "Contacts",
        type: "record_reference",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: true,
        config: { targetObjectSlug: "people" },
      },
      {
        slug: "country",
        title: "Country",
        type: "select",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: false,
        selectOptions: COUNTRY_OPTIONS,
      },
      { slug: "value", title: "Estimated Value (EUR)", type: "currency", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "expected_close_date", title: "Expected Close Date", type: "date", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "product_name", title: "Product / Solution", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "quantity", title: "Quantity / Volume", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "application", title: "Application / Use Case", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "technical_requirements", title: "Technical Requirements", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "competitor", title: "Competing Products", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      {
        slug: "lead_source",
        title: "Lead Source",
        type: "select",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: false,
        selectOptions: [
          { title: "Trade Fair", color: "#f97316" },
          { title: "Introduction / Referral", color: "#7c3aed" },
          { title: "Cold Approach", color: "#0369a1" },
          { title: "Own Network", color: "#16a34a" },
          { title: "Inbound / Website", color: "#ca8a04" },
        ],
      },
      { slug: "notes", title: "Notes", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "owner", title: "Owner", type: "actor_reference", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
    ],
  },
];

/**
 * BioTech lead pipeline stages.
 * Grouped into phases so the board can render group headers.
 * Customer status is tracked on the Company record, not here.
 */
export const DEAL_STAGES = [
  // ── Outreach ──
  { title: "New Lead",         color: "#6366f1", sortOrder: 0,  isActive: true,  celebrationEnabled: false },
  { title: "Email Sent",       color: "#7c3aed", sortOrder: 1,  isActive: true,  celebrationEnabled: false },
  // ── Discovery ──
  { title: "Discovery Call",   color: "#8b5cf6", sortOrder: 2,  isActive: true,  celebrationEnabled: false },
  { title: "Qualified",        color: "#a78bfa", sortOrder: 3,  isActive: true,  celebrationEnabled: false },
  // ── Proposal ──
  { title: "Proposal Sent",    color: "#d946ef", sortOrder: 4,  isActive: true,  celebrationEnabled: false },
  { title: "Quotation Sent",   color: "#e879f9", sortOrder: 5,  isActive: true,  celebrationEnabled: false },
  // ── Closing ──
  { title: "Follow-up Meeting",color: "#f97316", sortOrder: 6,  isActive: true,  celebrationEnabled: false },
  { title: "Invoice Sent",     color: "#fb923c", sortOrder: 7,  isActive: true,  celebrationEnabled: true  },
  { title: "Final Invoice",    color: "#fbbf24", sortOrder: 8,  isActive: true,  celebrationEnabled: true  },
  // ── Lost ──
  { title: "Lost",             color: "#ef4444", sortOrder: 9,  isActive: false, celebrationEnabled: false },
  { title: "On Hold",          color: "#94a3b8", sortOrder: 10, isActive: false, celebrationEnabled: false },
];

/** Stage group definitions — used by the Leads board sidebar */
export const LEAD_STAGE_GROUPS: { label: string; stages: string[]; color: string }[] = [
  { label: "Outreach",  stages: ["New Lead", "Email Sent"],                            color: "#6366f1" },
  { label: "Discovery", stages: ["Discovery Call", "Qualified"],                       color: "#8b5cf6" },
  { label: "Proposal",  stages: ["Proposal Sent", "Quotation Sent"],                   color: "#d946ef" },
  { label: "Closing",   stages: ["Follow-up Meeting", "Invoice Sent", "Final Invoice"],color: "#f97316" },
  { label: "Lost",      stages: ["Lost", "On Hold"],                                   color: "#ef4444" },
];
