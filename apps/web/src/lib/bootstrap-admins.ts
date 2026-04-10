/**
 * Comma-separated emails in CRM_ADMIN_EMAILS are auto-approved and get app-admin on signup.
 */
export function getBootstrapAdminEmails(): Set<string> {
  const raw = process.env.CRM_ADMIN_EMAILS || "";
  const set = new Set<string>();
  for (const part of raw.split(",")) {
    const e = part.trim().toLowerCase();
    if (e) set.add(e);
  }
  return set;
}
