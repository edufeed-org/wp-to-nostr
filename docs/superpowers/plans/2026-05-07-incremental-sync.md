# Inkrementeller Sync via Relay-State — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync nur noch Posts veröffentlichen, deren `modified_gmt` neuer ist als der jüngste relevante Event auf den konfigurierten Relays.

**Architecture:** Vor dem WP-Fetch holt der Sync via Nostr-REQ pro Relay das neueste eigene Event des relevanten `kind` (31923 für Calendar, 30023 für Article), nimmt das Minimum der `created_at`-Werte als Cutoff und schickt es als WP-Query-Param `modified_after` mit. Im Zweifel (leeres Relay, REQ-Fehler, `FORCE_REPUBLISH=true`) → Vollsync wie bisher. Relay als Quelle der Wahrheit, kein zusätzlicher persistenter State.

**Tech Stack:** Deno 2.x, TypeScript, nostr-tools 2.10.x, std/assert (jsr).

**Spec:** `docs/superpowers/specs/2026-05-07-incremental-sync-design.md`

---

## Datei-Struktur

- **Modify:** `wp-to-nostr.ts`
  - Neue Funktion `getLastSyncTimestamp` (exportiert für Tests).
  - Neue Funktion `kindForSyncMode` (klein, exportiert für Tests).
  - `fetchWpPosts` bekommt optionalen `modifiedAfter`-Parameter.
  - `main()`-Flow: Relay-Pool wird vor WP-Fetch verbunden, Cutoff wird ermittelt und an `fetchWpPosts` übergeben.
- **Create:** `tests/last-sync-timestamp.test.ts` — Unit-Tests für `getLastSyncTimestamp`.
- **Create:** `tests/wp-query-modified-after.test.ts` — Tests, dass `fetchWpPosts(modifiedAfter)` den korrekten Query-Param baut. Da `fetchWpPosts` aktuell nicht exportiert ist und einen echten `fetch` macht, exportieren wir eine reine Hilfsfunktion `buildWpUrl(opts)` und testen die.
- **Modify:** `README.md` — Absatz „Inkrementeller Sync".

**Wichtige Implementierungs-Entscheidung (aus dem Spec offen gelassen):**
- WP-Query-Param: Wir verwenden `modified_after` (Standard-WP-REST-API-Parameter, ISO-8601 ohne TZ-Suffix wird als Site-Lokalzeit interpretiert). Um TZ-Probleme zu vermeiden, übergeben wir `modified_after` mit Zeitzone `Z` (UTC) — WP akzeptiert das seit Core 5.7. Falls `relilab.org` älter ist, fällt der Code in der Praxis auf Vollsync zurück (WP ignoriert den Param oder liefert mehr Posts → kein Datenverlust). **Empirisch verifiziert wird das in Task 6.**

---

## Task 1: Helper `kindForSyncMode` extrahieren und testen

**Files:**
- Modify: `wp-to-nostr.ts` (Zeile ~53 nach `type SyncMode`)
- Test: `tests/kind-for-sync-mode.test.ts` (neu)

- [ ] **Step 1: Test schreiben**

Datei: `tests/kind-for-sync-mode.test.ts`

```ts
import { assertEquals } from "@std/assert";
import { kindForSyncMode } from "../wp-to-nostr.ts";

Deno.test("kindForSyncMode: calendar → 31923", () => {
  assertEquals(kindForSyncMode("calendar"), 31923);
});

Deno.test("kindForSyncMode: article → 30023", () => {
  assertEquals(kindForSyncMode("article"), 30023);
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `deno task test tests/kind-for-sync-mode.test.ts`
Expected: FAIL — `kindForSyncMode` nicht exportiert.

- [ ] **Step 3: Funktion implementieren**

In `wp-to-nostr.ts` direkt nach `type SyncMode = "calendar" | "article";` (Zeile 53):

```ts
export function kindForSyncMode(mode: SyncMode): number {
  return mode === "article" ? 30023 : 31923;
}
```

- [ ] **Step 4: Test laufen lassen — muss grün sein**

Run: `deno task test tests/kind-for-sync-mode.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Committen**

```bash
git add tests/kind-for-sync-mode.test.ts wp-to-nostr.ts
git commit -m "Helper kindForSyncMode für Filter-Lookup je SYNC_MODE"
```

