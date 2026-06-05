import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Kottke Mitarbeiter",
  robots: { index: false, follow: false },
};

export default function MitarbeiterLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="min-h-svh bg-background text-foreground antialiased">
      {children}
    </div>
  );
}
