"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";

const ALLOW_PENDING_PATH = "/pending-approval";

/**
 * Blocks the CRM for accounts that are not approved yet (or were rejected).
 */
export function ApprovalGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/v1/auth/account-status");
        if (cancelled) return;

        if (!res.ok) {
          router.replace("/login");
          return;
        }

        const body = await res.json();
        const status = body.data?.approvalStatus as string | undefined;

        if (status === "approved") {
          if (pathname === ALLOW_PENDING_PATH) {
            router.replace("/home");
            return;
          }
          setAllowed(true);
          setReady(true);
          return;
        }

        if (status === "rejected") {
          await signOut();
          router.replace("/login?reason=rejected");
          return;
        }

        if (status === "pending") {
          if (pathname === ALLOW_PENDING_PATH) {
            setAllowed(true);
            setReady(true);
            return;
          }
          router.replace(ALLOW_PENDING_PATH);
          return;
        }

        router.replace("/login");
      } catch {
        if (!cancelled) router.replace("/login");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  if (!ready || !allowed) {
    return (
      <div className="flex h-full min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        Checking access…
      </div>
    );
  }

  return <>{children}</>;
}
