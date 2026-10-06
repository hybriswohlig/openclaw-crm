"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { istPortalPfad } from "@/lib/portal-pfad";

export function PlausibleScript() {
  const pathname = usePathname();
  // Kundenportal: keine Reichweitenmessung, die URL enthält den Zugangs-Token.
  if (istPortalPfad(pathname)) return null;
  return (
    <>
      <Script
        src="https://plausible.io/js/pa-NgffR9Cmf65xp81wiCACc.js"
        strategy="afterInteractive"
      />
      <Script id="plausible-init" strategy="afterInteractive">
        {`window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)};plausible.init=plausible.init||function(i){plausible.o=i||{}};plausible.init();`}
      </Script>
    </>
  );
}
