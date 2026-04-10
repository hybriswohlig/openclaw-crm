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
    singularName: "Deal",
    pluralName: "Deals",
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
    ],
  },
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
