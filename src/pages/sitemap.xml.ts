import { getCollection } from "astro:content";
import type { APIRoute } from "astro";

const staticPaths = ["/", "/projects/", "/writeups/", "/about/", "/contact/", "/security/"];

export const GET: APIRoute = async ({ site }) => {
  if (!site) {
    throw new Error("Set `site` in astro.config.mjs so the sitemap can use absolute URLs.");
  }
  const projects = await getCollection("projects");
  const writeups = await getCollection("writeups", ({ data }) => !data.draft);
  const paths = [
    ...staticPaths,
    ...projects.map((entry) => `/projects/${entry.id}/`),
    ...writeups.map((entry) => `/writeups/${entry.id}/`),
  ];
  const urls = paths.map((path) => `  <url><loc>${new URL(path, site).href}</loc></url>`);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