---

## Task 2: `buildWpUrl` extrahieren (refactor) — bereitet Filter-Param vor

Aktuell baut `fetchWpPosts` die URL inline. Wir extrahieren den URL-Bau in eine reine Funktion ohne Netzwerk, die wir testen können.

**Files:**
- Modify: `wp-to-nostr.ts` (Zeile 225-261, `fetchWpPosts`)
- Test: `tests/wp-query-modified-after.test.ts` (neu)

- [ ] **Step 1: Test schreiben (für die noch nicht existierende Funktion)**

Datei: `tests/wp-query-modified-after.test.ts`

```ts
import { assertEquals } from "@std/assert";
import { buildWpUrl } from "../wp-to-nostr.ts";

const BASE = "https://relilab.org/wp-json/wp/v2/posts";

Deno.test("buildWpUrl: calendar-Mode setzt meta_key/meta_value-Sortierung", () => {
  const url = buildWpUrl({
    apiUrl: BASE,
    category: "176",
    syncMode: "calendar",
    page: 1,
  });
  const u = new URL(url);
  assertEquals(u.searchParams.get("categories"), "176");
  assertEquals(u.searchParams.get("per_page"), "100");
  assertEquals(u.searchParams.get("meta_key"), "relilab_startdate");
  assertEquals(u.searchParams.get("orderby"), "meta_value");
  assertEquals(u.searchParams.get("order"), "desc");
  assertEquals(u.searchParams.get("page"), "1");
});

Deno.test("buildWpUrl: article-Mode nutzt date-Sortierung mit author-embed", () => {
  const url = buildWpUrl({
    apiUrl: BASE,
    category: "6",
    syncMode: "article",
    page: 2,
  });
  const u = new URL(url);
  assertEquals(u.searchParams.get("orderby"), "date");
  assertEquals(u.searchParams.get("order"), "desc");
  assertEquals(u.searchParams.get("_embed"), "author");
  assertEquals(u.searchParams.get("page"), "2");
});

Deno.test("buildWpUrl: ohne modifiedAfter → kein modified_after-Param", () => {
  const url = buildWpUrl({
    apiUrl: BASE,
    category: "176",
    syncMode: "calendar",
    page: 1,
  });
  const u = new URL(url);
  assertEquals(u.searchParams.has("modified_after"), false);
});

Deno.test("buildWpUrl: mit modifiedAfter → modified_after im ISO-Format mit Z", () => {
  // 2026-05-01T10:00:00Z = 1777456800
  const cutoff = new Date("2026-05-01T10:00:00Z");
  const url = buildWpUrl({
    apiUrl: BASE,
    category: "176",
    syncMode: "calendar",
    page: 1,
    modifiedAfter: cutoff,
  });
  const u = new URL(url);
  assertEquals(u.searchParams.get("modified_after"), "2026-05-01T10:00:00Z");
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `deno task test tests/wp-query-modified-after.test.ts`
Expected: FAIL — `buildWpUrl` nicht exportiert.

- [ ] **Step 3: `buildWpUrl` extrahieren und in `fetchWpPosts` nutzen**

In `wp-to-nostr.ts`, vor `async function fetchWpPosts()` (vor Zeile 225) einfügen:

```ts
export interface BuildWpUrlOpts {
  apiUrl: string;
  category: string;
  syncMode: SyncMode;
  page: number;
  modifiedAfter?: Date;
}

