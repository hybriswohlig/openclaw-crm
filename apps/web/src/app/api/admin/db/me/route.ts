import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { adminEmailsConfigured, isAdminEmail } from "@/lib/admin-auth";

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Sign in required" } },
      { status: 401 }
    );
  }
  const email = session.user.email;
  const admin = isAdminEmail(email);
  return NextResponse.json({
    data: {
      admin,
      adminEmailsConfigured: adminEmailsConfigured(),
    },
  });
}
