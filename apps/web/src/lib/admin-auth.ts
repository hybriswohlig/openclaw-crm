/**
 * Platform admin (separate from workspace admin role).
 * Set ADMIN_EMAILS=comma@separated,list in the environment.
 */
export function parseAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  const list = parseAdminEmails();
  if (list.length === 0) return false;
  return list.includes(email.trim().toLowerCase());
}

export function adminEmailsConfigured(): boolean {
  return parseAdminEmails().length > 0;
}