export function buildWpUrl(opts: BuildWpUrlOpts): string {
  const url = new URL(opts.apiUrl);
  url.searchParams.set("categories", opts.category);
  url.searchParams.set("per_page", "100");

  if (opts.syncMode === "calendar") {
    url.searchParams.set("meta_key", "relilab_startdate");
    url.searchParams.set("orderby", "meta_value");
    url.searchParams.set("order", "desc");
  } else {
    url.searchParams.set("orderby", "date");
    url.searchParams.set("order", "desc");
    url.searchParams.set("_embed", "author");
  }

  url.searchParams.set("page", String(opts.page));

  if (opts.modifiedAfter) {
    // ISO-8601 mit "Z" — WP-REST-API (Core ≥ 5.7) akzeptiert UTC-Suffix.
    // Sekundengenau, ohne Millisekunden.
    const iso = opts.modifiedAfter.toISOString().replace(/\.\d{3}Z$/, "Z");
    url.searchParams.set("modified_after", iso);
  }

  return url.toString();
}
```

Dann `fetchWpPosts` (Zeile 225-261) ersetzen durch:

```ts
async function fetchWpPosts(modifiedAfter?: Date): Promise<WpPost[]> {
  const all: WpPost[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const url = buildWpUrl({
      apiUrl: WP_API_URL,
      category: WP_CATEGORY,
      syncMode: SYNC_MODE,
      page,
      modifiedAfter,
    });
    console.log(`  Seite ${page}/${totalPages} – ${url}`);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`WordPress API Fehler (Seite ${page}): ${res.status} ${res.statusText}`);

    totalPages = Number(res.headers.get("X-WP-TotalPages") ?? "1");
    const posts = await res.json() as WpPost[];
    all.push(...posts);
    page++;
  } while (page <= totalPages);

  return all;
}
```

- [ ] **Step 4: Tests laufen lassen — alle grün**

Run: `deno task test`
Expected: PASS — bestehende Tests + 4 neue.

- [ ] **Step 5: Committen**

```bash
git add tests/wp-query-modified-after.test.ts wp-to-nostr.ts
git commit -m "buildWpUrl extrahiert, optionaler modified_after-Filter"
```

---

## Task 3: `getLastSyncTimestamp` — Test mit Fake-Relay

**Files:**
- Modify: `wp-to-nostr.ts`
- Test: `tests/last-sync-timestamp.test.ts` (neu)

Wir testen die Logik mit einer Mock-Implementierung, die `relay.subscribe`-artiges Verhalten nachbildet — nicht mit echtem WebSocket.

- [ ] **Step 1: Test schreiben**

Datei: `tests/last-sync-timestamp.test.ts`

```ts
import { assertEquals } from "@std/assert";
import {
  getLastSyncTimestamp,
  type RelayLike,
} from "../wp-to-nostr.ts";

// Minimal-Mock für die Subset-API, die getLastSyncTimestamp braucht.
// `subscribe` ruft onevent für gemockte Events auf, dann oneose und
// gibt ein Objekt mit close()-Methode zurück.
function fakeRelay(events: Array<{ created_at: number }>, opts: { error?: boolean } = {}): RelayLike {
  return {
    subscribe(_filters, handlers) {
      if (opts.error) {
        // Simulieren: subscribe wirft synchron
        throw new Error("connection lost");
      }
      // Async events callback, dann EOSE
      queueMicrotask(() => {
        for (const e of events) handlers.onevent?.(e as any);
        handlers.oneose?.();
      });
      return { close() {} };
    },
  };
}

Deno.test("getLastSyncTimestamp: alle Relays liefern Events → Minimum", async () => {
  const pool = [
    { url: "wss://a", relay: fakeRelay([{ created_at: 2000 }]) },
    { url: "wss://b", relay: fakeRelay([{ created_at: 1500 }]) },
    { url: "wss://c", relay: fakeRelay([{ created_at: 3000 }]) },
  ];
  const ts = await getLastSyncTimestamp(pool, "deadbeef", 31923);
  assertEquals(ts, 1500);
});

Deno.test("getLastSyncTimestamp: ein Relay leer → null", async () => {
  const pool = [
    { url: "wss://a", relay: fakeRelay([{ created_at: 2000 }]) },
    { url: "wss://b", relay: fakeRelay([]) },
  ];
  const ts = await getLastSyncTimestamp(pool, "deadbeef", 31923);
  assertEquals(ts, null);
});

Deno.test("getLastSyncTimestamp: subscribe wirft → null", async () => {
  const pool = [
    { url: "wss://a", relay: fakeRelay([{ created_at: 2000 }]) },
    { url: "wss://b", relay: fakeRelay([], { error: true }) },
  ];
  const ts = await getLastSyncTimestamp(pool, "deadbeef", 31923);
  assertEquals(ts, null);
});

