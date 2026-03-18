#!/usr/bin/env -S deno run --allow-net --allow-env=NOSTR_PRIVATE_KEY,NOSTR_RELAY,WP_API_URL,WP_CATEGORY,WP_PAGE
/**
 * publish-and-verify.ts
 *
 * Publiziert genau 1 Event auf den Relay und verifiziert danach,
 * dass es vollständig und korrekt angekommen ist.
 *
 * Verwendung:
 *   NOSTR_PRIVATE_KEY=nsec1… deno task test:publish
 *   NOSTR_PRIVATE_KEY=nsec1… WP_PAGE=2 deno task test:publish   # Post von Seite 2
 */

// @deno-types="npm:@types/turndown"
import TurndownService from "turndown";
import { finalizeEvent, getPublicKey, verifyEvent } from "nostr-tools";
import { Relay } from "nostr-tools/relay";
import { decode } from "nostr-tools/nip19";

// ── Konfiguration ─────────────────────────────────────────────────────────────

const WP_API_URL  = Deno.env.get("WP_API_URL")  ?? "https://relilab.org/wp-json/wp/v2/posts";
const WP_CATEGORY = Deno.env.get("WP_CATEGORY") ?? "176";
const WP_PAGE     = Deno.env.get("WP_PAGE")     ?? "1";
const NOSTR_RELAY = Deno.env.get("NOSTR_RELAY") ?? "wss://relay-rpi.edufeed.org";
const PRIVKEY_RAW = Deno.env.get("NOSTR_PRIVATE_KEY") ?? "";

if (!PRIVKEY_RAW) {
  console.error("❌ NOSTR_PRIVATE_KEY ist nicht gesetzt.");
  Deno.exit(1);
}

// ── Privaten Schlüssel auflösen ───────────────────────────────────────────────

function resolvePrivkey(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (trimmed.startsWith("nsec")) {
    const decoded = decode(trimmed);
    if (decoded.type !== "nsec") throw new Error("Ungültiger nsec-Schlüssel.");
    return decoded.data as Uint8Array;
  }
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return Uint8Array.from(trimmed.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  }
  throw new Error("Ungültiger Schlüssel.");
}

// ── HTML → Markdown ───────────────────────────────────────────────────────────

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
const htmlToMarkdown = (html: string) => html ? turndown.turndown(html).trim() : "";

// ── Datumskonvertierung ───────────────────────────────────────────────────────

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

