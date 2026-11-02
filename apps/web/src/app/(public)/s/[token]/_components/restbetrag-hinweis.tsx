import { portalRestbetragSatz } from "@/lib/kottke-restbetrag";

export function RestbetragHinweis({
  firmaSlug,
  serviceType,
  className,
}: {
  firmaSlug: string;
  serviceType?: string | null;
  className?: string;
}) {
  const satz = portalRestbetragSatz(firmaSlug, serviceType);
  if (!satz) return null;
  return <p className={className ?? "text-sm"}>{satz}</p>;
}
