import { createHash, randomBytes } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { auth } from "@/lib/auth";
import { users, employees, verifications } from "@/db/schema";

// ─── Employee login accounts (mobile portal) ────────────────────────────────────
// Admin creates a username-based login for an employee; the employee then sets
// their own password via a one-time setup link. Accounts are better-auth users
// with role="employee", linked 1:1 to an `employees` row via employees.user_id.

const SETUP_PREFIX = "emp-setup:"; // verification.identifier prefix
const SETUP_TTL_DAYS = 14;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A synthetic, unique email so the account satisfies the users.email constraint. */
function syntheticEmail(username: string): string {
  return `${username.toLowerCase()}@mitarbeiter.kottke.local`;
}

export interface EmployeeAccountSummary {
  employeeId: string;
  employeeName: string;
  userId: string | null;
  username: string | null;
  hasPassword: boolean; // false until the employee redeems the setup link
}

/**
 * Create a login for an employee. Returns the one-time setup token (raw) — give
 * the employee the link kottke-mitarbeiter.<host>/passwort-setzen?token=<token>.
 * The account starts with an unknown random password, unusable until redeemed.
 */
export async function createEmployeeAccount(
  workspaceId: string,
  employeeId: string,
  username: string
): Promise<{ userId: string; username: string; setupToken: string }> {
  const uname = username.trim().toLowerCase();
  if (uname.length < 3) throw new Error("Username zu kurz (min. 3 Zeichen).");

  const [emp] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.workspaceId, workspaceId)))
    .limit(1);
  if (!emp) throw new Error("Mitarbeiter nicht gefunden.");
  if (emp.userId) throw new Error("Mitarbeiter hat bereits einen Account.");

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, uname))
    .limit(1);
  if (existing.length) throw new Error("Username bereits vergeben.");

  // Create the better-auth user + credential account with a random password.
  // NOTE: auth.api.signUpEmail creates the user + credential account, then tries
  // to auto-create a SESSION and throws FAILED_TO_CREATE_SESSION when called
  // server-side (no request context) — even though the user already exists. So
  // we resolve the user by email afterwards and tolerate that post-creation
  // throw. Also idempotent: reuse an orphan from a prior partial attempt.
  const email = syntheticEmail(uname);
  let userId: string;
  const [orphan] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (orphan) {
    userId = orphan.id;
  } else {
    const tempPassword = randomBytes(18).toString("base64url");
    let signupErr: unknown = null;
    try {
      await auth.api.signUpEmail({
        body: { email, password: tempPassword, name: emp.name },
      });
    } catch (e) {
      signupErr = e; // tolerate the session-step failure; user is already created
    }
    const [created] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (!created) {
      throw new Error(
        "Konto konnte nicht angelegt werden: " +
          ((signupErr as Error)?.message ?? "unbekannter Fehler")
      );
    }
    userId = created.id;
  }

  // Promote to an approved employee account with username login.
  await db
    .update(users)
    .set({
      role: "employee",
      approvalStatus: "approved",
      emailVerified: true,
      username: uname,
      displayUsername: username.trim(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  await db.update(employees).set({ userId, updatedAt: new Date() }).where(eq(employees.id, employeeId));

  const setupToken = await issueSetupToken(userId);
  return { userId, username: uname, setupToken };
}

/** Issue (or re-issue) a one-time setup token for an existing employee account. */
export async function issueSetupToken(userId: string): Promise<string> {
  // Drop any previous setup tokens for this user.
  await db.delete(verifications).where(eq(verifications.value, `${SETUP_PREFIX}${userId}`));
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + SETUP_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(verifications).values({
    id: randomBytes(16).toString("hex"),
    identifier: hashToken(token),
    value: `${SETUP_PREFIX}${userId}`,
    expiresAt,
  });
  return token;
}

/** Re-issue a setup link for an employee that already has an account. */
export async function resetEmployeePassword(
  workspaceId: string,
  employeeId: string
): Promise<{ setupToken: string }> {
  const [emp] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.workspaceId, workspaceId)))
    .limit(1);
  if (!emp?.userId) throw new Error("Kein Account für diesen Mitarbeiter.");
  const setupToken = await issueSetupToken(emp.userId);
  return { setupToken };
}

/**
 * Redeem a setup token: the employee sets their own password. Single-use.
 * Returns the username so the portal can pre-fill the login.
 */
export async function redeemSetupToken(
  token: string,
  newPassword: string
): Promise<{ username: string } | null> {
  if (!token || newPassword.length < 8) return null;
  const [row] = await db
    .select()
    .from(verifications)
    .where(eq(verifications.identifier, hashToken(token)))
    .limit(1);
  if (!row || !row.value.startsWith(SETUP_PREFIX)) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(verifications).where(eq(verifications.id, row.id));
    return null;
  }
  const userId = row.value.slice(SETUP_PREFIX.length);

  const ctx = await auth.$context;
  const hashed = await ctx.password.hash(newPassword);
  await ctx.internalAdapter.updatePassword(userId, hashed);

  await db.delete(verifications).where(eq(verifications.id, row.id));

  const [u] = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return { username: u?.username ?? "" };
}

/** List employees with their account status — for the CRM admin screen. */
export async function listEmployeeAccounts(
  workspaceId: string
): Promise<EmployeeAccountSummary[]> {
  const rows = await db
    .select({
      employeeId: employees.id,
      employeeName: employees.name,
      userId: employees.userId,
      username: users.username,
    })
    .from(employees)
    .leftJoin(users, eq(users.id, employees.userId))
    .where(eq(employees.workspaceId, workspaceId))
    .orderBy(employees.name);

  // hasPassword: there is no pending setup token left for the user.
  const pending = await db
    .select({ value: verifications.value })
    .from(verifications);
  const pendingUserIds = new Set(
    pending
      .filter((p) => p.value.startsWith(SETUP_PREFIX))
      .map((p) => p.value.slice(SETUP_PREFIX.length))
  );

  return rows.map((r) => ({
    employeeId: r.employeeId,
    employeeName: r.employeeName,
    userId: r.userId,
    username: r.username,
    hasPassword: !!r.userId && !pendingUserIds.has(r.userId),
  }));
}
