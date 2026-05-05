#!/usr/bin/env -S deno run --allow-net --allow-env=NOSTR_PRIVATE_KEY,DRY_RUN,FORCE_REPUBLISH,SYNC_MODE,WP_API_URL,WP_CATEGORY,NOSTR_RELAY,NOSTR_RELAYS,EXTRA_HASHTAGS,COMMUNITY_NPUBS
/**
 * wp-to-nostr.ts
 *
 * Holt WordPress-Termine über die REST-API und veröffentlicht sie als
 * Nostr kind:31923 Calendar-Events (NIP-52).
 *
 * Lokal testen (Dry-Run, kein Posting):
 *   deno task dry-run
 *
 * Lokal live (postet auf Relay):
 *   NOSTR_PRIVATE_KEY=nsec1… deno task start
 *
 * Konfiguration über Umgebungsvariablen:
 *   NOSTR_PRIVATE_KEY  – nsec1… oder 64-stellige Hex-Zeichenkette (Pflicht im Live-Modus)
 *   DRY_RUN            – 'true' → nur anzeigen, nichts posten (Standard: 'false')
 *   WP_API_URL         – WordPress REST-API-Endpunkt
 *                        (Standard: https://relilab.org/wp-json/wp/v2/posts)
 *   WP_CATEGORY        – Kategorie-ID (Standard: 176)
 *   NOSTR_RELAY        – Relay-URL (Standard: wss://relay-rpi.edufeed.org)
 */

// @deno-types="npm:@types/turndown"
import TurndownService from "turndown";
import { finalizeEvent, getPublicKey } from "nostr-tools";
import { Relay } from "nostr-tools/relay";
import { decode } from "nostr-tools/nip19";
// Deno hat natives WebSocket – kein ws-Paket nötig

// ── Typen ─────────────────────────────────────────────────────────────────────

interface WpPost {
  id: number;
  link: string;
  guid: { rendered: string };
  title: { rendered: string };
  content: { rendered: string };
  excerpt: { rendered: string };
  date_gmt: string;
  modified_gmt: string;
  acf?: {
    relilab_startdate?: string;
    relilab_enddate?: string;
    relilab_custom_zoom_link?: string;
  };
  featured_image_urls_v2?: { thumbnail?: string[] };
  taxonomy_info?: { post_tag?: Array<{ label: string }> };
  _embedded?: {
    author?: Array<{ name?: string; link?: string }>;
  };
}

type SyncMode = "calendar" | "article";

interface NostrEventTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

// ── Konfiguration ─────────────────────────────────────────────────────────────

const WP_API_URL  = Deno.env.get("WP_API_URL")  ?? "https://relilab.org/wp-json/wp/v2/posts";
const WP_CATEGORY = Deno.env.get("WP_CATEGORY") ?? "176";
// Komma-separierte Relay-Liste. Beide Variablen werden zusammengeführt:
// - NOSTR_RELAY (Singular, rückwärtskompatibel zu früheren Workflow-Configs)
// - NOSTR_RELAYS (Plural, primär verwendet)
// Default = ein einzelnes edufeed-Relay, damit ein leerer Forks-Setup auch
// ohne explizite Konfiguration funktioniert.
const NOSTR_RELAY_RAW  = Deno.env.get("NOSTR_RELAY")  ?? "";
const NOSTR_RELAYS_RAW = Deno.env.get("NOSTR_RELAYS") ?? "";
const NOSTR_RELAYS = parseRelayList(`${NOSTR_RELAYS_RAW},${NOSTR_RELAY_RAW}`);
if (NOSTR_RELAYS.length === 0) NOSTR_RELAYS.push("wss://relay-rpi.edufeed.org");
const DRY_RUN     = Deno.env.get("DRY_RUN") === "true";
const FORCE_REPUBLISH = Deno.env.get("FORCE_REPUBLISH") === "true";
const SYNC_MODE: SyncMode = (Deno.env.get("SYNC_MODE") ?? "calendar") === "article"
  ? "article"
  : "calendar";
