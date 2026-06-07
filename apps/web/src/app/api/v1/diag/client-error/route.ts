import { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { db } from "@/db";
import { verifications } from "@/db/schema";

/**
 * TEMP diagnostic sink: stores client-side errors so we can read the real
 * exception users hit (no auth — public). Rows live in `verifications` with a
 * sentinel identifier and a short TTL; remove this route after debugging.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    await db.insert(verifications).values({
      id: randomBytes(12).toString("hex"),
      identifier: "__diag_client_error",
      value: JSON.stringify({
        message: body.message,
        stack: typeof body.stack === "string" ? body.stack.slice(0, 1800) : null,
        digest: body.digest ?? null,
        url: body.url ?? null,
        ua: typeof body.ua === "string" ? body.ua.slice(0, 200) : null,
        at: new Date().toISOString(),
      }).slice(0, 4000),
      expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    });
  } catch {
    // best effort
  }
  return new Response(null, { status: 204 });
}
