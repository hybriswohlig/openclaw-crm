import { db } from "@/db";
import { integrations } from "@/db/schema/integrations";
import { eq, and, asc } from "drizzle-orm";

// ─── Seed Data ────────────────────────────────────────────────────────────────
// Built-in integrations that every new workspace starts with.
// Status is "coming_soon" until the admin activates them.

export const BUILT_IN_INTEGRATIONS = [
  {
    slug: "whatsapp",
    name: "WhatsApp Business",
    description:
      "Connect WhatsApp Business API to send and receive messages directly from deal and contact records.",
    type: "built_in" as const,
    status: "coming_soon" as const,
    position: 0,
    logoSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`,
  },
  {
    slug: "finom",
    name: "Finom",
    description:
      "Sync bank transactions from Finom to automatically reconcile payments against deals. Connect via Zapier.",
    type: "zapier" as const,
    status: "coming_soon" as const,
    position: 1,
    logoSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="#6C47FF"/><text x="12" y="16.5" text-anchor="middle" font-family="sans-serif" font-size="11" font-weight="700" fill="white">Fi</text></svg>`,
  },
  {
    slug: "immobilienscout24",
    name: "ImmobilienScout24",
    description:
      "Import leads from ImmobilienScout24 listings automatically as deals in the CRM.",
    type: "built_in" as const,
    status: "coming_soon" as const,
    position: 2,
    logoSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="#E8003D"/><text x="12" y="16.5" text-anchor="middle" font-family="sans-serif" font-size="9" font-weight="700" fill="white">IS24</text></svg>`,
  },
  {
    slug: "zapier",
    name: "Zapier",
    description:
      "Connect any app to this CRM using Zapier webhooks. Trigger automations on deal or contact events.",
    type: "zapier" as const,
    status: "coming_soon" as const,
    position: 3,
    logoSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#FF4A00"><path d="M14.785 10.688a5.87 5.87 0 01-.688 2.814l-6.9-6.9a5.87 5.87 0 012.814-.688 5.876 5.876 0 014.774 4.774zM9.215 13.312a5.87 5.87 0 01.688-2.814l6.9 6.9a5.87 5.87 0 01-2.814.688 5.876 5.876 0 01-4.774-4.774zM12 6.124l3.88 3.88A5.876 5.876 0 0012 6.124zm0 11.752l-3.88-3.88A5.876 5.876 0 0012 17.876zM2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10S2 17.523 2 12z"/></svg>`,
  },
] as const;

// ─── Auto-seed ─────────────────────────────────────────────────────────────────

export async function seedBuiltInIntegrations(workspaceId: string) {
  for (const integration of BUILT_IN_INTEGRATIONS) {
    await db
      .insert(integrations)
      .values({
        workspaceId,
        ...integration,
      })
      .onConflictDoNothing();
  }
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getIntegrations(workspaceId: string) {
  // Auto-seed built-ins on first load
  const existing = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(eq(integrations.workspaceId, workspaceId))
    .limit(1);

  if (existing.length === 0) {
    await seedBuiltInIntegrations(workspaceId);
  }

  return db
    .select()
    .from(integrations)
    .where(eq(integrations.workspaceId, workspaceId))
    .orderBy(asc(integrations.position), asc(integrations.createdAt));
}

export async function getIntegrationById(workspaceId: string, id: string) {
  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.id, id)))
    .limit(1);
  return row ?? null;
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export interface IntegrationCreateInput {
  slug: string;
  name: string;
  description?: string;
  logoSvg?: string;
  logoUrl?: string;
  type: "built_in" | "zapier" | "custom";
  apiKey?: string;
  webhookUrl?: string;
  syncRules?: string;
  position?: number;
}

export async function createIntegration(
  workspaceId: string,
  input: IntegrationCreateInput
) {
  const [row] = await db
    .insert(integrations)
    .values({ workspaceId, ...input })
    .returning();
  return row;
}

export interface IntegrationUpdateInput {
  name?: string;
  description?: string;
  logoSvg?: string | null;
  logoUrl?: string | null;
  status?: "coming_soon" | "active" | "inactive";
  apiKey?: string | null;
  webhookUrl?: string | null;
  syncRules?: string | null;
  position?: number;
}

export async function updateIntegration(
  workspaceId: string,
  id: string,
  input: IntegrationUpdateInput
) {
  const [row] = await db
    .update(integrations)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.id, id)))
    .returning();
  return row ?? null;
}

export async function deleteIntegration(workspaceId: string, id: string) {
  const [row] = await db
    .delete(integrations)
    .where(
      and(
        eq(integrations.workspaceId, workspaceId),
        eq(integrations.id, id),
        // Prevent deleting built-ins — they can only be disabled
        eq(integrations.type, "custom")
      )
    )
    .returning({ id: integrations.id });
  return row ?? null;
}
