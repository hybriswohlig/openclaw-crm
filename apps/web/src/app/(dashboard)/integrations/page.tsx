import Link from "next/link";
import { Plug, ArrowLeft } from "lucide-react";

export default function IntegrationsPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-6 text-center px-4">
      <div className="rounded-full bg-muted p-5">
        <Plug className="h-10 w-10 text-muted-foreground" />
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Integrations</h1>
        <p className="text-muted-foreground max-w-sm">
          Integrations are coming soon. Check back later for connections to your
          favourite tools.
        </p>
      </div>
      <Link
        href="/home"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Home
      </Link>
    </div>
  );
}
