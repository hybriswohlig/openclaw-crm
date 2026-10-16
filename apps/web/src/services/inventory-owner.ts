/**
 * Abbau / Aufbau on a deal inventory row.
 * company = we do it, customer = the customer does it, none = not part of the job.
 */
export const INVENTORY_OWNERS = ["company", "customer", "none"] as const;
export type InventoryOwner = (typeof INVENTORY_OWNERS)[number];

export function isInventoryOwner(value: unknown): value is InventoryOwner {
  return value === "company" || value === "customer" || value === "none";
}

export interface InventoryOwnerPatch {
  dismantlingOwner?: InventoryOwner;
  assemblyOwner?: InventoryOwner;
}

/**
 * Reads dismantlingOwner/assemblyOwner. German aliases abbau and aufbau
 * are the same fields. A present invalid value rejects the whole patch.
 * Omitted fields are left unchanged.
 */
export function parseInventoryOwnerPatch(
  body: Record<string, unknown>
): { ok: true; patch: InventoryOwnerPatch } | { ok: false; error: string } {
  const dismantling = readOwner(body, "dismantlingOwner", "abbau", "Abbau (dismantlingOwner)");
  if (!dismantling.ok) return dismantling;
  const assembly = readOwner(body, "assemblyOwner", "aufbau", "Aufbau (assemblyOwner)");
  if (!assembly.ok) return assembly;
  return {
    ok: true,
    patch: {
      ...(dismantling.value !== undefined ? { dismantlingOwner: dismantling.value } : {}),
      ...(assembly.value !== undefined ? { assemblyOwner: assembly.value } : {}),
    },
  };
}

function readOwner(
  body: Record<string, unknown>,
  field: "dismantlingOwner" | "assemblyOwner",
  alias: "abbau" | "aufbau",
  label: string
): { ok: true; value?: InventoryOwner } | { ok: false; error: string } {
  const hasField = Object.prototype.hasOwnProperty.call(body, field);
  const hasAlias = Object.prototype.hasOwnProperty.call(body, alias);
  if (!hasField && !hasAlias) return { ok: true };
  const primary = hasField ? body[field] : undefined;
  const secondary = hasAlias ? body[alias] : undefined;
  if (hasField && !isInventoryOwner(primary)) {
    return { ok: false, error: ownerError(label) };
  }
  if (hasAlias && !isInventoryOwner(secondary)) {
    return { ok: false, error: ownerError(label) };
  }
  if (
    hasField &&
    hasAlias &&
    primary !== secondary
  ) {
    return {
      ok: false,
      error: `${field} and ${alias} disagree (${String(primary)} vs ${String(secondary)})`,
    };
  }
  return { ok: true, value: (hasField ? primary : secondary) as InventoryOwner };
}

function ownerError(label: string): string {
  return `${label} must be one of: company, customer, none`;
}
