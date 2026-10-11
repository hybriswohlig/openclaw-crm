import type { MetadataRoute } from "next";

// Internes CRM: Suchmaschinen und KI-Crawler haben hier nichts zu suchen,
// darum gilt „Disallow: /“ für alle und es gibt keinen Sitemap-Verweis.
// openapi.json und llms*.txt bleiben für externe Agenten abrufbar (die
// Middleware lässt sie ohne Login durch), werden aber nicht mehr beworben.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