const PRIVKEY_RAW = Deno.env.get("NOSTR_PRIVATE_KEY") ?? "";
const EXTRA_HASHTAGS_RAW = Deno.env.get("EXTRA_HASHTAGS") ?? "";
const COMMUNITY_NPUBS_RAW = Deno.env.get("COMMUNITY_NPUBS") ?? "";

const EXTRA_HASHTAGS = parseExtraHashtags(EXTRA_HASHTAGS_RAW);
const COMMUNITY_HEX_PUBKEYS = parseCommunityNpubs(COMMUNITY_NPUBS_RAW);

// ── Privaten Schlüssel auflösen ───────────────────────────────────────────────

function resolvePrivkey(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("NOSTR_PRIVATE_KEY ist nicht gesetzt.");

  // nsec-Format (bech32)
  if (trimmed.startsWith("nsec")) {
    const decoded = decode(trimmed);
    if (decoded.type !== "nsec") throw new Error("Ungültiger nsec-Schlüssel.");
    return decoded.data as Uint8Array;
  }

  // Hex-Format (64 Zeichen)
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return Uint8Array.from(
      trimmed.match(/.{2}/g)!.map((byte) => parseInt(byte, 16))
    );
  }

  throw new Error("NOSTR_PRIVATE_KEY muss nsec1… oder eine 64-stellige Hex-Zeichenkette sein.");
}

// ── HTML → Markdown ───────────────────────────────────────────────────────────

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

function htmlToMarkdown(html: string): string {
  if (!html) return "";
  return turndown.turndown(html).trim();
}

// ── Relay-Liste parsen ────────────────────────────────────────────────────────
// Akzeptiert eine komma-separierte Liste von Relay-URLs. Dedupliziert
// case-insensitive auf der URL (z. B. WSS://Relay vs wss://relay).
// Leere Einträge werden ignoriert.

export function parseRelayList(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawEntry of raw.split(",")) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    const norm = entry.toLowerCase();
    if (!seen.has(norm)) {
      seen.add(norm);
      result.push(entry);
    }
  }
  return result;
}

// ── Hashtag-Anreicherung ──────────────────────────────────────────────────────

export function parseExtraHashtags(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim().replace(/^#/, ""))
    .filter((entry) => entry.length > 0);
}

export function mergeExtraHashtags(
  tags: string[][],
  extras: string[],
): string[][] {
  const existing = new Set(
    tags
      .filter((t) => t[0] === "t")
      .map((t) => (t[1] ?? "").toLowerCase()),
  );
  const result = tags.map((t) => [...t]);
  for (const extra of extras) {
    const norm = extra.toLowerCase();
    if (!existing.has(norm)) {
      result.push(["t", extra]);
      existing.add(norm);
    }
  }
  return result;
}

// ── Community-Zuordnung (Communikey h-Tag) ────────────────────────────────────

export function parseCommunityNpubs(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawEntry of raw.split(",")) {
    const entry = rawEntry.trim();
    if (!entry) continue;

    let hex: string;
    if (entry.startsWith("npub1")) {
      let decoded;
      try {
        decoded = decode(entry);
      } catch (err) {
        throw new Error(`COMMUNITY_NPUBS: ungültiger Eintrag „${entry}" (${(err as Error).message})`);
      }
      if (decoded.type !== "npub") {
        throw new Error(`COMMUNITY_NPUBS: ungültiger Eintrag „${entry}" (Typ ${decoded.type})`);
      }
      hex = (decoded.data as string).toLowerCase();
    } else if (/^[0-9a-f]{64}$/i.test(entry)) {
      hex = entry.toLowerCase();
    } else {
      throw new Error(`COMMUNITY_NPUBS: ungültiger Eintrag „${entry}"`);
    }

    if (!seen.has(hex)) {
      seen.add(hex);
      result.push(hex);
    }
  }
  return result;
}