Deno.test("getLastSyncTimestamp: relay=null im Pool (Connect-Fehler) → null", async () => {
  const pool = [
    { url: "wss://a", relay: fakeRelay([{ created_at: 2000 }]) },
    { url: "wss://b", relay: null },
  ];
  const ts = await getLastSyncTimestamp(pool, "deadbeef", 31923);
  assertEquals(ts, null);
});

Deno.test("getLastSyncTimestamp: leerer Pool → null", async () => {
  const ts = await getLastSyncTimestamp([], "deadbeef", 31923);
  assertEquals(ts, null);
});

Deno.test("getLastSyncTimestamp: nimmt das jüngste Event pro Relay", async () => {
  // Relay liefert mehrere Events (limit:1 ist nur Hint, Relay kann mehr senden)
  const pool = [
    {
      url: "wss://a",
      relay: fakeRelay([
        { created_at: 1000 },
        { created_at: 5000 },
        { created_at: 3000 },
      ]),
    },
    { url: "wss://b", relay: fakeRelay([{ created_at: 4000 }]) },
  ];
  const ts = await getLastSyncTimestamp(pool, "deadbeef", 31923);
  // pro Relay max → [5000, 4000] → min = 4000
  assertEquals(ts, 4000);
});
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `deno task test tests/last-sync-timestamp.test.ts`
Expected: FAIL — `getLastSyncTimestamp` und `RelayLike` nicht exportiert.

- [ ] **Step 3: Implementierung in `wp-to-nostr.ts`**

In `wp-to-nostr.ts` nach den anderen exportierten Helpers (z.B. nach `mergeCommunityHTags`, vor dem `// ── WordPress REST-API`-Block) einfügen:

```ts
// ── Letzten Sync-Zeitstempel pro Relay ermitteln ─────────────────────────────
// Fragt jedes Relay nach dem neuesten eigenen Event des angegebenen kind und
// nimmt das Minimum über alle Relays. Wenn auch nur ein Relay leer ist oder
// einen Fehler liefert: Rückgabe null → der Caller macht einen Vollsync.

export interface RelayLike {
  subscribe(
    filters: Array<Record<string, unknown>>,
    handlers: {
      onevent?: (event: { created_at: number }) => void;
      oneose?: () => void;
    },
  ): { close: () => void };
}

const RELAY_QUERY_TIMEOUT_MS = 5000;

export async function getLastSyncTimestamp(
  pool: Array<{ url: string; relay: RelayLike | null }>,
  pubkeyHex: string,
  kind: number,
): Promise<number | null> {
  if (pool.length === 0) return null;

  const perRelay = await Promise.all(
    pool.map(({ url, relay }) => queryNewestCreatedAt(url, relay, pubkeyHex, kind)),
  );

  // Wenn auch nur ein Relay null lieferte: Vollsync.
  if (perRelay.some((v) => v === null)) return null;
  return Math.min(...perRelay as number[]);
}

function queryNewestCreatedAt(
  url: string,
  relay: RelayLike | null,
  pubkeyHex: string,
  kind: number,
): Promise<number | null> {
  return new Promise((resolve) => {
    if (!relay) {
      resolve(null);
      return;
    }

    let newest: number | null = null;
    let done = false;

    const finish = (value: number | null) => {
      if (done) return;
      done = true;
      try { sub?.close(); } catch { /* ignore */ }
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => {
      console.warn(`     ⚠️  ${url}: Timeout beim Abfragen des letzten Events`);
      finish(null);
    }, RELAY_QUERY_TIMEOUT_MS);

    let sub: { close: () => void } | undefined;
    try {
      sub = relay.subscribe(
        [{ authors: [pubkeyHex], kinds: [kind], limit: 1 }],
        {
          onevent: (evt) => {
            if (newest === null || evt.created_at > newest) newest = evt.created_at;
          },
          oneose: () => finish(newest),
        },
      );
    } catch (err) {
      console.warn(`     ⚠️  ${url}: ${(err as Error).message}`);
      finish(null);
    }
  });
}
```

- [ ] **Step 4: Tests laufen lassen — müssen grün sein**

