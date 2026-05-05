#!/usr/bin/env -S deno run --allow-net --allow-env=WP_API_URL,WP_CATEGORY,WP_PAGE,NOSTR_PRIVATE_KEY,DRY_RUN,NOSTR_RELAY,EXTRA_HASHTAGS,COMMUNITY_NPUBS
/**
 * inspect-mapping.ts
 *
 * Holt einen einzelnen WordPress-Post und zeigt:
 *   1. Die rohe WordPress-API-Antwort (JSON)
 *   2. Das daraus gemappte Nostr-Event (Tags + Content)
 *   3. Eine Vergleichstabelle Feld für Feld
 *
 * Verwendung:
 *   deno task inspect              # erster Post der Standard-Abfrage
 *   WP_PAGE=3 deno task inspect    # erster Post von Seite 3
 */

// @deno-types="npm:@types/turndown"
import TurndownService from "turndown";
import {
  parseExtraHashtags,
  parseCommunityNpubs,
  mergeExtraHashtags,
  mergeCommunityHTags,
} from "./wp-to-nostr.ts";

const WP_API_URL  = Deno.env.get("WP_API_URL")  ?? "https://relilab.org/wp-json/wp/v2/posts";
const WP_CATEGORY = Deno.env.get("WP_CATEGORY") ?? "176";
const WP_PAGE     = Deno.env.get("WP_PAGE")     ?? "1";
const EXTRA_HASHTAGS_RAW = Deno.env.get("EXTRA_HASHTAGS") ?? "";
const COMMUNITY_NPUBS_RAW = Deno.env.get("COMMUNITY_NPUBS") ?? "";
const EXTRA_HASHTAGS = parseExtraHashtags(EXTRA_HASHTAGS_RAW);
const COMMUNITY_HEX_PUBKEYS = parseCommunityNpubs(COMMUNITY_NPUBS_RAW);

// ── HTML → Markdown (identisch zu wp-to-nostr.ts) ────────────────────────────

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
const htmlToMarkdown = (html: string) => html ? turndown.turndown(html).trim() : "";

// ── Datum → Unix-Timestamp ────────────────────────────────────────────────────

function wpDateToUnix(dateStr: string | undefined): number {
  if (!dateStr) return 0;
  const naiveUtc = new Date(dateStr.replace(" ", "T") + "Z");
  if (isNaN(naiveUtc.getTime())) return 0;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(naiveUtc);

  const g = (type: string) => parts.find(p => p.type === type)?.value ?? "00";
  const berlinWallClock = new Date(
    `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:${g("second")}Z`
  );

  const offsetMs = naiveUtc.getTime() - berlinWallClock.getTime();
  return Math.floor((naiveUtc.getTime() + offsetMs) / 1000);
}

// ── Hilfsfunktionen für die Ausgabe ──────────────────────────────────────────

const hr  = (char = "─", len = 80) => char.repeat(len);
const col = (s: string, w: number) => s.length > w ? s.slice(0, w - 1) + "…" : s.padEnd(w);