export function mergeCommunityHTags(
  tags: string[][],
  hexPubkeys: string[],
): string[][] {
  const existing = new Set(
    tags
      .filter((t) => t[0] === "h")
      .map((t) => (t[1] ?? "").toLowerCase()),
  );
  const result = tags.map((t) => [...t]);
  for (const hex of hexPubkeys) {
    const norm = hex.toLowerCase();
    if (!existing.has(norm)) {
      result.push(["h", hex]);
      existing.add(norm);
    }
  }
  return result;
}

// ── WordPress REST-API (mit Pagination) ──────────────────────────────────────

async function fetchWpPosts(): Promise<WpPost[]> {
  const base = new URL(WP_API_URL);
  base.searchParams.set("categories", WP_CATEGORY);
  base.searchParams.set("per_page",   "100");          // WordPress-Maximum

  if (SYNC_MODE === "calendar") {
    // Termine: nach relilab_startdate sortieren (ACF-Custom-Field)
    base.searchParams.set("meta_key", "relilab_startdate");
    base.searchParams.set("orderby",  "meta_value");
    base.searchParams.set("order",    "desc");
  } else {
    // Article: nach Veröffentlichungsdatum, mit Autor-Embed
    base.searchParams.set("orderby", "date");
    base.searchParams.set("order",   "desc");
    base.searchParams.set("_embed",  "author");
  }

  const all: WpPost[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    base.searchParams.set("page", String(page));
    console.log(`  Seite ${page}/${totalPages} – ${base}`);

    const res = await fetch(base.toString());
    if (!res.ok) throw new Error(`WordPress API Fehler (Seite ${page}): ${res.status} ${res.statusText}`);

    // Gesamtseitenanzahl aus Response-Header lesen
    totalPages = Number(res.headers.get("X-WP-TotalPages") ?? "1");
    const posts = await res.json() as WpPost[];
    all.push(...posts);
    page++;
  } while (page <= totalPages);

  return all;
}

// ── Datumskonvertierung ───────────────────────────────────────────────────────
// WP speichert "YYYY-MM-DD HH:MM:SS" als Berliner Lokalzeit (kein TZ-Suffix).
// Vorgehen: naive UTC-Referenz → Intl zeigt Berliner Wanduhrzeit zu diesem
// UTC-Moment → Differenz = Berliner UTC-Offset → korrigierter Unix-Timestamp.
//
// Beispiel: "2026-03-13 16:00:00" (Berlin CET = UTC+1)
//   naiveUtc  → 16:00 UTC (falsch, aber Referenz)
//   Berlin zeigt bei 16:00 UTC → 17:00 Uhr
//   offsetMs  = 16:00 UTC − 17:00 UTC = −3600 ms
//   Ergebnis  = 16:00 UTC + (−1h) = 15:00 UTC ✓  (= 16:00 Berlin)

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

// ── created_at-Berechnung (gemeinsam für Calendar + Article) ─────────────────
// kind:31923 und kind:30023 sind beide adressierbar — gleicher d-Tag +
// gleicher/älterer created_at → Relay ignoriert das Event, höherer →
// Relay ersetzt. Wir nutzen modified_gmt mit einem 2025-01-01-Floor, damit
// alte Posts nicht "too early" abgelehnt werden. FORCE_REPUBLISH=true
// überschreibt einmalig mit Date.now(), für rückwirkende Anreicherungen.

function computeCreatedAt(modifiedGmt: string): number {
  const MIN_CREATED_AT = 1735689600;  // 2025-01-01T00:00:00Z
  const modifiedAt = Math.floor(
    new Date(modifiedGmt + "Z").getTime() / 1000
  ) || Math.floor(Date.now() / 1000);
  return FORCE_REPUBLISH
    ? Math.floor(Date.now() / 1000)
    : Math.max(modifiedAt, MIN_CREATED_AT);
}

// ── HTML-Entitäten in Titel dekodieren ───────────────────────────────────────
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCharCode(Number(dec)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g,  "<")
    .replace(/&gt;/g,  ">");
}

// ── WordPress-Post → Nostr-Event mappen ──────────────────────────────────────

