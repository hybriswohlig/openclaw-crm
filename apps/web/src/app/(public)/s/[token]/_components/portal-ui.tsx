"use client";

import { CalendarDays, MapPin, Truck, UserRound, ClipboardList, MessageCircle, Phone, Check, UsersRound, Package, Clock3, type LucideIcon } from "lucide-react";
import type { CustomerPortalContext } from "@openclaw-crm/customer-portal-core";
import { PortalRequestForm } from "./portal-request-form";
import { WhatsAppContactLink } from "./whatsapp-contact-link";
import { formatPortalDate, formatPortalMoney, selectedPortalPackage } from "./portal-presentation";

export function PanelHeading({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: React.ReactNode }) {
  return <div className="portal-panel-heading"><Icon aria-hidden /><div><h2>{title}</h2>{children && <div className="portal-panel-description">{children}</div>}</div></div>;
}

export function DetailItem({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: React.ReactNode }) {
  return <div className="portal-detail"><Icon aria-hidden /><div><dt>{label}</dt><dd>{children}</dd></div></div>;
}

export function MoveFacts({ ctx }: { ctx: CustomerPortalContext }) {
  const { scope } = ctx;
  return <dl className="portal-move-facts">
    <div className="portal-panel"><DetailItem icon={CalendarDays} label="Umzugstermin">{formatPortalDate(scope.moveDate) ?? "Termin wird abgestimmt"}{scope.timeStart && <span className="block">{scope.timeEnd ? `${scope.timeStart} bis ${scope.timeEnd} Uhr` : `ab ${scope.timeStart} Uhr`}</span>}</DetailItem></div>
    {scope.fromAddress && <div className="portal-panel"><DetailItem icon={MapPin} label="Abholung">{scope.fromAddress}<AddressAccess floor={scope.floorsFrom} access={scope.accessFrom} /></DetailItem></div>}
    {scope.toAddress && <div className="portal-panel"><DetailItem icon={MapPin} label="Ziel">{scope.toAddress}<AddressAccess floor={scope.floorsTo} access={scope.accessTo} /></DetailItem></div>}
  </dl>;
}

function AddressAccess({ floor, access }: { floor: number | null; access: string | null }) {
  const level = floor == null ? null : floor === 0 ? "Erdgeschoss" : floor < 0 ? `${Math.abs(floor)}. Untergeschoss` : `${floor}. OG`;
  return level || access ? <span className="block">{[level, access].filter(Boolean).join(" · ")}</span> : null;
}

export function OrderDetails({ ctx, token, wide = false }: { ctx: CustomerPortalContext; token: string; wide?: boolean }) {
  const { scope } = ctx;
  const pkg = selectedPortalPackage(ctx);
  return <section className={`portal-panel portal-order-details ${wide ? "portal-order-wide" : ""}`}>
    <PanelHeading icon={ClipboardList} title="Auftragsdetails" />
    <dl className="portal-details-grid">
      <DetailItem icon={CalendarDays} label="Umzugstermin">{formatPortalDate(scope.moveDate) ?? "Termin wird abgestimmt"}{scope.timeStart && <span className="block">{scope.timeEnd ? `${scope.timeStart} bis ${scope.timeEnd} Uhr` : `ab ${scope.timeStart} Uhr`}</span>}</DetailItem>
      {scope.fromAddress && <DetailItem icon={MapPin} label="Abholung">{scope.fromAddress}<AddressAccess floor={scope.floorsFrom} access={scope.accessFrom} /></DetailItem>}
      {scope.toAddress && <DetailItem icon={MapPin} label="Ziel">{scope.toAddress}<AddressAccess floor={scope.floorsTo} access={scope.accessTo} /></DetailItem>}
      {(pkg || ctx.kva) && <DetailItem icon={Truck} label={pkg ? "Leistungspaket" : "Angebot"}>{pkg?.displayName ?? (ctx.kva?.isVariable ? "Abrechnung nach Aufwand" : "Individuelles Angebot")}{ctx.kva && <span className="block">{ctx.kva.isVariable && "Voraussichtlich "}{formatPortalMoney(ctx.kva.totalCents)}</span>}</DetailItem>}
      {ctx.customerDisplayName && <DetailItem icon={UserRound} label="Auftraggeber">{ctx.customerDisplayName}</DetailItem>}
      {scope.volumeCbm != null && <DetailItem icon={Package} label="Umzugsvolumen">ca. {scope.volumeCbm} m³</DetailItem>}
      {(scope.specialRequests || scope.inventoryNotes) && <DetailItem icon={ClipboardList} label="Besonderheiten">{[scope.specialRequests, scope.inventoryNotes].filter(Boolean).join("\n")}</DetailItem>}
    </dl>
    {ctx.stage < 4 && <div className="portal-detail-action"><PortalRequestForm token={token} kind="question" triggerLabel={ctx.stage === 1 ? "Änderung anfragen" : "Änderung nach Absprache anfragen"} title="Änderung Ihrer Auftragsdetails" primaryColor={ctx.branding.primaryColor} /></div>}
  </section>;
}

