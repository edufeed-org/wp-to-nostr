#!/usr/bin/env -S deno run --allow-net --allow-env=NOSTR_PRIVATE_KEY,DRY_RUN,WP_API_URL,WP_CATEGORY,NOSTR_RELAY
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

// ── Konfiguration ─────────────────────────────────────────────────────────────

const WP_API_URL  = Deno.env.get("WP_API_URL")  ?? "https://relilab.org/wp-json/wp/v2/posts";
const WP_CATEGORY = Deno.env.get("WP_CATEGORY") ?? "176";
const NOSTR_RELAY = Deno.env.get("NOSTR_RELAY") ?? "wss://relay-rpi.edufeed.org";
const DRY_RUN     = Deno.env.get("DRY_RUN") === "true";
const PRIVKEY_RAW = Deno.env.get("NOSTR_PRIVATE_KEY") ?? "";

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

// ── WordPress REST-API (mit Pagination) ──────────────────────────────────────

async function fetchWpPosts(): Promise<WpPost[]> {
  const base = new URL(WP_API_URL);
  base.searchParams.set("categories", WP_CATEGORY);
  base.searchParams.set("per_page",   "100");          // WordPress-Maximum
  base.searchParams.set("meta_key",   "relilab_startdate");
  base.searchParams.set("orderby",    "meta_value");
  base.searchParams.set("order",      "desc");

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

// ── WordPress-Post → Nostr-Event mappen ──────────────────────────────────────

function mapPostToNostrEvent(post: WpPost): NostrEventTemplate | null {
  const startTs = wpDateToUnix(post.acf?.relilab_startdate);
  const endTs   = wpDateToUnix(post.acf?.relilab_enddate);

  // Posts ohne Startdatum überspringen (kein gültiges Kalender-Event)
  if (!startTs) return null;

  // d-Tag + r-Tag: originale WordPress-Permalink-URL
  const wpUrl = post.link ?? post.guid?.rendered ?? String(post.id);

  // Titel bereinigen (HTML-Entitäten dekodieren)
  const title = (post.title?.rendered ?? "")
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCharCode(Number(dec)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g,  "<")
    .replace(/&gt;/g,  ">");

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

  // created_at = modified_gmt → Relay ersetzt nur wenn WP-Post sich geändert hat
  // (kind:31923 ist adressierbar-ersetzbar: gleicher d-Tag + gleicher/älterer
  //  created_at → Relay ignoriert das Event, höherer created_at → Relay ersetzt)
  //
  // Fallback: Viele Relays lehnen Events ab deren created_at zu weit in der
  // Vergangenheit liegt ("created_at too early"). Für alte Posts verwenden wir
  // einen festen Mindestwert (2025-01-01), damit:
  //   1. alte unveränderte Posts trotzdem akzeptiert werden
  //   2. der Wert stabil bleibt (gleicher created_at bei jedem Run → Deduplizierung)
  // Wird ein alter Post in WP bearbeitet, steigt modified_gmt über den Floor
  // und der natürliche Wert greift wieder.
  const MIN_CREATED_AT = 1735689600;  // 2025-01-01T00:00:00Z
  const modifiedAt = Math.floor(
    new Date(post.modified_gmt + "Z").getTime() / 1000
  ) || Math.floor(Date.now() / 1000);
  const createdAt = Math.max(modifiedAt, MIN_CREATED_AT);

  return { kind: 31923, created_at: createdAt, tags, content: contentMd };
}

// ── Auf Nostr veröffentlichen ─────────────────────────────────────────────────

async function publishEvent(
  eventTemplate: NostrEventTemplate,
  privkey: Uint8Array,
  relay: Relay
): Promise<void> {
  const signed = finalizeEvent(eventTemplate, privkey);
  console.log(`     → Event-ID: ${signed.id}`);
  await relay.publish(signed);
}

// ── Hauptprogramm ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n🔄 WordPress → Nostr Sync");
  console.log(`   Relay : ${NOSTR_RELAY}`);
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

  // 2. Filtern & mappen
  const events = posts.map(mapPostToNostrEvent).filter(
    (e): e is NostrEventTemplate => e !== null
  );
  console.log(`📅 ${events.length} Termine zum Synchronisieren\n`);

  if (events.length === 0) {
    console.log("✅ Nichts zu veröffentlichen – alles aktuell.");
    return;
  }

  // 3. Veröffentlichen oder Dry-Run-Ausgabe
  let published = 0;
  let skipped   = 0;
  let failed    = 0;

  // Eine einzige Relay-Verbindung für alle Events (statt pro Event eine neue)
  let relay: Relay | null = null;
  if (!DRY_RUN) {
    console.log(`🔌 Verbinde mit ${NOSTR_RELAY} …`);
    relay = await Relay.connect(NOSTR_RELAY);
    console.log("   ✅ Verbunden\n");
  }

  try {
    for (const evt of events) {
      const title    = evt.tags.find((t) => t[0] === "title")?.[1]   ?? "(kein Titel)";
      const startSec = Number(evt.tags.find((t) => t[0] === "start")?.[1] ?? 0);
      const startStr = startSec ? new Date(startSec * 1000).toISOString() : "?";

      console.log(`  📌 "${title}"`);
      console.log(`     Start : ${startStr}`);

      if (DRY_RUN) {
        console.log("     [DRY RUN] Tags:", JSON.stringify(evt.tags));
        console.log(`     [DRY RUN] Content (${evt.content.length} Zeichen): ${evt.content.slice(0, 120)}…`);
      } else {
        try {
          await publishEvent(evt, privkey!, relay!);
          console.log("     ✅ Erfolgreich veröffentlicht");
          published++;
        } catch (err) {
          const msg = (err as Error).message;
          if (msg.includes("replaced: have newer")) {
            console.log("     ⏭️  Übersprungen (Relay hat neuere Version)");
            skipped++;
          } else {
            console.error(`     ❌ Fehler: ${msg}`);
            failed++;
          }
        }
      }
      console.log();
    }
  } finally {
    relay?.close();
    if (!DRY_RUN) console.log("🔌 Relay-Verbindung geschlossen\n");
  }

  // Zusammenfassung
  console.log("📊 Zusammenfassung:");
  if (DRY_RUN) {
    console.log(`   ${events.length} Events bereit (Dry Run – nichts wurde gesendet)`);
  } else {
    console.log(`   ${published} von ${events.length} Events erfolgreich veröffentlicht`);
    if (skipped > 0) console.log(`   ⏭️  ${skipped} Events übersprungen (unverändert)`);
    if (failed > 0) console.log(`   ⚠️  ${failed} Events fehlgeschlagen`);
  }
}

main().catch((err: Error) => {
  console.error("\n💥 Fatal:", err.message);
  Deno.exit(1);
});
