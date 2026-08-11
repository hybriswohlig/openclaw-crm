import {
  protectedResourceHandler,
  metadataCorsOptionsRequestHandler,
} from "mcp-handler";
import { resolveBaseUrl } from "@/lib/mcp/client";

/**
 * RFC 9728 Protected Resource Metadata for remote MCP clients.
 * We authenticate with CRM API keys (Bearer oc_sk_…), not a full OAuth AS,
 * so authorization_servers points at this deployment for discovery.
 */
const handler = (req: Request) => {
  const base = resolveBaseUrl(req);
  return protectedResourceHandler({
    authServerUrls: [base],
  })(req);
};

const corsHandler = metadataCorsOptionsRequestHandler();

export { handler as GET, corsHandler as OPTIONS };