Run: `deno task test tests/last-sync-timestamp.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Vollständige Test-Suite durchlaufen**

Run: `deno task test`
Expected: PASS — alles grün, keine Regressionen.

- [ ] **Step 6: Committen**

```bash
git add tests/last-sync-timestamp.test.ts wp-to-nostr.ts
git commit -m "getLastSyncTimestamp: jüngsten Eigen-Event pro Relay abfragen"
```

---

## Task 4: `main()`-Flow umstellen — Cutoff bestimmen, Pool vorziehen

**Files:**
- Modify: `wp-to-nostr.ts` (`main()`-Funktion, Zeilen 474-605)

Der bisherige Ablauf: WP-Fetch → Mappen → Relay-Pool aufbauen → Publish.
Neu: Privkey + Pubkey ableiten → Relay-Pool aufbauen → Cutoff ermitteln → WP-Fetch (mit Cutoff) → Mappen → Publish.

- [ ] **Step 1: `main()` umbauen**

In `wp-to-nostr.ts` die `main()`-Funktion (ab Zeile 474) durch folgende Version ersetzen:

```ts
async function main(): Promise<void> {
  const modeLabel = SYNC_MODE === "article"
    ? "📰 Article-Sync (kind:30023 Long-Form)"
    : "📅 Calendar-Sync (kind:31923 Termine)";

  console.log(`\n🔄 WordPress → Nostr Sync — ${modeLabel}`);
  console.log(`   Relays: ${NOSTR_RELAYS.join(", ")}`);
  console.log(`   Modus : ${DRY_RUN
    ? "🧪 DRY RUN – keine Events werden tatsächlich gesendet"
    : "🚀 LIVE – Events werden auf Nostr veröffentlicht"}\n`);

  // Privkey/Pubkey nur im Live-Modus
  let privkey: Uint8Array | null = null;
  let pubkeyHex: string | null = null;
  if (!DRY_RUN) {
    privkey = resolvePrivkey(PRIVKEY_RAW);
    pubkeyHex = getPublicKey(privkey);
    console.log(`🔑 Öffentlicher Schlüssel (hex): ${pubkeyHex}\n`);
  }

  // Relay-Pool VOR dem WP-Fetch aufbauen, damit wir den Cutoff bestimmen können.
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
    // Cutoff für inkrementellen Sync ermitteln.
    let cutoff: Date | undefined = undefined;
    if (!FORCE_REPUBLISH && !DRY_RUN && pubkeyHex) {
      console.log("🔎 Letzten Sync-Zeitstempel von Relays abfragen …");
      const lastTs = await getLastSyncTimestamp(
        relayPool,
        pubkeyHex,
        kindForSyncMode(SYNC_MODE),
      );
      if (lastTs !== null) {
        // 60s Sicherheitspuffer gegen Clock-Drift.
        cutoff = new Date((lastTs - 60) * 1000);
        console.log(`   Letztes Event: ${new Date(lastTs * 1000).toISOString()}`);
        console.log(`   Cutoff (−60s): ${cutoff.toISOString()}\n`);
      } else {
        console.log("   Kein gemeinsamer Cutoff verfügbar → Vollsync.\n");
      }
    } else if (FORCE_REPUBLISH) {
      console.log("⚡ FORCE_REPUBLISH=true → Filter wird übersprungen, Vollsync.\n");
    }

    // 1. WordPress-Posts holen (optional gefiltert)
    console.log("📥 WordPress-Posts abrufen …");
    const posts = await fetchWpPosts(cutoff);
    console.log(`   ${posts.length} Posts gefunden\n`);

    // 2. Filtern & mappen
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
    const perRelayStats = new Map<string, { ok: number; skipped: number; failed: number }>();
    for (const url of NOSTR_RELAYS) {
      perRelayStats.set(url, { ok: 0, skipped: 0, failed: 0 });
    }
    let eventsAcceptedSomewhere = 0;
    let eventsRejectedEverywhere = 0;

    for (const evt of events) {
      const title = evt.tags.find((t) => t[0] === "title")?.[1] ?? "(kein Titel)";
      console.log(`  📌 "${title}"`);

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
  } finally {
    for (const { relay } of relayPool) relay?.close();
    if (!DRY_RUN) console.log("\n🔌 Relay-Verbindungen geschlossen");
  }
}
```

- [ ] **Step 2: Type-Check**

Run: `deno check wp-to-nostr.ts`
Expected: PASS — keine Type-Fehler.

- [ ] **Step 3: Vollständige Test-Suite**

Run: `deno task test`
Expected: PASS — keine Regressionen.

- [ ] **Step 4: Manueller Smoke-Test (Dry-Run)**

Vorbedingung: keine `NOSTR_PRIVATE_KEY`-Env nötig (Dry-Run-Pfad überspringt Pubkey + Cutoff).

Run: `deno task dry-run`
Expected:
- Verbindet keine Relays (DRY_RUN-Pfad).
- Holt alle Posts wie bisher (kein Cutoff, weil kein Pubkey).
- Druckt Tags und Content-Auszüge.

- [ ] **Step 5: Committen**

```bash
git add wp-to-nostr.ts
git commit -m "main(): Cutoff via Relay-State, Pool vor WP-Fetch"
```

---

## Task 5: README aktualisieren

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README lesen, Stelle für neuen Abschnitt finden**

Run: `grep -n "FORCE_REPUBLISH\|Sync\|Modus" README.md | head -20`

(Such-Output orientieren — der Abschnitt soll nach der Beschreibung von `FORCE_REPUBLISH` eingefügt werden.)

- [ ] **Step 2: Abschnitt einfügen**

Neuen Absatz nach der `FORCE_REPUBLISH`-Beschreibung in `README.md` einfügen:

```markdown
## Inkrementeller Sync

