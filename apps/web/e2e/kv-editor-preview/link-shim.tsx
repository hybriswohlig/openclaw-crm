import type { AnchorHTMLAttributes } from "react";

/** `next/link` ohne Next-Router: ein einfacher Anker (nur Vorschau). */
export default function Link({ href, ...rest }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string | { pathname?: string | null } }) {
  return <a href={typeof href === "string" ? href : (href.pathname ?? "#")} {...rest} />;
}
