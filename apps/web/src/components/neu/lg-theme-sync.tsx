"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { lgThemeFor } from "@/lib/lg-theme";

export function LgThemeSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    document.documentElement.dataset.lgTheme = lgThemeFor(resolvedTheme);
  }, [resolvedTheme]);

  return null;
}
