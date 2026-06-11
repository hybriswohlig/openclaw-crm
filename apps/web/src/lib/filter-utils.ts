import type { AttributeType } from "@openclaw-crm/shared";
import type { FilterCondition } from "@openclaw-crm/shared";

/** Get available operators for a given attribute type */
export function getOperatorsForType(type: AttributeType): FilterCondition["operator"][] {
  switch (type) {
    case "text":
    case "email_address":
    case "phone_number":
    case "domain":
      return ["equals", "not_equals", "contains", "not_contains", "starts_with", "ends_with", "is_empty", "is_not_empty"];
    case "number":
    case "currency":
    case "rating":
      return ["equals", "not_equals", "greater_than", "less_than", "greater_than_or_equals", "less_than_or_equals", "is_empty", "is_not_empty"];
    case "date":
    case "timestamp":
      return ["equals", "not_equals", "greater_than", "less_than", "greater_than_or_equals", "less_than_or_equals", "is_empty", "is_not_empty"];
    case "checkbox":
      return ["equals", "not_equals"];
    case "select":
    case "status":
      return ["equals", "not_equals", "in", "not_in", "is_empty", "is_not_empty"];
    case "record_reference":
    case "actor_reference":
      return ["equals", "not_equals", "is_empty", "is_not_empty"];
    case "personal_name":
    case "location":
    case "json":
      return ["is_empty", "is_not_empty"];
    default:
      return ["equals", "not_equals", "is_empty", "is_not_empty"];
  }
}

/** Human-readable label for an operator */
export const OPERATOR_LABELS: Record<FilterCondition["operator"], string> = {
  equals: "ist",
  not_equals: "ist nicht",
  contains: "enthält",
  not_contains: "enthält nicht",
  starts_with: "beginnt mit",
  ends_with: "endet mit",
  greater_than: "größer als",
  less_than: "kleiner als",
  greater_than_or_equals: "mindestens",
  less_than_or_equals: "höchstens",
  is_empty: "ist leer",
  is_not_empty: "ist nicht leer",
  in: "ist eines von",
  not_in: "ist keines von",
};
