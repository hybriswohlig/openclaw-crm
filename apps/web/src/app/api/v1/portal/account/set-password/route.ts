import { NextRequest } from "next/server";
import { redeemSetupToken } from "@/services/employee-accounts";
import { badRequest, success } from "@/lib/api-utils";

/**
 * Public, token-based: an employee sets their own password via the one-time
 * setup link they were given. No session required.
 */
export async function POST(req: NextRequest) {
  const { token, password } = await req.json();
  if (!token || typeof password !== "string" || password.length < 8) {
    return badRequest("Passwort muss mindestens 8 Zeichen haben.");
  }
  const result = await redeemSetupToken(token, password);
  if (!result) return badRequest("Link ungültig oder abgelaufen.");
  return success({ username: result.username });
}