// ── Einen WordPress-Post holen ────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function fetchOnePost(): Promise<any> {
  const url = new URL(WP_API_URL);
  url.searchParams.set("categories", WP_CATEGORY);
  url.searchParams.set("per_page", "1");
  url.searchParams.set("page", WP_PAGE);
  url.searchParams.set("meta_key", "relilab_startdate");
  url.searchParams.set("orderby", "meta_value");
  url.searchParams.set("order", "desc");

  console.log(`\n📥 Hole Post von: ${url}`);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API-Fehler: ${res.status}`);
  const posts = await res.json();
  if (!posts[0]) throw new Error("Keine Posts gefunden.");
  return posts[0];
}

// ── Post → Nostr-Event mappen ─────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
function mapPost(post: any) {
  const startTs = wpDateToUnix(post.acf?.relilab_startdate);
  const endTs   = wpDateToUnix(post.acf?.relilab_enddate);
  if (!startTs) throw new Error("Post hat kein Startdatum.");

  const wpUrl     = post.link ?? post.guid?.rendered ?? String(post.id);
  const title     = (post.title?.rendered ?? "")
    .replace(/&#(\d+);/g, (_: string, dec: string) => String.fromCharCode(Number(dec)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const contentMd = htmlToMarkdown(post.content?.rendered ?? "");
  const summaryMd = htmlToMarkdown(post.excerpt?.rendered ?? "");
  const zoomLink  = (post.acf?.relilab_custom_zoom_link ?? "").trim();
  const location  = zoomLink ? `Zoom: ${zoomLink}` : "";
  const image     = post.featured_image_urls_v2?.thumbnail?.[0] ?? "";
  // deno-lint-ignore no-explicit-any
  const keywordTags = (post.taxonomy_info?.post_tag ?? []).map((t: any) => ["t", t.label]);

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

  return {
    kind: 31923,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: contentMd,
    // Rohdaten für Vergleich
    _wp: { title, wpUrl, startTs, endTs, summaryMd, location, image,
           tags: keywordTags.map((t: string[]) => t[1]) },
  };
}

// ── Auf Relay abfragen ────────────────────────────────────────────────────────

async function fetchFromRelay(
  relay: InstanceType<typeof Relay>,
  filter: Record<string, unknown>,
  timeoutMs = 5000
// deno-lint-ignore no-explicit-any
): Promise<any[]> {
  // deno-lint-ignore no-explicit-any
  return new Promise<any[]>((resolve) => {
    // deno-lint-ignore no-explicit-any
    const events: any[] = [];
    const timer = setTimeout(() => resolve(events), timeoutMs);

    relay.subscribe([filter], {
      // deno-lint-ignore no-explicit-any
      onevent(event: any) { events.push(event); },
      oneose() { clearTimeout(timer); resolve(events); },
    });
  });
}

// ── Hauptprogramm ─────────────────────────────────────────────────────────────

const hr = (c = "─", n = 70) => c.repeat(n);

async function main() {
  const privkey = resolvePrivkey(PRIVKEY_RAW);
  const pubkey  = getPublicKey(privkey);

  console.log(`\n${hr("═")}`);
  console.log("  publish-and-verify.ts");
  console.log(`  Relay  : ${NOSTR_RELAY}`);
  console.log(`  Pubkey : ${pubkey}`);
  console.log(hr("═"));

  // 1. Post holen
  const post = await fetchOnePost();
  console.log(`\n✅ Post gefunden: "${post.title?.rendered}"`);
  console.log(`   WP-ID         : ${post.id}`);
  console.log(`   WP-URL        : ${post.link}`);
  console.log(`   Startdatum    : ${post.acf?.relilab_startdate ?? "(leer)"}`);
  console.log(`   Enddatum      : ${post.acf?.relilab_enddate   ?? "(leer)"}`);
  console.log(`   Zoom-Link     : ${post.acf?.relilab_custom_zoom_link ?? "(leer)"}`);
  console.log(`   Schlagwörter  : ${(post.taxonomy_info?.post_tag ?? []).map((t: {label:string}) => t.label).join(", ") || "(keine)"}`);
  console.log(`   Beitragsbild  : ${post.featured_image_urls_v2?.thumbnail?.[0] ?? "(leer)"}`);

  // 2. Mappen
  const { _wp, ...eventTemplate } = mapPost(post);
  console.log(`\n${hr()}`);
  console.log("📋 Gemapptes Nostr-Event (kind:31923)");
  console.log(hr());
  for (const tag of eventTemplate.tags) {
    console.log(`  [${tag[0].padEnd(12)}] ${tag[1]?.slice(0, 80) ?? ""}`);
  }
  console.log(`  [content     ] ${eventTemplate.content.length} Zeichen`);

  // 3. Signieren
  const signed = finalizeEvent(eventTemplate, privkey);
  console.log(`\n${hr()}`);
  console.log("🔏 Signierung");
  console.log(hr());
  console.log(`  Event-ID : ${signed.id}`);
  console.log(`  Signatur : ${signed.sig.slice(0, 32)}…`);
  const valid = verifyEvent(signed);
  console.log(`  Gültig   : ${valid ? "✅ ja" : "❌ NEIN – Fehler!"}`);
  if (!valid) { Deno.exit(1); }

  // 4. Publizieren
  console.log(`\n${hr()}`);
  console.log("🚀 Publizieren auf Relay");
  console.log(hr());
  const relay = await Relay.connect(NOSTR_RELAY);
  try {
    await relay.publish(signed);
    console.log("  ✅ Relay hat Event akzeptiert");
  } catch (err) {
    console.error(`  ❌ Relay hat abgelehnt: ${(err as Error).message}`);
    relay.close();
    Deno.exit(1);
  }

  // 5. Kurz warten, dann vom Relay abfragen
  console.log("\n  ⏳ Warte 2 Sekunden, dann Relay-Abfrage …");
  await new Promise(r => setTimeout(r, 2000));

  console.log(`\n${hr()}`);
  console.log("🔍 Verifikation: Event vom Relay lesen");
  console.log(hr());

  const fetched = await fetchFromRelay(relay, {
    kinds: [31923],
    authors: [pubkey],
    "#d": [post.link ?? post.guid?.rendered ?? String(post.id)],
  });

  relay.close();

  if (fetched.length === 0) {
    console.error("  ❌ Event NICHT auf Relay gefunden!");
    Deno.exit(1);
  }

  const received = fetched[0];
  console.log(`  ✅ Event gefunden (ID: ${received.id})`);

  // 6. Vollständigkeitsprüfung
  console.log(`\n${hr()}`);
  console.log("🧪 Vollständigkeitsprüfung");
  console.log(hr());

  let allOk = true;

  function check(label: string, expected: string | number | undefined, actual: string | number | undefined) {
    const ok = expected === actual;
    const status = ok ? "✅" : "❌";
    console.log(`  ${status} ${label.padEnd(20)} erwartet: ${String(expected ?? "(leer)").slice(0, 50)}`);
    if (!ok) console.log(`  ${"".padEnd(22)} bekommen: ${String(actual ?? "(leer)").slice(0, 50)}`);
    if (!ok) allOk = false;
  }

  // ID stimmt überein?
  check("event.id", signed.id, received.id);
  check("event.kind", 31923, received.kind);
  check("event.pubkey", pubkey, received.pubkey);

  // Tags prüfen
  // deno-lint-ignore no-explicit-any
  const getTag = (event: any, name: string) => event.tags?.find((t: string[]) => t[0] === name)?.[1];

  check("d-Tag",          _wp.wpUrl,   getTag(received, "d"));
  check("title-Tag",      _wp.title,   getTag(received, "title"));
  check("start-Tag",      String(_wp.startTs), getTag(received, "start"));
  check("end-Tag",        String(_wp.endTs),   getTag(received, "end"));
  check("start_tzid",     "Europe/Berlin", getTag(received, "start_tzid"));
  check("end_tzid",       "Europe/Berlin", getTag(received, "end_tzid"));

  if (_wp.summaryMd) check("summary-Tag", _wp.summaryMd.slice(0, 50), getTag(received, "summary")?.slice(0, 50));
  if (_wp.location)  check("location-Tag", _wp.location, getTag(received, "location"));
  if (_wp.image)     check("image-Tag", _wp.image, getTag(received, "image"));
  check("r-Tag", _wp.wpUrl, getTag(received, "r"));

  // Content-Länge (exakte Prüfung zu streng, daher Länge)
  const contentOk = received.content?.length === eventTemplate.content.length;
  console.log(`  ${contentOk ? "✅" : "❌"} content.length       erwartet: ${eventTemplate.content.length} Zeichen, bekommen: ${received.content?.length}`);
  if (!contentOk) allOk = false;

  // Signatur auf empfangenem Event prüfen
  const sigValid = verifyEvent(received);
  console.log(`  ${sigValid ? "✅" : "❌"} Signatur gültig`);
  if (!sigValid) allOk = false;

  console.log(`\n${hr("═")}`);
  if (allOk) {
    console.log("🎉 Alle Prüfungen bestanden – Event ist vollständig und korrekt auf dem Relay.");
  } else {
    console.log("⚠️  Einige Prüfungen fehlgeschlagen – siehe Details oben.");
    Deno.exit(1);
  }
  console.log(hr("═") + "\n");
}

main().catch((err: Error) => {
  console.error("\n💥 Fatal:", err.message);
  Deno.exit(1);
});
