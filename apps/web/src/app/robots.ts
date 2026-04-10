import type { MetadataRoute } from "next";
import { baseUrl } from "@/lib/base-url";

const disallowedPaths = [
  "/api/",
  "/settings/",
  "/login",
  "/register",
  "/home",
  "/objects/",
  "/tasks",
  "/notes",
  "/chat",
  "/search",
  "/notifications",
  "/lists/",
  "/select-workspace",
  "/admin/",
];

// AI crawlers to explicitly allow for AEO (answer engine optimization).
// These bots power ChatGPT search, Perplexity, Gemini, Claude, and others.
const aiCrawlers = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "anthropic-ai",
  "Google-Extended",
  "PerplexityBot",
  "YouBot",
  "CCBot",
  "Bytespider",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Explicitly welcome AI crawlers to public content + llms.txt files
      ...aiCrawlers.map((bot) => ({
        userAgent: bot,
        allow: ["/", "/llms.txt", "/llms-api.txt", "/llms-full.txt", "/openapi.json"],
        disallow: disallowedPaths,
      })),
      // Default rule for all other crawlers (Google, Bing, etc.)
      {
        userAgent: "*",
        allow: ["/"],
        disallow: disallowedPaths,
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