Beim Start fragt das Script jedes konfigurierte Relay nach dem neuesten
eigenen Event des relevanten Kinds (31923 für Calendar, 30023 für Article)
und nimmt das Minimum der `created_at`-Werte als Cutoff. Die WordPress-Query
filtert dann mit `modified_after`, sodass nur seitdem geänderte Posts
abgerufen und veröffentlicht werden.

**Wann passiert ein Vollsync?**
- `FORCE_REPUBLISH=true` ist gesetzt
- Mindestens ein Relay liefert kein eigenes Event (leeres Relay, neu hinzugefügt)
- Mindestens ein Relay-REQ schlägt fehl oder läuft in den Timeout (5 s)

**Was tun bei Mapping-Änderungen?**
Wenn der Mapping-Code (Tags, Content-Format, Hashtags) geändert wird, ändert
sich `modified_gmt` in WordPress nicht — der Filter würde alle Bestandsposts
ignorieren. Dann einmal mit `FORCE_REPUBLISH=true` per `workflow_dispatch`
triggern: das holt alle Posts und ersetzt die Events mit `created_at = now`.
```

- [ ] **Step 3: Committen**

```bash
git add README.md
git commit -m "README: Inkrementeller Sync dokumentiert"
```

---

## Task 6: End-to-End-Verifikation gegen relilab.org

Dieser Schritt verifiziert, dass die WP-API `modified_after` mit `Z`-Suffix korrekt verarbeitet. Wenn nicht, fängt der Filter zu wenig oder zu viel — wir müssen das _sehen_, bevor wir mergen.

**Files:** Keine — reine Verifikation.

- [ ] **Step 1: Ein bekanntes Cutoff-Datum wählen und manuell prüfen**

Aus dem Browser oder via curl:

```bash
# Alle Posts in Kategorie 176, modifiziert seit 2026-04-01
curl -s 'https://relilab.org/wp-json/wp/v2/posts?categories=176&per_page=5&modified_after=2026-04-01T00:00:00Z' \
  | python3 -c "import json,sys; [print(p['modified_gmt'], '|', p['title']['rendered']) for p in json.load(sys.stdin)]"
