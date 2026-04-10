"use client";

import { signOut } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export default function PendingApprovalPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-xl font-semibold mb-2">Waiting for approval</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Your account was created successfully. An administrator must approve it before you can use
        the CRM. You will be notified when you can sign in again, or refresh this page after
        approval.
      </p>
      <Button type="button" variant="outline" onClick={() => signOut()}>
        Sign out
      </Button>
    </div>
  );
}
