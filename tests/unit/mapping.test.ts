/**
 * Unit-Tests: mapPostToNostrEvent()
 *
 * Testet das WP-Post → Nostr-Event-Mapping (kind:31923).
 */

import { assertEquals, assertExists, assertStrictEquals } from "jsr:@std/assert";
// @deno-types="npm:@types/turndown"
import TurndownService from "turndown";

// ── Abhängigkeiten (isolierte Kopien) ─────────────────────────────────────────

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
const htmlToMarkdown = (html: string): string =>
  html ? turndown.turndown(html).trim() : "";

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

interface WpPost {
  id: number;
  link: string;
  guid: { rendered: string };
  title: { rendered: string };
  content: { rendered: string };
  excerpt: { rendered: string };
  modified_gmt: string;
  acf?: {
    relilab_startdate?: string;
    relilab_enddate?: string;
    relilab_custom_zoom_link?: string;
  };
  featured_image_urls_v2?: { thumbnail?: string[] };
  taxonomy_info?: { post_tag?: Array<{ label: string }> };
}

interface NostrEventTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

function mapPostToNostrEvent(post: WpPost): NostrEventTemplate | null {
  const startTs = wpDateToUnix(post.acf?.relilab_startdate);
  const endTs   = wpDateToUnix(post.acf?.relilab_enddate);
  if (!startTs) return null;
  const wpUrl = post.link ?? post.guid?.rendered ?? String(post.id);
  const title = (post.title?.rendered ?? "")
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCharCode(Number(dec)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const contentMd = htmlToMarkdown(post.content?.rendered ?? "");
  const summaryMd = htmlToMarkdown(post.excerpt?.rendered ?? "");
  const zoomLink  = (post.acf?.relilab_custom_zoom_link ?? "").trim();
  const location  = zoomLink ? `Zoom: ${zoomLink}` : "";
  const image     = post.featured_image_urls_v2?.thumbnail?.[0] ?? "";
  const keywordTags = (post.taxonomy_info?.post_tag ?? []).map((t) => ["t", t.label]);
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
  const createdAt = Math.floor(Date.now() / 1000);
  return { kind: 31923, created_at: createdAt, tags, content: contentMd };
}

// ── Mock-Daten ────────────────────────────────────────────────────────────────

const FULL_POST: WpPost = {
  id: 42,
  link: "https://relilab.org/termine/test-event/",
  guid: { rendered: "https://relilab.org/?p=42" },
  title: { rendered: "Test-Event &amp; Veranstaltung" },
  content: { rendered: "<p>Ausführliche Beschreibung des Events.</p>" },
  excerpt: { rendered: "<p>Kurze Zusammenfassung.</p>" },
  modified_gmt: "2026-03-01T12:00:00",
  acf: {
    relilab_startdate: "2026-04-10 14:00:00",
    relilab_enddate:   "2026-04-10 16:00:00",
    relilab_custom_zoom_link: "https://zoom.us/j/123456789",
  },
  featured_image_urls_v2: { thumbnail: ["https://relilab.org/wp-content/uploads/thumb.jpg"] },
  taxonomy_info: { post_tag: [{ label: "Online" }, { label: "Fortbildung" }] },
};

const MINIMAL_POST: WpPost = {
  id: 1,
  link: "https://relilab.org/termine/minimal/",
  guid: { rendered: "https://relilab.org/?p=1" },
  title: { rendered: "Minimaler Termin" },
  content: { rendered: "" },
  excerpt: { rendered: "" },
  modified_gmt: "2026-01-01T00:00:00",
  acf: { relilab_startdate: "2026-05-01 09:00:00" },
};

// ── Tests: Vollständiger Post ─────────────────────────────────────────────────

Deno.test("kind ist 31923", () => {
  const event = mapPostToNostrEvent(FULL_POST);
  assertExists(event);
  assertStrictEquals(event.kind, 31923);
});

Deno.test("d-Tag = WordPress-URL", () => {
  const event = mapPostToNostrEvent(FULL_POST);
  assertExists(event);
  const dTag = event.tags.find(t => t[0] === "d");
  assertEquals(dTag?.[1], FULL_POST.link);
});

Deno.test("title-Tag: HTML-Entität &amp; wird zu &", () => {
  const event = mapPostToNostrEvent(FULL_POST);
  assertExists(event);
  const titleTag = event.tags.find(t => t[0] === "title");
  assertEquals(titleTag?.[1], "Test-Event & Veranstaltung");
});

Deno.test("start-Tag ist korrekter Unix-Timestamp", () => {
  const event = mapPostToNostrEvent(FULL_POST);
  assertExists(event);
  const startTag = event.tags.find(t => t[0] === "start");
  const ts = Number(startTag?.[1]);
  const utc = new Date(ts * 1000).toISOString();
  assertEquals(utc, "2026-04-10T12:00:00.000Z"); // 14:00 Berlin CEST = 12:00 UTC
});

Deno.test("start_tzid und end_tzid = Europe/Berlin", () => {
  const event = mapPostToNostrEvent(FULL_POST);
  assertExists(event);
  assertEquals(event.tags.find(t => t[0] === "start_tzid")?.[1], "Europe/Berlin");
  assertEquals(event.tags.find(t => t[0] === "end_tzid")?.[1], "Europe/Berlin");
});

Deno.test("summary-Tag vorhanden (Excerpt gesetzt)", () => {
  const event = mapPostToNostrEvent(FULL_POST);
  assertExists(event);
  const summaryTag = event.tags.find(t => t[0] === "summary");
  assertExists(summaryTag);
});

Deno.test("location-Tag = 'Zoom: <url>'", () => {
  const event = mapPostToNostrEvent(FULL_POST);
  assertExists(event);
  const locationTag = event.tags.find(t => t[0] === "location");
  assertEquals(locationTag?.[1], "Zoom: https://zoom.us/j/123456789");
});

Deno.test("image-Tag vorhanden", () => {
  const event = mapPostToNostrEvent(FULL_POST);
  assertExists(event);
  const imageTag = event.tags.find(t => t[0] === "image");
  assertEquals(imageTag?.[1], "https://relilab.org/wp-content/uploads/thumb.jpg");
});

Deno.test("r-Tag = WordPress-URL", () => {
  const event = mapPostToNostrEvent(FULL_POST);
  assertExists(event);
  const rTag = event.tags.find(t => t[0] === "r");
  assertEquals(rTag?.[1], FULL_POST.link);
});

Deno.test("t-Tags für alle Schlagwörter", () => {
  const event = mapPostToNostrEvent(FULL_POST);
  assertExists(event);
  const tTags = event.tags.filter(t => t[0] === "t").map(t => t[1]);
  assertEquals(tTags, ["Online", "Fortbildung"]);
});

// ── Tests: Post ohne Startdatum ────────────────────────────────────────────────

Deno.test("Post ohne acf.relilab_startdate → null", () => {
  const post = { ...FULL_POST, acf: {} };
  assertEquals(mapPostToNostrEvent(post), null);
});

// ── Tests: Minimaler Post ─────────────────────────────────────────────────────

Deno.test("Minimaler Post: kein summary-Tag", () => {
  const event = mapPostToNostrEvent(MINIMAL_POST);
  assertExists(event);
  const summaryTag = event.tags.find(t => t[0] === "summary");
  assertEquals(summaryTag, undefined);
});

Deno.test("Minimaler Post: kein location-Tag", () => {
  const event = mapPostToNostrEvent(MINIMAL_POST);
  assertExists(event);
  assertEquals(event.tags.find(t => t[0] === "location"), undefined);
});

Deno.test("Minimaler Post: kein image-Tag", () => {
  const event = mapPostToNostrEvent(MINIMAL_POST);
  assertExists(event);
  assertEquals(event.tags.find(t => t[0] === "image"), undefined);
});

Deno.test("Minimaler Post: keine t-Tags", () => {
  const event = mapPostToNostrEvent(MINIMAL_POST);
  assertExists(event);
  assertEquals(event.tags.filter(t => t[0] === "t"), []);
});