function mapPostToCalendarEvent(post: WpPost): NostrEventTemplate | null {
  const startTs = wpDateToUnix(post.acf?.relilab_startdate);
  const endTs   = wpDateToUnix(post.acf?.relilab_enddate);

  // Posts ohne Startdatum überspringen (kein gültiges Kalender-Event)
  if (!startTs) return null;

  // d-Tag + r-Tag: originale WordPress-Permalink-URL
  const wpUrl = post.link ?? post.guid?.rendered ?? String(post.id);

  // Titel bereinigen (HTML-Entitäten dekodieren)
  const title = decodeHtmlEntities(post.title?.rendered ?? "");

  // HTML → Markdown
  const contentMd = htmlToMarkdown(post.content?.rendered ?? "");
  const summaryMd = htmlToMarkdown(post.excerpt?.rendered ?? "");

  // Location (Zoom-Link)
  const zoomLink = (post.acf?.relilab_custom_zoom_link ?? "").trim();
  const location = zoomLink ? `Zoom: ${zoomLink}` : "";

  // Beitragsbild
  const image = post.featured_image_urls_v2?.thumbnail?.[0] ?? "";

  // Schlagwörter → ["t", label]
  const keywordTags = (post.taxonomy_info?.post_tag ?? [])
    .map((t) => ["t", t.label]);

  // Nostr-Tags-Array (NIP-52 / kind 31923)
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

  return {
    kind: 31923,
    created_at: computeCreatedAt(post.modified_gmt),
    tags: enrichedTags,
    content: contentMd,
  };
}

// ── WordPress-Post → Nostr Long-Form-Article (kind:30023) ────────────────────
// Für Beiträge ohne Termin-Charakter (z. B. Lernmodule, Blog-Posts).
// Autor*in wird als Markdown-Header oben in den Content eingefügt — solange
// keine eigenen Autoren-npubs existieren, bleibt die Zuschreibung im Text
// sichtbar und kann später durch echte pubkey-Zuordnung ersetzt werden.
export function mapPostToArticleEvent(post: WpPost): NostrEventTemplate {
  const wpUrl = post.link ?? post.guid?.rendered ?? String(post.id);
  const title = decodeHtmlEntities(post.title?.rendered ?? "");
  const contentMd = htmlToMarkdown(post.content?.rendered ?? "");
  const summaryMd = htmlToMarkdown(post.excerpt?.rendered ?? "");
  const image = post.featured_image_urls_v2?.thumbnail?.[0] ?? "";

  // published_at: WP-Veröffentlichungs-Zeitstempel (date_gmt) — bleibt stabil,
  // unabhängig von späteren Bearbeitungen. created_at hingegen reflektiert
  // die letzte Änderung (für Replace-Logik).
  const publishedAt = Math.floor(
    new Date(post.date_gmt + "Z").getTime() / 1000
  ) || Math.floor(Date.now() / 1000);

  // Autor-Header in den Content packen — sichtbare Zuschreibung
  const author = post._embedded?.author?.[0];
  const authorName = author?.name ?? "";
  const authorLink = author?.link ?? "";
  const authorLine = authorName
    ? authorLink
      ? `> Erstellt von: [${authorName}](${authorLink})`
      : `> Erstellt von: ${authorName}`
    : "";
  const sourceLine = `> Veröffentlicht auf [relilab.org](${wpUrl})`;
  const headerBlock = [authorLine, sourceLine].filter(Boolean).join("\n") + "\n\n";
  const fullContent = headerBlock + contentMd;

  const keywordTags = (post.taxonomy_info?.post_tag ?? [])
    .map((t) => ["t", t.label]);

  // Nostr-Tags-Array (NIP-23 / kind 30023)
  const tags: string[][] = [
    ["d",            wpUrl],
    ["title",        title],
    ["published_at", String(publishedAt)],
  ];
  if (summaryMd) tags.push(["summary", summaryMd]);
  if (image)     tags.push(["image", image]);
  tags.push(["r", wpUrl]);
  tags.push(...keywordTags);

  let enrichedTags = mergeExtraHashtags(tags, EXTRA_HASHTAGS);
  enrichedTags = mergeCommunityHTags(enrichedTags, COMMUNITY_HEX_PUBKEYS);

  return {
    kind: 30023,
    created_at: computeCreatedAt(post.modified_gmt),
    tags: enrichedTags,
    content: fullContent,
  };
}

