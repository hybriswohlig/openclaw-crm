import { NextRequest, NextResponse } from "next/server";
import { berlinDateString } from "@/lib/berlin-date";
import { calendarFeeds } from "@/services/calendar/feed-token-store";
import { normalizeFeedTokenParam } from "@/services/calendar/feed-tokens";
import { ICS_CACHE_CONTROL, absoluteUrl, buildCalendarIcs, icsEtag } from "@/services/calendar/ics";
import { listCalendarEvents } from "@/services/calendar/load-events";
import { defaultFeedRange, parseCalendarQuery } from "@/services/calendar/query";

export const dynamic = "force-dynamic";

function requestOrigin(req: NextRequest): string {
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost ?? req.headers.get("host") ?? req.nextUrl.host;
  const proto =
    req.headers.get("x-forwarded-proto") ??
    req.nextUrl.protocol.replace(":", "") ??
    "https";
  return `${proto}://${host}`;
}

function cacheHeaders(etag: string): HeadersInit {
  return {
    "Cache-Control": ICS_CACHE_CONTROL,
    ETag: etag,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token: raw } = await params;
  const token = normalizeFeedTokenParam(raw);
  if (!token) return new NextResponse("Not found", { status: 404 });

  const access = await calendarFeeds.authenticate(token);
  if (!access) return new NextResponse("Not found", { status: 404 });

  const parsed = parseCalendarQuery(req.nextUrl.searchParams, {
    defaultRange: defaultFeedRange(berlinDateString()),
  });
  if (!parsed.ok) return new NextResponse(parsed.error, { status: 400 });

  const query = {
    ...parsed.query,
    stageIds: [] as string[],
    includeClosed: false,
  };
  const bundle = await listCalendarEvents(access.workspaceId, query);
  const company =
    query.companyIds.length === 1
      ? bundle.companies.find((item) => item.id === query.companyIds[0])
      : undefined;
  const calendarName = company ? `Einsätze ${company.name}` : "Einsätze";
  const origin = requestOrigin(req);
  const body = buildCalendarIcs(bundle.events, {
    calendarName,
    dealUrl: (href) => absoluteUrl(origin, href),
  });
  const etag = icsEtag(body);
  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: cacheHeaders(etag) });
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      ...cacheHeaders(etag),
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="einsaetze.ics"',
    },
  });
}