```

Expected: Liste von Posts, deren `modified_gmt` ≥ 2026-04-01 ist. Wenn die Liste leer kommt, obwohl es bekannt geänderte Posts gibt, ist `Z`-Format-Suffix das Problem.

- [ ] **Step 2: Falls `Z`-Suffix nicht akzeptiert wird, Fallback einbauen**

Nur falls Step 1 fehlschlägt. Ändere `buildWpUrl` so, dass `modifiedAfter` ohne `Z` und in Berlin-Lokalzeit übergeben wird:

```ts
if (opts.modifiedAfter) {
  // WP interpretiert ohne TZ-Suffix als Site-Lokalzeit (Berlin).
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(opts.modifiedAfter);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const iso = `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:${g("second")}`;
  url.searchParams.set("modified_after", iso);
}
```

Test in `tests/wp-query-modified-after.test.ts` Step 1, Test 4 anpassen — gegen Berlin-Lokalzeit-Format prüfen.

- [ ] **Step 3: Live-Smoke-Test mit echtem Privkey**

Vorbedingung: `NOSTR_PRIVATE_KEY` in `.env` oder Shell, Relays sollten den eigenen Pubkey kennen (= mind. ein eigenes Event von einem früheren Sync).

```bash
NOSTR_PRIVATE_KEY=$NOSTR_PRIVATE_KEY deno task start
```

Expected:
- Log zeigt: „Letztes Event: <ISO>", „Cutoff (−60s): <ISO>".
- WP-Fetch-Logs zeigen URL mit `modified_after=...`.
- „X Posts gefunden" — typischerweise 0–5 statt ~600.
- Falls 0: Log endet mit „Nichts zu veröffentlichen – alles aktuell."

- [ ] **Step 4: Force-Sync-Smoke-Test**

```bash
FORCE_REPUBLISH=true NOSTR_PRIVATE_KEY=$NOSTR_PRIVATE_KEY DRY_RUN=true deno task dry-run
```

Wait — `dry-run` setzt schon `DRY_RUN=true`. Stattdessen:

```bash
FORCE_REPUBLISH=true deno task dry-run
```

Expected:
- Log zeigt: „⚡ FORCE_REPUBLISH=true → Filter wird übersprungen, Vollsync."
- WP-Fetch-Logs zeigen URL OHNE `modified_after`.
- „~600 Posts gefunden" wie vor dem Change.

- [ ] **Step 5: Falls Step 2 nötig war: committen**

```bash
git add wp-to-nostr.ts tests/wp-query-modified-after.test.ts
git commit -m "modified_after in Berlin-Lokalzeit (WP-Site-TZ)"
```

---

## Task 7: PR erstellen

- [ ] **Step 1: Status prüfen**

```bash
git status
git log --oneline main..HEAD
```

Expected: 4–6 Commits ahead of main, kein Working-Tree-Diff.

- [ ] **Step 2: Branch pushen und PR erstellen**

Falls noch auf `main` gearbeitet wurde, vorher Branch erzeugen:

```bash
git switch -c incremental-sync
git push -u origin incremental-sync
```

PR-Erstellung wird vom User explizit angestoßen — nicht automatisch im Plan-Run.

---

## Self-Review

**Spec-Coverage:**
- Architekturentscheidung „Relay als Quelle der Wahrheit" → Task 3 (`getLastSyncTimestamp`).
- „Minimum über alle Relays" → Task 3, Test „alle Relays liefern Events → Minimum".
- „Im Zweifel Vollsync" → Task 3, Tests für leere/fehlerhafte Relays + Task 4, Cutoff-Bedingungen.
- „FORCE_REPUBLISH umgeht Filter" → Task 4, expliziter Branch in `main()`.
- Helper `kindForSyncMode` → Task 1.
- `fetchWpPosts(modifiedAfter)` → Task 2.
- Tests für `getLastSyncTimestamp`, Query-Bau, End-to-End → Task 3, Task 2, Task 6.
- README-Doku → Task 5.
- TZ-sichere Query-Param → Task 2 mit Z-Suffix als Default, Task 6 als empirische Verifikation + Fallback.

**Placeholder-Scan:** Keine TBDs/TODOs. Alle Code-Schritte zeigen Code, alle Befehle sind ausführbar.

**Type-Konsistenz:**
- `RelayLike` in Task 3 definiert, in Test (Task 3, Step 1) verwendet.
- `BuildWpUrlOpts` in Task 2 definiert, in Tests (Task 2, Step 1) implizit über die Funktionssignatur verwendet.
- `kindForSyncMode(SYNC_MODE)` in Task 4 stimmt mit Definition in Task 1 überein.
- `getLastSyncTimestamp(pool, pubkey, kind)` Signatur in Task 3 (Implementierung) und Task 4 (Aufruf) identisch.
- `fetchWpPosts(modifiedAfter?: Date)` Signatur in Task 2 und Task 4 identisch.