// ── Auf Nostr veröffentlichen ─────────────────────────────────────────────────

interface PublishResult {
  url: string;
  ok: boolean;
  error?: string;
  skipped?: boolean;  // Relay hat neuere Version
}

// Publiziert ein Event auf alle übergebenen Relays parallel. Failures auf
// einzelnen Relays brechen den Lauf nicht ab — sie werden im Ergebnis
// dokumentiert und nach allen Events aggregiert.
async function publishEvent(
  eventTemplate: NostrEventTemplate,
  privkey: Uint8Array,
  relays: Array<{ url: string; relay: Relay | null }>,
): Promise<PublishResult[]> {
  const signed = finalizeEvent(eventTemplate, privkey);
  console.log(`     → Event-ID: ${signed.id}`);

  const results = await Promise.all(
    relays.map(async ({ url, relay }): Promise<PublishResult> => {
      if (!relay) return { url, ok: false, error: "nicht verbunden" };
      try {
        await relay.publish(signed);
        return { url, ok: true };
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes("replaced: have newer")) {
          return { url, ok: true, skipped: true };
        }
        return { url, ok: false, error: msg };
      }
    }),
  );
  return results;
}

// ── Hauptprogramm ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const modeLabel = SYNC_MODE === "article"
    ? "📰 Article-Sync (kind:30023 Long-Form)"
    : "📅 Calendar-Sync (kind:31923 Termine)";

  console.log(`\n🔄 WordPress → Nostr Sync — ${modeLabel}`);
  console.log(`   Relays: ${NOSTR_RELAYS.join(", ")}`);
  console.log(`   Modus : ${DRY_RUN
    ? "🧪 DRY RUN – keine Events werden tatsächlich gesendet"
    : "🚀 LIVE – Events werden auf Nostr veröffentlicht"}\n`);

  // Privaten Schlüssel nur im Live-Modus laden
  let privkey: Uint8Array | null = null;
  if (!DRY_RUN) {
    privkey = resolvePrivkey(PRIVKEY_RAW);
    const pubkey = getPublicKey(privkey);
    console.log(`🔑 Öffentlicher Schlüssel (hex): ${pubkey}\n`);
  }

  // 1. WordPress-Posts holen
  console.log("📥 WordPress-Posts abrufen …");
  const posts = await fetchWpPosts();
  console.log(`   ${posts.length} Posts gefunden\n`);

  // 2. Filtern & mappen — je nach SYNC_MODE
  const events: NostrEventTemplate[] = SYNC_MODE === "article"
    ? posts.map(mapPostToArticleEvent)
    : posts.map(mapPostToCalendarEvent).filter(
        (e): e is NostrEventTemplate => e !== null,
      );
  const itemLabel = SYNC_MODE === "article" ? "Artikel" : "Termine";
  console.log(`📅 ${events.length} ${itemLabel} zum Synchronisieren\n`);

  if (events.length === 0) {
    console.log("✅ Nichts zu veröffentlichen – alles aktuell.");
    return;
  }

  // 3. Veröffentlichen oder Dry-Run-Ausgabe
  // Pro Relay separat zählen, plus Gesamt-Erfolg pro Event (mind. 1 Relay
  // hat das Event akzeptiert). Schickt das Event aber an alle Relays parallel.
  const perRelayStats = new Map<string, { ok: number; skipped: number; failed: number }>();
  for (const url of NOSTR_RELAYS) {
    perRelayStats.set(url, { ok: 0, skipped: 0, failed: 0 });
  }
  let eventsAcceptedSomewhere = 0;
  let eventsRejectedEverywhere = 0;

  // Verbindungs-Pool aufbauen — eine Connection pro Relay, geteilt über alle
  // Events. Failures beim Connect werden nicht fatal: das Relay wird mit
  // null markiert und beim Publish übersprungen.
  const relayPool: Array<{ url: string; relay: Relay | null }> = [];
  if (!DRY_RUN) {
    console.log(`🔌 Verbinde mit ${NOSTR_RELAYS.length} Relay(s) …`);
    for (const url of NOSTR_RELAYS) {
      try {
        const relay = await Relay.connect(url);
        relayPool.push({ url, relay });
        console.log(`   ✅ ${url}`);
      } catch (err) {
        relayPool.push({ url, relay: null });
        console.error(`   ❌ ${url}: ${(err as Error).message}`);
      }
    }
    console.log();
  }

  try {
    for (const evt of events) {
      const title    = evt.tags.find((t) => t[0] === "title")?.[1]   ?? "(kein Titel)";
      console.log(`  📌 "${title}"`);

      // Calendar: Start-Zeit anzeigen. Article: published_at.
      if (SYNC_MODE === "article") {
        const pubSec = Number(evt.tags.find((t) => t[0] === "published_at")?.[1] ?? 0);
        const pubStr = pubSec ? new Date(pubSec * 1000).toISOString().slice(0, 10) : "?";
        console.log(`     Veröff.: ${pubStr}`);
      } else {
        const startSec = Number(evt.tags.find((t) => t[0] === "start")?.[1] ?? 0);
        const startStr = startSec ? new Date(startSec * 1000).toISOString() : "?";
        console.log(`     Start : ${startStr}`);
      }

      if (DRY_RUN) {
        console.log("     [DRY RUN] Tags:", JSON.stringify(evt.tags));
        console.log(`     [DRY RUN] Content (${evt.content.length} Zeichen): ${evt.content.slice(0, 120)}…`);
      } else {
        const results = await publishEvent(evt, privkey!, relayPool);
        let acceptedCount = 0;
        for (const r of results) {
          const stat = perRelayStats.get(r.url)!;
          if (r.ok && r.skipped) {
            stat.skipped++;
            acceptedCount++;
          } else if (r.ok) {
            stat.ok++;
            acceptedCount++;
          } else {
            stat.failed++;
            console.error(`     ❌ ${r.url}: ${r.error}`);
          }
        }
        const okCount = results.filter((r) => r.ok && !r.skipped).length;
        const skipCount = results.filter((r) => r.ok && r.skipped).length;
        const failCount = results.filter((r) => !r.ok).length;
        console.log(`     ✅ ${okCount} ok, ⏭️  ${skipCount} skipped, ❌ ${failCount} failed`);

        if (acceptedCount > 0) eventsAcceptedSomewhere++;
        else eventsRejectedEverywhere++;
      }
      console.log();
    }
  } finally {
    for (const { relay } of relayPool) relay?.close();
    if (!DRY_RUN) console.log("🔌 Relay-Verbindungen geschlossen\n");
  }

  // Zusammenfassung
  console.log("📊 Zusammenfassung:");
  if (DRY_RUN) {
    console.log(`   ${events.length} Events bereit (Dry Run – nichts wurde gesendet)`);
  } else {
    console.log(`   ${eventsAcceptedSomewhere}/${events.length} Events von mindestens einem Relay akzeptiert`);
    if (eventsRejectedEverywhere > 0) {
      console.log(`   ⚠️  ${eventsRejectedEverywhere} Events von keinem Relay akzeptiert`);
    }
    console.log(`   Pro Relay:`);
    for (const [url, s] of perRelayStats) {
      console.log(`     ${url}: ${s.ok} ok · ${s.skipped} skipped · ${s.failed} failed`);
    }
  }
}

if (import.meta.main) {
  main().catch((err: Error) => {
    console.error("\n💥 Fatal:", err.message);
    Deno.exit(1);
  });
}
