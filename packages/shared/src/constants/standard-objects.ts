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
      { slug: "location", title: "Location", type: "location", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
<<<<<<< Updated upstream
      { slug: "description", title: "Description", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
=======
      { slug: "linkedin", title: "LinkedIn", type: "domain", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "description", title: "Notes", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
      { slug: "domains", title: "Domains", type: "domain", isSystem: true, isRequired: false, isUnique: true, isMultiselect: true },
      { slug: "description", title: "Description", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "team", title: "Team", type: "record_reference", isSystem: true, isRequired: false, isUnique: false, isMultiselect: true, config: { targetObjectSlug: "people" } },
      { slug: "primary_location", title: "Primary Location", type: "location", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "categories", title: "Categories", type: "select", isSystem: true, isRequired: false, isUnique: false, isMultiselect: true },
    ],
  },
=======
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
      { slug: "primary_location", title: "Country / Location", type: "location", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "description", title: "Company Description", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      // Lead intelligence summary
      { slug: "customer_needs", title: "Customer Needs / Pain Points", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "products_of_interest", title: "Products of Interest", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "estimated_quantity", title: "Estimated Quantity / Scale", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "current_supplier", title: "Current Supplier", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "decision_timeline", title: "Decision Timeline", type: "text", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "owner", title: "Account Owner", type: "actor_reference", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
    ],
  },

  // ─── Deals / Opportunities ───────────────────────────────────────────────
>>>>>>> Stashed changes
  {
    slug: "deals",
    singularName: "Deal",
    pluralName: "Deals",
    icon: "handshake",
    isAlwaysOn: false,
    attributes: [
      { slug: "name", title: "Name", type: "text", isSystem: true, isRequired: true, isUnique: false, isMultiselect: false },
<<<<<<< Updated upstream
      { slug: "value", title: "Value", type: "currency", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "stage", title: "Stage", type: "status", isSystem: true, isRequired: true, isUnique: false, isMultiselect: false },
      { slug: "expected_close_date", title: "Expected Close Date", type: "date", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
=======
      { slug: "stage", title: "Stage", type: "status", isSystem: true, isRequired: true, isUnique: false, isMultiselect: false },
      { slug: "value", title: "Estimated Value (EUR)", type: "currency", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      {
        slug: "expected_close_date",
        title: "Expected Close Date",
        type: "date",
        isSystem: true,
        isRequired: false,
        isUnique: false,
        isMultiselect: false,
      },
      {
        slug: "company",
        title: "Customer / Lead",
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
      // BioTech-specific deal fields
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
>>>>>>> Stashed changes
      { slug: "owner", title: "Owner", type: "actor_reference", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false },
      { slug: "company", title: "Company", type: "record_reference", isSystem: true, isRequired: false, isUnique: false, isMultiselect: false, config: { targetObjectSlug: "companies" } },
      { slug: "associated_people", title: "Associated People", type: "record_reference", isSystem: true, isRequired: false, isUnique: false, isMultiselect: true, config: { targetObjectSlug: "people" } },
    ],
  },
];

<<<<<<< Updated upstream
export const DEAL_STAGES = [
  { title: "Lead", color: "#6366f1", sortOrder: 0, isActive: true, celebrationEnabled: false },
  { title: "Qualified", color: "#8b5cf6", sortOrder: 1, isActive: true, celebrationEnabled: false },
  { title: "Proposal", color: "#a855f7", sortOrder: 2, isActive: true, celebrationEnabled: false },
  { title: "Negotiation", color: "#d946ef", sortOrder: 3, isActive: true, celebrationEnabled: false },
  { title: "Won", color: "#22c55e", sortOrder: 4, isActive: false, celebrationEnabled: true },
  { title: "Lost", color: "#ef4444", sortOrder: 5, isActive: false, celebrationEnabled: false },
=======
/** BioTech sales pipeline stages */
export const DEAL_STAGES = [
  { title: "Lead", color: "#6366f1", sortOrder: 0, isActive: true, celebrationEnabled: false },
  { title: "Qualified", color: "#8b5cf6", sortOrder: 1, isActive: true, celebrationEnabled: false },
  { title: "Needs Analysis", color: "#a855f7", sortOrder: 2, isActive: true, celebrationEnabled: false },
  { title: "Proposal Sent", color: "#d946ef", sortOrder: 3, isActive: true, celebrationEnabled: false },
  { title: "Negotiation", color: "#ec4899", sortOrder: 4, isActive: true, celebrationEnabled: false },
  { title: "Won / Customer", color: "#22c55e", sortOrder: 5, isActive: false, celebrationEnabled: true },
  { title: "Lost", color: "#ef4444", sortOrder: 6, isActive: false, celebrationEnabled: false },
  { title: "On Hold", color: "#94a3b8", sortOrder: 7, isActive: false, celebrationEnabled: false },
>>>>>>> Stashed changes
];