export function SuccessBanner({ ctx, completed = false }: { ctx: CustomerPortalContext; completed?: boolean }) {
  return <section className="portal-success">
    {ctx.branding.firmaSlug === "kottke" && <div className="portal-success-art" aria-hidden />}
    <div className="portal-success-content"><span className="portal-success-check"><Check aria-hidden /></span><div>
      <p className="portal-eyebrow">{completed ? "Umzug abgeschlossen" : "Auftrag bestätigt"}</p>
      <h2>{completed ? "Ihr Umzug ist abgeschlossen!" : "Vielen Dank für Ihr Vertrauen!"}</h2>
      <p>{completed ? "Vielen Dank für Ihr Vertrauen. Wir wünschen Ihnen viel Freude in Ihrem neuen Zuhause." : "Ihr Auftrag wurde bestätigt. Wir freuen uns auf Ihren Umzug und sind bei Fragen jederzeit für Sie da."}</p>
    </div></div>
    {!completed && <div className="portal-success-facts"><CalendarDays aria-hidden /><div><strong>Ihr Umzugstermin</strong><p>{formatPortalDate(ctx.scope.moveDate) ?? "Wir stimmen Ihren Termin mit Ihnen ab."}{ctx.scope.timeStart && ` · ab ${ctx.scope.timeStart} Uhr`}</p></div></div>}
  </section>;
}

export function ContactPanel({ ctx, token, title = "Fragen zum Auftrag?" }: { ctx: CustomerPortalContext; token: string; title?: string }) {
  const phone = ctx.branding.whatsappNumberE164?.replace(/[^\d]/g, "");
  return <section className="portal-panel portal-contact">
    <PanelHeading icon={MessageCircle} title={title}><p>Bei Fragen zu Ihrem Auftrag sind wir für Sie da.</p></PanelHeading>
    {phone && <div className="portal-contact-buttons"><a className="portal-button portal-button-secondary" href={`tel:+${phone}`}><Phone size={17} aria-hidden />Anrufen</a><WhatsAppContactLink phoneE164={phone} label="WhatsApp" message={`Hallo ${ctx.branding.displayName}, ich habe eine Frage zu meinem Auftrag ${ctx.dealNumber}.`} className="portal-button portal-button-secondary" /></div>}
    <PortalRequestForm token={token} kind="question" triggerLabel="Nachricht senden" title="Ihre Nachricht an uns" primaryColor={ctx.branding.primaryColor} />
  </section>;
}

export function CrewPanel({ ctx }: { ctx: CustomerPortalContext }) {
  if (!ctx.crew.length) return null;
  return <section className="portal-panel"><PanelHeading icon={UsersRound} title="Ihr Umzugsteam"><p>{ctx.crew.length} {ctx.crew.length === 1 ? "Mitarbeiter" : "Mitarbeitende"}</p></PanelHeading><ul className="portal-crew">{ctx.crew.map(member => <li key={member.employeeId}>
    {member.photoBase64DataUrl ?
      // eslint-disable-next-line @next/next/no-img-element
      <img src={member.photoBase64DataUrl} alt="" /> : <span className="portal-avatar">{member.name.trim().split(/\s+/).map(n => n[0]).slice(0, 2).join("")}</span>}
    <div><strong>{member.name}</strong>{member.role && <p>{member.role}</p>}</div>
  </li>)}</ul></section>;
}

export function CompletionSummary({ ctx }: { ctx: CustomerPortalContext }) {
  const start = ctx.features?.liveTracking === true ? ctx.timing.onsiteAt : null;
  const finish = ctx.timing.finishedAt;
  const duration = start && finish ? (new Date(finish).getTime() - new Date(start).getTime()) / 3600000 : null;
  const items = selectedPortalPackage(ctx)?.includedItems ?? [];
  if (!ctx.scope.workerCount && !ctx.crew.length && !ctx.scope.transporterName && !items.length && !(duration != null && duration >= 0)) return null;
  return <section className="portal-panel"><PanelHeading icon={ClipboardList} title="Kurz zusammengefasst" /><dl className="portal-summary-grid">
    {(ctx.scope.workerCount || ctx.crew.length) > 0 && <DetailItem icon={UsersRound} label="Ihr Team">{ctx.scope.workerCount ?? ctx.crew.length} Mitarbeitende</DetailItem>}
    {ctx.scope.transporterName && <DetailItem icon={Truck} label="Fahrzeug">{ctx.scope.transporterName}</DetailItem>}
    {items.length > 0 && <DetailItem icon={Package} label="Vereinbarte Leistungen"><ul>{items.map(item => <li key={item}>{item}</li>)}</ul></DetailItem>}
    {duration != null && duration >= 0 && <DetailItem icon={Clock3} label="Erfasste Zeit">{duration.toLocaleString("de-DE", { maximumFractionDigits: 1 })} Stunden</DetailItem>}
  </dl></section>;
}