function printTable(rows: [string, string, string][]) {
  const [w0, w1, w2] = [22, 26, 26];
  const line = `├${"─".repeat(w0+2)}┼${"─".repeat(w1+2)}┼${"─".repeat(w2+2)}┤`;
  const header = `│ ${col("WP-Feld", w0)} │ ${col("WP-Wert (gekürzt)", w1)} │ ${col("Nostr-Tag / -Wert", w2)} │`;
  const top    = `┌${"─".repeat(w0+2)}┬${"─".repeat(w1+2)}┬${"─".repeat(w2+2)}┐`;
  const bot    = `└${"─".repeat(w0+2)}┴${"─".repeat(w1+2)}┴${"─".repeat(w2+2)}┘`;

  console.log(top);
  console.log(header);
  console.log(line);
  for (const [f, v, n] of rows) {
    console.log(`│ ${col(f, w0)} │ ${col(v, w1)} │ ${col(n, w2)} │`);
  }
  console.log(bot);
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

const url = new URL(WP_API_URL);
url.searchParams.set("categories", WP_CATEGORY);
url.searchParams.set("per_page",   "1");
url.searchParams.set("page",       WP_PAGE);
url.searchParams.set("meta_key",   "relilab_startdate");
url.searchParams.set("orderby",    "meta_value");
url.searchParams.set("order",      "desc");

console.log(`\n${hr()}`);
console.log(`  Inspect-Mapping – 1 Post von Seite ${WP_PAGE}`);
console.log(`  ${url}`);
console.log(hr());

const res = await fetch(url.toString());
if (!res.ok) {
  console.error(`WordPress API Fehler: ${res.status} ${res.statusText}`);
  Deno.exit(1);
}

// deno-lint-ignore no-explicit-any
const posts: any[] = await res.json();
const p = posts[0];
if (!p) { console.error("Keine Posts gefunden."); Deno.exit(1); }

// ── 1. Rohe WordPress-API-Antwort ────────────────────────────────────────────

console.log("\n\x1b[1m① WordPress-API-Antwort (roh)\x1b[0m\n");
// Nur relevante Felder anzeigen, nicht den gesamten HTML-Content
const wpRaw = {
  id:               p.id,
  link:             p.link,
  guid:             p.guid?.rendered,
  modified_gmt:     p.modified_gmt,
  "title.rendered": p.title?.rendered,
  "acf.relilab_startdate":          p.acf?.relilab_startdate,
  "acf.relilab_enddate":            p.acf?.relilab_enddate,
  "acf.relilab_custom_zoom_link":   p.acf?.relilab_custom_zoom_link,
  "featured_image_urls_v2.thumbnail[0]": p.featured_image_urls_v2?.thumbnail?.[0],
  "taxonomy_info.post_tag":         p.taxonomy_info?.post_tag?.map((t: {label:string}) => t.label),
  "excerpt.rendered (Anfang)":      (p.excerpt?.rendered ?? "").slice(0, 120),
  "content.rendered (Anfang)":      (p.content?.rendered ?? "").slice(0, 120),
};
console.log(JSON.stringify(wpRaw, null, 2));

// ── 2. Gemapptes Nostr-Event ──────────────────────────────────────────────────

const wpUrl    = p.link ?? p.guid?.rendered ?? String(p.id);
const startTs  = wpDateToUnix(p.acf?.relilab_startdate);
const endTs    = wpDateToUnix(p.acf?.relilab_enddate);
const title    = (p.title?.rendered ?? "")
  .replace(/&#(\d+);/g, (_: string, dec: string) => String.fromCharCode(Number(dec)))
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const zoomLink = (p.acf?.relilab_custom_zoom_link ?? "").trim();
const location = zoomLink ? `Zoom: ${zoomLink}` : "";
const image    = p.featured_image_urls_v2?.thumbnail?.[0] ?? "";
const summaryMd = htmlToMarkdown(p.excerpt?.rendered ?? "");
const contentMd = htmlToMarkdown(p.content?.rendered ?? "");
const keywordTags: string[][] = (p.taxonomy_info?.post_tag ?? [])
  .map((t: {label:string}) => ["t", t.label]);

const tags: string[][] = [
  ["d",          wpUrl],
  ["title",      title],
  ["start",      String(startTs)],
  ["start_tzid", "Europe/Berlin"],
  ["end",        String(endTs)],
  ["end_tzid",   "Europe/Berlin"],
];
if (summaryMd) tags.push(["summary", summaryMd]);
if (location)  tags.push(["location", location]);
if (image)     tags.push(["image", image]);
tags.push(["r", wpUrl]);
tags.push(...keywordTags);

let enrichedTags = mergeExtraHashtags(tags, EXTRA_HASHTAGS);
enrichedTags = mergeCommunityHTags(enrichedTags, COMMUNITY_HEX_PUBKEYS);

// created_at = modified_gmt → Relay ersetzt nur wenn WP-Post sich geändert hat
const createdAt = Math.floor(
  new Date(p.modified_gmt + "Z").getTime() / 1000
) || Math.floor(Date.now() / 1000);

const nostrEvent = {
  kind:       31923,
  created_at: createdAt,
  tags:       enrichedTags,
  content:    contentMd,
};

console.log("\n\x1b[1m② Gemapptes Nostr-Event (kind:31923)\x1b[0m\n");
console.log(JSON.stringify(nostrEvent, null, 2));

// ── 3. Vergleichstabelle ──────────────────────────────────────────────────────

console.log("\n\x1b[1m③ Vergleichstabelle: WordPress → Nostr\x1b[0m\n");

const rows: [string, string, string][] = [
  ["link",                        wpUrl,                                    `d: ${wpUrl}`],
  ["title.rendered",              p.title?.rendered ?? "",                  `title: ${title}`],
  ["acf.relilab_startdate",       p.acf?.relilab_startdate ?? "(leer)",    `start: ${startTs} (${new Date(startTs*1000).toISOString()})`],
  ["(fest)",                      "Europe/Berlin",                          "start_tzid: Europe/Berlin"],
  ["acf.relilab_enddate",         p.acf?.relilab_enddate   ?? "(leer)",    `end:   ${endTs} (${new Date(endTs*1000).toISOString()})`],
  ["(fest)",                      "Europe/Berlin",                          "end_tzid: Europe/Berlin"],
  ["excerpt.rendered",            (p.excerpt?.rendered ?? "").slice(0,40), `summary: ${summaryMd.slice(0,40)}`],
  ["content.rendered",            (p.content?.rendered ?? "").slice(0,40), `content: ${contentMd.slice(0,40)}`],
  ["relilab_custom_zoom_link",    zoomLink || "(leer)",                     location ? `location: ${location}` : "(kein location-Tag)"],
  ["featured_image_urls_v2[0]",   image || "(leer)",                       image ? `image: ${image}` : "(kein image-Tag)"],
  ["taxonomy_info.post_tag",      keywordTags.map(t=>t[1]).join(", "),     `${keywordTags.length}× t-Tag`],
  ["link (Quellverweis)",         wpUrl,                                    `r: ${wpUrl}`],
  ["modified_gmt",                p.modified_gmt ?? "(leer)",             `created_at: ${createdAt} (= modified_gmt)`],
];

printTable(rows);
console.log();
