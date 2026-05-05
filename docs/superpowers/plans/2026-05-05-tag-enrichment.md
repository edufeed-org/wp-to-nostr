# Tag-Anreicherung (Hashtags + Community-h-Tag) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anreicherung aller WP→Nostr-Kalender-Events um konfigurierbare Hashtags (`t`) und Community-Zuordnungen (`h`) per Communikey-Spec, mit Defaults im Workflow statt im Code.

**Architecture:** Zwei reine Anreicherungsfunktionen (`mergeExtraHashtags`, `mergeCommunityHTags`) und zwei Parser (`parseExtraHashtags`, `parseCommunityNpubs`). Parser laufen einmalig beim Script-Start (Fail-Fast bei ungültigen Inputs); Merge-Funktionen werden pro Event in `mapPostToNostrEvent` aufgerufen. Keine Mutation, lowercase-normalisierte Deduplizierung. Defaults (`relilab` für Hashtag, relilab-npub für Community) leben in `sync.yml`, der Code-Default ist leer — Repo bleibt projekt-neutral.

**Tech Stack:** Deno, TypeScript, `nostr-tools/nip19` (bech32-Decoding), `Deno.test` (BDD-Stil mit `assertEquals`/`assertThrows` aus `@std/assert`).

**Spec-Referenzen:**
- `docs/superpowers/specs/2026-04-20-hashtag-enrichment-design.md`
- `docs/superpowers/specs/2026-05-05-community-h-tag-design.md`

---

## File Structure

**Geändert:**
- `wp-to-nostr.ts` — exportiert neue Parser/Merger; ruft beide in `mapPostToNostrEvent` auf; Shebang erweitert.
- `inspect-mapping.ts` — übernimmt Anreicherung (Konsistenz mit Live-Mapping); Shebang erweitert.
- `deno.json` — `tasks.start` und `tasks.dry-run` erweitern (`--allow-env`).
- `.github/workflows/sync.yml` — neue Env-Übergabe für `EXTRA_HASHTAGS` und `COMMUNITY_NPUBS` mit Workflow-Defaults.
- `README.md` — Env-Tabelle und neuer Abschnitt zu Anreicherung.
- `docs/nostr-kind-31923.md` — Hinweis auf `t`/`h`-Anreicherung.

**Neu:**
- `tests/hashtag-enrichment.test.ts` — Unit-Tests Parser + Merger.
- `tests/community-h-tags.test.ts` — Unit-Tests Parser + Merger.
- `.env.example` — vollständige Env-Doku im Repo-Root.

**Konventionen:**
- Funktionen werden in `wp-to-nostr.ts` als `export function …` definiert, damit Tests sie importieren können.
- Tests laufen via `deno test tests/`; eine `deno task test`-Definition wird in Task 1 angelegt.
- Commits konsequent nach jedem grünen Schritt — der Spec-Stil (kleine, nachvollziehbare Commits) wird beibehalten.

---

### Task 1: Test-Infrastruktur + Standard-Assert-Imports

**Files:**
- Modify: `deno.json`

- [ ] **Step 1: `deno.json` um `@std/assert` und `test`-Task erweitern**

```json
{
  "tasks": {
    "start":   "deno run --allow-net --allow-env=NOSTR_PRIVATE_KEY,DRY_RUN,WP_API_URL,WP_CATEGORY,NOSTR_RELAY,EXTRA_HASHTAGS,COMMUNITY_NPUBS wp-to-nostr.ts",
    "dry-run": "DRY_RUN=true deno run --allow-net --allow-env=NOSTR_PRIVATE_KEY,DRY_RUN,WP_API_URL,WP_CATEGORY,NOSTR_RELAY,EXTRA_HASHTAGS,COMMUNITY_NPUBS wp-to-nostr.ts",
    "inspect": "deno run --allow-net --allow-env=WP_API_URL,WP_CATEGORY,WP_PAGE,EXTRA_HASHTAGS,COMMUNITY_NPUBS inspect-mapping.ts",
    "cleanup":     "NOSTR_PRIVATE_KEY=$NOSTR_PRIVATE_KEY deno run --allow-net --allow-env cleanup-relay.ts",
    "cleanup-dry": "DRY_RUN=true NOSTR_PRIVATE_KEY=$NOSTR_PRIVATE_KEY deno run --allow-net --allow-env cleanup-relay.ts",
    "test":    "deno test --allow-none tests/"
  },
  "imports": {
    "nostr-tools":       "npm:nostr-tools@^2.10.4",
    "nostr-tools/relay": "npm:nostr-tools@^2.10.4/relay",
    "nostr-tools/nip19": "npm:nostr-tools@^2.10.4/nip19",
    "turndown":          "npm:turndown@^7.2.0",
    "@std/assert":       "jsr:@std/assert@^1.0.0"
  }
}
```

Hinweis: Die `--allow-env`-Listen in `start`/`dry-run`/`inspect` werden hier sofort um `EXTRA_HASHTAGS` und `COMMUNITY_NPUBS` erweitert, damit spätere Tasks nicht über fehlende Permissions stolpern. `cleanup` braucht keine Erweiterung (kein Mapping).

- [ ] **Step 2: Test-Verzeichnis anlegen mit Smoke-Test**

Datei: `tests/smoke.test.ts`

```ts
import { assertEquals } from "@std/assert";

Deno.test("smoke: assert framework works", () => {
  assertEquals(1 + 1, 2);
});
```

- [ ] **Step 3: Test-Setup verifizieren**

Run: `deno task test`
Expected: 1 test passed (smoke).

- [ ] **Step 4: Commit**

```bash
git add deno.json tests/smoke.test.ts
git commit -m "Test-Infrastruktur: deno task test + @std/assert"
```

---

### Task 2: `parseExtraHashtags` (TDD)

**Files:**
- Create: `tests/hashtag-enrichment.test.ts`
- Modify: `wp-to-nostr.ts` (neue exportierte Funktion)

- [ ] **Step 1: Failing Tests für `parseExtraHashtags` schreiben**

Datei: `tests/hashtag-enrichment.test.ts`

```ts
import { assertEquals } from "@std/assert";
import { parseExtraHashtags } from "../wp-to-nostr.ts";

Deno.test("parseExtraHashtags: leerer String → leere Liste", () => {
  assertEquals(parseExtraHashtags(""), []);
});

Deno.test("parseExtraHashtags: einzelner Eintrag", () => {
  assertEquals(parseExtraHashtags("relilab"), ["relilab"]);
});

Deno.test("parseExtraHashtags: mehrere Einträge mit Whitespace", () => {
  assertEquals(parseExtraHashtags(" relilab , bildung "), ["relilab", "bildung"]);
});

Deno.test("parseExtraHashtags: leere Einträge werden ignoriert", () => {
  assertEquals(parseExtraHashtags("relilab,,bildung"), ["relilab", "bildung"]);
});

Deno.test("parseExtraHashtags: führendes # wird entfernt", () => {
  assertEquals(parseExtraHashtags("#relilab,bildung"), ["relilab", "bildung"]);
});

Deno.test("parseExtraHashtags: nur whitespace → leere Liste", () => {
  assertEquals(parseExtraHashtags("   "), []);
});
```

- [ ] **Step 2: Tests laufen lassen → erwartet: FAIL (Funktion existiert nicht)**

Run: `deno task test`
Expected: FAIL — `parseExtraHashtags` ist kein Export von `wp-to-nostr.ts`.

- [ ] **Step 3: Funktion in `wp-to-nostr.ts` implementieren**

Direkt nach `htmlToMarkdown`-Block einfügen (etwa nach `wp-to-nostr.ts:94`):

```ts
// ── Hashtag-Anreicherung ──────────────────────────────────────────────────────

export function parseExtraHashtags(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim().replace(/^#/, ""))
    .filter((entry) => entry.length > 0);
}
```

- [ ] **Step 4: Tests laufen lassen → erwartet: PASS**

Run: `deno task test`
Expected: alle 6 neuen Tests + Smoke = 7 passed.

- [ ] **Step 5: Commit**

```bash
git add wp-to-nostr.ts tests/hashtag-enrichment.test.ts
git commit -m "parseExtraHashtags: Komma-separierte Hashtag-Liste mit #-Toleranz"
```

---

### Task 3: `mergeExtraHashtags` (TDD)

**Files:**
- Modify: `tests/hashtag-enrichment.test.ts`
- Modify: `wp-to-nostr.ts`

- [ ] **Step 1: Failing Tests für `mergeExtraHashtags` ergänzen**

Am Ende von `tests/hashtag-enrichment.test.ts` anhängen:

```ts
import { mergeExtraHashtags } from "../wp-to-nostr.ts";

Deno.test("mergeExtraHashtags: Tag wird hinzugefügt, wenn nicht vorhanden", () => {
  const tags = [["title", "X"]];
  const out = mergeExtraHashtags(tags, ["relilab"]);
  assertEquals(out, [["title", "X"], ["t", "relilab"]]);
});

Deno.test("mergeExtraHashtags: kein Duplikat bei exakter Schreibweise", () => {
  const tags = [["t", "relilab"]];
  const out = mergeExtraHashtags(tags, ["relilab"]);
  assertEquals(out, [["t", "relilab"]]);
});

Deno.test("mergeExtraHashtags: kein Duplikat bei abweichender Groß-/Kleinschreibung", () => {
  const tags = [["t", "Relilab"]];
  const out = mergeExtraHashtags(tags, ["relilab"]);
  assertEquals(out, [["t", "Relilab"]]);
});

Deno.test("mergeExtraHashtags: mehrere Extras, einer schon vorhanden", () => {
  const tags = [["t", "Bildung"]];
  const out = mergeExtraHashtags(tags, ["relilab", "bildung", "nostr"]);
  assertEquals(out, [["t", "Bildung"], ["t", "relilab"], ["t", "nostr"]]);
});

Deno.test("mergeExtraHashtags: leere Extras → unverändert", () => {
  const tags = [["t", "x"]];
  const out = mergeExtraHashtags(tags, []);
  assertEquals(out, [["t", "x"]]);
});

Deno.test("mergeExtraHashtags: mutiert Input nicht", () => {
  const tags = [["t", "x"]];
  const before = JSON.stringify(tags);
  mergeExtraHashtags(tags, ["y"]);
  assertEquals(JSON.stringify(tags), before);
});
```

- [ ] **Step 2: Tests laufen lassen → erwartet: FAIL**

Run: `deno task test`
Expected: 6 neue Tests fail (Funktion fehlt).

- [ ] **Step 3: `mergeExtraHashtags` in `wp-to-nostr.ts` implementieren**

Direkt nach `parseExtraHashtags` einfügen:

```ts
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
```

- [ ] **Step 4: Tests laufen lassen → erwartet: PASS**

Run: `deno task test`
Expected: 13 passed (Smoke + Parser + Merger).

- [ ] **Step 5: Commit**

```bash
git add wp-to-nostr.ts tests/hashtag-enrichment.test.ts
git commit -m "mergeExtraHashtags: case-insensitive Dedup ohne Mutation"
```

---

### Task 4: `parseCommunityNpubs` (TDD)

**Files:**
- Create: `tests/community-h-tags.test.ts`
- Modify: `wp-to-nostr.ts`

- [ ] **Step 1: Failing Tests für `parseCommunityNpubs` schreiben**

Datei: `tests/community-h-tags.test.ts`

```ts
import { assertEquals, assertThrows } from "@std/assert";
import { parseCommunityNpubs } from "../wp-to-nostr.ts";

const RELILAB_NPUB = "npub1fpcxaz2wvjl90gjs60x37ny2pa5u4yqfx7fklz73rgfjnnfujl3sr2fxgk";
const RELILAB_HEX  = "48706e894e64be57a250d3cd1f4c8a0f69ca900937936f8bd11a1329cd3c97e3";

Deno.test("parseCommunityNpubs: leerer String → leere Liste", () => {
  assertEquals(parseCommunityNpubs(""), []);
});

Deno.test("parseCommunityNpubs: nur whitespace → leere Liste", () => {
  assertEquals(parseCommunityNpubs("   "), []);
});

Deno.test("parseCommunityNpubs: einzelner npub → Hex (lowercase)", () => {
  assertEquals(parseCommunityNpubs(RELILAB_NPUB), [RELILAB_HEX]);
});

Deno.test("parseCommunityNpubs: einzelner Hex direkt → lowercase übernommen", () => {
  assertEquals(parseCommunityNpubs(RELILAB_HEX.toUpperCase()), [RELILAB_HEX]);
});

Deno.test("parseCommunityNpubs: gemischte Liste npub + Hex", () => {
  const otherHex = "a".repeat(64);
  const input = `${RELILAB_NPUB}, ${otherHex}`;
  assertEquals(parseCommunityNpubs(input), [RELILAB_HEX, otherHex]);
});

Deno.test("parseCommunityNpubs: Whitespace und leere Einträge ignorieren", () => {
  const input = `  ${RELILAB_NPUB}  ,, , ${RELILAB_HEX}  `;
  assertEquals(parseCommunityNpubs(input), [RELILAB_HEX]); // Dedup
});

Deno.test("parseCommunityNpubs: doppelter Eintrag wird dedupliziert", () => {
  const input = `${RELILAB_NPUB},${RELILAB_NPUB}`;
  assertEquals(parseCommunityNpubs(input), [RELILAB_HEX]);
});

Deno.test("parseCommunityNpubs: ungültiger Eintrag wirft mit Klartext", () => {
  assertThrows(
    () => parseCommunityNpubs("nicht_valide"),
    Error,
    "nicht_valide",
  );
});

Deno.test("parseCommunityNpubs: Hex falscher Länge wirft", () => {
  assertThrows(
    () => parseCommunityNpubs("abc123"),
    Error,
    "abc123",
  );
});
```

- [ ] **Step 2: Tests laufen lassen → erwartet: FAIL**

Run: `deno task test`
Expected: 9 neue Tests fail (Funktion fehlt).

- [ ] **Step 3: `parseCommunityNpubs` implementieren**

In `wp-to-nostr.ts`, nach `mergeExtraHashtags`:

```ts
// ── Community-Zuordnung (Communikey h-Tag) ────────────────────────────────────

import { decode as nip19decode } from "nostr-tools/nip19";

export function parseCommunityNpubs(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawEntry of raw.split(",")) {
    const entry = rawEntry.trim();
    if (!entry) continue;

    let hex: string;
    if (entry.startsWith("npub1")) {
      const decoded = nip19decode(entry);
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
```

**Hinweis zum Import:** `decode` aus `nostr-tools/nip19` ist in `wp-to-nostr.ts:27` bereits importiert (für `resolvePrivkey`). Den bestehenden Import erweitern, **nicht** doppelt importieren:

```ts
// Zeile 27 ändern von:
import { decode } from "nostr-tools/nip19";
// zu:
import { decode } from "nostr-tools/nip19";
// (kein Doppel-Import nötig — `decode` reicht für beide Funktionen)
```

Im obigen `parseCommunityNpubs`-Code daher **`decode` statt `nip19decode`** verwenden:

```ts
if (entry.startsWith("npub1")) {
  const decoded = decode(entry);
  // ...
}
```

(Die zusätzliche `import`-Zeile im ersten Code-Block oben ist also **nicht** einzufügen — der Eintrag in Zeile 27 wird einfach mitbenutzt.)

- [ ] **Step 4: Tests laufen lassen → erwartet: PASS**

Run: `deno task test`
Expected: 22 passed.

Bei Fehlschlag: `assertThrows` matched den Fehlertext gegen die Substring-Eingabe (siehe `@std/assert`-Doku). Die Fehlermeldung enthält den Eintrag in deutschen Anführungszeichen `„…"`; der `assertThrows`-Call sucht nur den nackten String (`"nicht_valide"`), das matched per Substring.

- [ ] **Step 5: Commit**

```bash
git add wp-to-nostr.ts tests/community-h-tags.test.ts
git commit -m "parseCommunityNpubs: npub und Hex zu Hex auflösen, Fail-Fast"
```

---

### Task 5: `mergeCommunityHTags` (TDD)

**Files:**
- Modify: `tests/community-h-tags.test.ts`
- Modify: `wp-to-nostr.ts`

- [ ] **Step 1: Failing Tests für `mergeCommunityHTags` ergänzen**

Am Ende von `tests/community-h-tags.test.ts`:

```ts
import { mergeCommunityHTags } from "../wp-to-nostr.ts";

Deno.test("mergeCommunityHTags: h-Tag wird hinzugefügt", () => {
  const tags = [["title", "X"]];
  const out = mergeCommunityHTags(tags, [RELILAB_HEX]);
  assertEquals(out, [["title", "X"], ["h", RELILAB_HEX]]);
});

Deno.test("mergeCommunityHTags: mehrere Communities → mehrere h-Tags", () => {
  const otherHex = "b".repeat(64);
  const out = mergeCommunityHTags([], [RELILAB_HEX, otherHex]);
  assertEquals(out, [["h", RELILAB_HEX], ["h", otherHex]]);
});

Deno.test("mergeCommunityHTags: bestehender h-Tag wird nicht dupliziert", () => {
  const tags = [["h", RELILAB_HEX]];
  const out = mergeCommunityHTags(tags, [RELILAB_HEX]);
  assertEquals(out, [["h", RELILAB_HEX]]);
});

Deno.test("mergeCommunityHTags: case-insensitiver Vergleich auf Hex", () => {
  const tags = [["h", RELILAB_HEX.toUpperCase()]];
  const out = mergeCommunityHTags(tags, [RELILAB_HEX]);
  assertEquals(out, [["h", RELILAB_HEX.toUpperCase()]]);
});

Deno.test("mergeCommunityHTags: leere Hex-Liste → unverändert", () => {
  const tags = [["t", "x"]];
  const out = mergeCommunityHTags(tags, []);
  assertEquals(out, [["t", "x"]]);
});

Deno.test("mergeCommunityHTags: mutiert Input nicht", () => {
  const tags = [["t", "x"]];
  const before = JSON.stringify(tags);
  mergeCommunityHTags(tags, [RELILAB_HEX]);
  assertEquals(JSON.stringify(tags), before);
});
```

- [ ] **Step 2: Tests laufen lassen → erwartet: FAIL**

Run: `deno task test`
Expected: 6 neue Tests fail.

- [ ] **Step 3: `mergeCommunityHTags` implementieren**

In `wp-to-nostr.ts`, nach `parseCommunityNpubs`:

```ts
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
```

- [ ] **Step 4: Tests laufen lassen → erwartet: PASS**

Run: `deno task test`
Expected: 28 passed.

- [ ] **Step 5: Commit**

```bash
git add wp-to-nostr.ts tests/community-h-tags.test.ts
git commit -m "mergeCommunityHTags: h-Tag-Anreicherung mit Dedup"
```

---

### Task 6: Integration in `mapPostToNostrEvent`

**Files:**
- Modify: `wp-to-nostr.ts` (Konfig + Aufruf in `mapPostToNostrEvent`)

- [ ] **Step 1: Konfiguration einlesen**

In `wp-to-nostr.ts`, im Konfigurations-Block (nach `wp-to-nostr.ts:62`, also nach der `PRIVKEY_RAW`-Zeile), ergänzen:

```ts
const EXTRA_HASHTAGS_RAW = Deno.env.get("EXTRA_HASHTAGS") ?? "";
const COMMUNITY_NPUBS_RAW = Deno.env.get("COMMUNITY_NPUBS") ?? "";

const EXTRA_HASHTAGS = parseExtraHashtags(EXTRA_HASHTAGS_RAW);
const COMMUNITY_HEX_PUBKEYS = parseCommunityNpubs(COMMUNITY_NPUBS_RAW);
```

**Reihenfolgen-Hinweis:** Die `parseX`-Aufrufe greifen auf Funktionen zurück, die weiter unten in der Datei definiert sind. In TypeScript/JavaScript funktioniert das, **wenn die Funktionsdefinitionen im selben Modul Hoisting nutzen** (`function` declarations werden gehoistet). Da unsere `parseExtraHashtags` und `parseCommunityNpubs` als `export function …` deklariert sind, ist das gegeben. Bei `const`-Pfeilfunktionen wäre das ein Problem — daher nicht umstellen.

- [ ] **Step 2: Aufruf in `mapPostToNostrEvent`**

In `wp-to-nostr.ts:206` (nach `tags.push(...keywordTags);`) den `return`-Statement-Block ändern:

```ts
  tags.push(...keywordTags);

  let enrichedTags = mergeExtraHashtags(tags, EXTRA_HASHTAGS);
  enrichedTags = mergeCommunityHTags(enrichedTags, COMMUNITY_HEX_PUBKEYS);

  // created_at-Logik bleibt unverändert (siehe wp-to-nostr.ts:208-223)
  const MIN_CREATED_AT = 1735689600;  // 2025-01-01T00:00:00Z
  const modifiedAt = Math.floor(
    new Date(post.modified_gmt + "Z").getTime() / 1000
  ) || Math.floor(Date.now() / 1000);
  const createdAt = Math.max(modifiedAt, MIN_CREATED_AT);

  return { kind: 31923, created_at: createdAt, tags: enrichedTags, content: contentMd };
}
```

**Vorsicht:** Die existierenden Kommentar-Blöcke zu `created_at` (Zeilen 208-218) bleiben unverändert. Nur das `return` wird auf `enrichedTags` umgestellt und die zwei `merge*`-Aufrufe werden vor dem `MIN_CREATED_AT`-Block eingefügt.

- [ ] **Step 3: Dry-Run lokal verifizieren**

Run:

```bash
EXTRA_HASHTAGS=relilab,test \
COMMUNITY_NPUBS=npub1fpcxaz2wvjl90gjs60x37ny2pa5u4yqfx7fklz73rgfjnnfujl3sr2fxgk \
DRY_RUN=true \
deno task dry-run 2>&1 | head -80
```

Expected: Konsolenausgabe zeigt mindestens ein Event mit Tag-Liste, in der `["t", "relilab"]`, `["t", "test"]` und `["h", "48706e89…"]` vorkommen.

- [ ] **Step 4: Bestehende Tests laufen lassen (Regressions-Check)**

Run: `deno task test`
Expected: 28 passed (keine Tests gebrochen).

- [ ] **Step 5: Commit**

```bash
git add wp-to-nostr.ts
git commit -m "Integration: Anreicherung in mapPostToNostrEvent"
```

---

### Task 7: Inspect-Mapping konsistent halten

**Files:**
- Modify: `inspect-mapping.ts`

- [ ] **Step 1: Imports + Env-Reads ergänzen**

In `inspect-mapping.ts:17`, vor `WP_API_URL`-Zeile, Imports erweitern:

```ts
import {
  parseExtraHashtags,
  parseCommunityNpubs,
  mergeExtraHashtags,
  mergeCommunityHTags,
} from "./wp-to-nostr.ts";
```

Im Konfig-Block (nach `WP_PAGE`):

```ts
const EXTRA_HASHTAGS_RAW = Deno.env.get("EXTRA_HASHTAGS") ?? "";
const COMMUNITY_NPUBS_RAW = Deno.env.get("COMMUNITY_NPUBS") ?? "";
const EXTRA_HASHTAGS = parseExtraHashtags(EXTRA_HASHTAGS_RAW);
const COMMUNITY_HEX_PUBKEYS = parseCommunityNpubs(COMMUNITY_NPUBS_RAW);
```

- [ ] **Step 2: Anreicherung im Tag-Build-Block einbauen**

In `inspect-mapping.ts:145` (direkt nach `tags.push(...keywordTags);`) einfügen:

```ts
let enrichedTags = mergeExtraHashtags(tags, EXTRA_HASHTAGS);
enrichedTags = mergeCommunityHTags(enrichedTags, COMMUNITY_HEX_PUBKEYS);
```

Anschließend alle Folgeverwendungen von `tags` auf `enrichedTags` umstellen — das sind die Stellen, an denen das Event-Objekt ausgegeben oder die Vergleichstabelle gebaut wird (typischerweise `console.log`/`printTable` weiter unten in der Datei).

**Verifikation per grep**:

```bash
grep -n "tags" inspect-mapping.ts | grep -v "keywordTags\|let enrichedTags\|push"
```

Jede Zeile, die nach Step 2 noch `tags` (nicht `enrichedTags`) referenziert und nicht aus dem Build-Block stammt, ist umzustellen.

- [ ] **Step 3: Shebang erweitern**

`inspect-mapping.ts:1` ändern von:

```
#!/usr/bin/env -S deno run --allow-net --allow-env=WP_API_URL,WP_CATEGORY,WP_PAGE
```

zu:

```
#!/usr/bin/env -S deno run --allow-net --allow-env=WP_API_URL,WP_CATEGORY,WP_PAGE,EXTRA_HASHTAGS,COMMUNITY_NPUBS
```

- [ ] **Step 4: Inspect lokal verifizieren**

Run:

```bash
EXTRA_HASHTAGS=relilab \
COMMUNITY_NPUBS=npub1fpcxaz2wvjl90gjs60x37ny2pa5u4yqfx7fklz73rgfjnnfujl3sr2fxgk \
deno task inspect 2>&1 | grep -E '"t"|"h"' | head
```

Expected: mindestens je ein `["t", "relilab"]` und `["h", "48706e89…"]` in der Ausgabe.

- [ ] **Step 5: Commit**

```bash
git add inspect-mapping.ts
git commit -m "inspect-mapping: Anreicherung konsistent zum Live-Mapping"
```

---

### Task 8: Shebang in `wp-to-nostr.ts` erweitern

**Files:**
- Modify: `wp-to-nostr.ts:1`

- [ ] **Step 1: Shebang anpassen**

Zeile 1 ändern von:

```
#!/usr/bin/env -S deno run --allow-net --allow-env=NOSTR_PRIVATE_KEY,DRY_RUN,WP_API_URL,WP_CATEGORY,NOSTR_RELAY
```

zu:

```
#!/usr/bin/env -S deno run --allow-net --allow-env=NOSTR_PRIVATE_KEY,DRY_RUN,WP_API_URL,WP_CATEGORY,NOSTR_RELAY,EXTRA_HASHTAGS,COMMUNITY_NPUBS
```

- [ ] **Step 2: Direktausführung verifizieren (ohne `deno task`)**

Run:

```bash
EXTRA_HASHTAGS=relilab \
COMMUNITY_NPUBS=npub1fpcxaz2wvjl90gjs60x37ny2pa5u4yqfx7fklz73rgfjnnfujl3sr2fxgk \
DRY_RUN=true \
./wp-to-nostr.ts 2>&1 | head -20
```

Expected: kein „PermissionDenied" für `EXTRA_HASHTAGS` oder `COMMUNITY_NPUBS`. Falls die Datei nicht ausführbar ist: `chmod +x wp-to-nostr.ts` (sollte aber bereits gesetzt sein).

- [ ] **Step 3: Commit**

```bash
git add wp-to-nostr.ts
git commit -m "Shebang: EXTRA_HASHTAGS und COMMUNITY_NPUBS in --allow-env"
```

---

### Task 9: Workflow-Defaults in `sync.yml`

**Files:**
- Modify: `.github/workflows/sync.yml`

- [ ] **Step 1: Env-Block erweitern**

In `.github/workflows/sync.yml:31-36` den `env:`-Block ändern zu:

```yaml
        env:
          NOSTR_PRIVATE_KEY: ${{ secrets.NOSTR_PRIVATE_KEY }}
          DRY_RUN: ${{ inputs.dry_run || 'false' }}
          WP_API_URL: ${{ vars.WP_API_URL || 'https://relilab.org/wp-json/wp/v2/posts' }}
          WP_CATEGORY: ${{ vars.WP_CATEGORY || '176' }}
          NOSTR_RELAY: ${{ vars.WP_NOSTR_RELAY || 'wss://relay-rpi.edufeed.org' }}
          EXTRA_HASHTAGS: ${{ vars.WP_EXTRA_HASHTAGS || 'relilab' }}
          COMMUNITY_NPUBS: ${{ vars.WP_COMMUNITY_NPUBS || 'npub1fpcxaz2wvjl90gjs60x37ny2pa5u4yqfx7fklz73rgfjnnfujl3sr2fxgk' }}
```

- [ ] **Step 2: YAML-Syntax verifizieren**

Run:

```bash
deno run --allow-read --quiet - <<'EOF'
const text = await Deno.readTextFile(".github/workflows/sync.yml");
console.log(text.length > 0 ? "OK file readable" : "EMPTY");
EOF
```

(Tieferes YAML-Linting läuft beim nächsten GitHub-Action-Trigger; eine Workflow-Run-Verifikation passiert in Task 12.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/sync.yml
git commit -m "sync.yml: Workflow-Defaults für EXTRA_HASHTAGS und COMMUNITY_NPUBS"
```

---

### Task 10: `.env.example`

**Files:**
- Create: `.env.example`

- [ ] **Step 1: Datei anlegen**

Datei: `.env.example`

```env
# wp-to-nostr.ts – Umgebungsvariablen
# ---------------------------------------------------------------------------
# Im Live-Modus PFLICHT: privater Schlüssel zum Signieren der Events.
# Format: nsec1… oder 64-stelliges Hex.
NOSTR_PRIVATE_KEY=

# Wenn 'true', werden Events nur in der Konsole angezeigt, nicht publiziert.
DRY_RUN=false

# WordPress-REST-API-Endpunkt (Default: relilab.org).
WP_API_URL=https://relilab.org/wp-json/wp/v2/posts

# Kategorie-ID auf der WordPress-Seite (Default: 176 = Termine).
WP_CATEGORY=176

# Relay-URL, an die Events gesendet werden.
NOSTR_RELAY=wss://relay-rpi.edufeed.org

# Komma-separierte Liste zusätzlicher Hashtags (t-Tags), die jedem Event
# angehängt werden, wenn nicht ohnehin aus WordPress-Tags vorhanden.
# Leer = keine Anreicherung. Führendes # ist optional.
# Beispiel: relilab,bildung
EXTRA_HASHTAGS=

# Komma-separierte Liste von Community-Identifiern (Communikey-Spec h-Tag).
# Akzeptiert npub1… oder 64-stelliges Hex. Leer = keine Community-Zuordnung.
# Beispiel: npub1fpcxaz2wvjl90gjs60x37ny2pa5u4yqfx7fklz73rgfjnnfujl3sr2fxgk
COMMUNITY_NPUBS=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m ".env.example: alle Env-Variablen als Blaupause dokumentieren"
```

---

### Task 11: README-Update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Aktuellen Stand der README lesen**

Run: `cat README.md | head -120`

Es gibt mit hoher Wahrscheinlichkeit eine Env-Tabelle und einen „Konfiguration"-Abschnitt. Wenn nicht, neue Sektion direkt vor dem Skript-Beschreibungs-Block einfügen.

- [ ] **Step 2: Env-Tabelle ergänzen**

Zwei Zeilen einfügen — Reihenfolge: nach `NOSTR_RELAY`:

```markdown
| `EXTRA_HASHTAGS`  | –       | `""` (Workflow: `relilab`) | Komma-separierte Hashtag-Liste, wird jedem Event als `t`-Tag angehängt, falls nicht ohnehin aus WordPress-Tags vorhanden. Case-insensitive Dedup. |
| `COMMUNITY_NPUBS` | –       | `""` (Workflow: relilab-npub) | Komma-separierte Liste von Community-Pubkeys (npub1… oder Hex), die als `h`-Tag (Communikey-Spec) an jedes Event angehängt werden. |
```

(Falls die README eine andere Spaltenstruktur hat, anpassen — Inhalt bleibt.)

- [ ] **Step 3: Neuen Abschnitt „Tag-Anreicherung" anfügen**

Vor dem Abschnitt zu `cleanup-relay.ts` (oder am Ende der Konfigurationsdoku):

```markdown
## Tag-Anreicherung

Jedes Event wird vor dem Publish um zwei optionale Tag-Gruppen ergänzt:

- **`t`-Tags (Hashtags)** aus `EXTRA_HASHTAGS`. Bestehende Hashtags aus den
  WordPress-Tags werden case-insensitive dedupliziert (`Relilab` aus WP
  blockt `relilab` aus der Konfig).
- **`h`-Tags (Community-Zuordnung nach Communikey-Spec)** aus
  `COMMUNITY_NPUBS`. npubs werden beim Start zu Hex aufgelöst; pro
  Community ein `h`-Tag.

Beide Defaults leben in `.github/workflows/sync.yml` (relilab-spezifisch) —
der Code-Default ist leer. Forks setzen entweder die Repo-Variablen
`WP_EXTRA_HASHTAGS` / `WP_COMMUNITY_NPUBS` oder editieren den Workflow.

**Hinweis zur Sichtbarkeit:** Die Communikey-Spec setzt voraus, dass das
Ziel-Relay nicht im `enforced`-Modus läuft, oder dass der Sync-npub auf der
relevanten Profile-List der Community steht. Bei `enforced`-Relays ohne
Eintrag werden Events sonst stumm verworfen. Aktuell trifft das auf
`relay-rpi.edufeed.org` nicht zu.

**Altbestand:** Bestehende Events erhalten den neuen Tag erst, wenn der
zugehörige WordPress-Post wieder gespeichert wird (`modified_gmt` steigt).
Für sofortigen Rewrite aller Events `cleanup-relay.ts` + Re-Sync nutzen.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "README: Tag-Anreicherung dokumentieren"
```

---

### Task 12: `docs/nostr-kind-31923.md` ergänzen

**Files:**
- Modify: `docs/nostr-kind-31923.md`

- [ ] **Step 1: Datei lesen, Mapping-Abschnitt finden**

Run: `grep -n "^##\|^###" docs/nostr-kind-31923.md`

- [ ] **Step 2: Anmerkung am Ende des Mapping-Abschnitts**

Nach dem Tag-Mapping-Abschnitt (oder am Ende der Datei) anhängen:

```markdown
### Anreicherung über Konfiguration

Zusätzlich zu den aus WordPress abgeleiteten Tags können per Env-Variable
weitere Tags injiziert werden:

- `EXTRA_HASHTAGS` → `["t", "<wert>"]` pro Eintrag (Hashtag-Anreicherung).
- `COMMUNITY_NPUBS` → `["h", "<hex>"]` pro Eintrag (Communikey-Spec).

Beide Anreicherungen sind optional (Code-Default: leer). Sie sind
case-insensitive dedupliziert; bereits aus WordPress oder einer früheren
Iteration vorhandene Tags werden nicht überschrieben oder dupliziert.
```

- [ ] **Step 3: Commit**

```bash
git add docs/nostr-kind-31923.md
git commit -m "Doku kind:31923: Anreicherung erwähnen"
```

---

### Task 13: End-to-End Smoke (lokal, dry-run)

**Files:** keine

- [ ] **Step 1: Vollen Dry-Run mit beiden Defaults**

Run:

```bash
EXTRA_HASHTAGS=relilab \
COMMUNITY_NPUBS=npub1fpcxaz2wvjl90gjs60x37ny2pa5u4yqfx7fklz73rgfjnnfujl3sr2fxgk \
deno task dry-run 2>&1 | tee /tmp/sync-dry.log
```

Expected: Skript läuft durch, Konsole zeigt mindestens ein Event mit `["t", "relilab"]` und `["h", "48706e89…"]`.

- [ ] **Step 2: Verifikation per grep**

```bash
grep -E '"t",\s*"relilab"' /tmp/sync-dry.log | head -3
grep -E '"h",\s*"48706e89' /tmp/sync-dry.log | head -3
```

Expected: jede der beiden Suchen liefert ≥1 Treffer.

- [ ] **Step 3: Test mit ungültigem npub (Fail-Fast-Verhalten)**

```bash
COMMUNITY_NPUBS="kaputter-eintrag" deno task dry-run 2>&1 | head -5
```

Expected: Skript bricht früh ab mit Meldung, die `kaputter-eintrag` enthält. Kein Posting versucht.

- [ ] **Step 4: Test mit leerer Konfig (Backward-Compat)**

```bash
EXTRA_HASHTAGS="" COMMUNITY_NPUBS="" deno task dry-run 2>&1 | tee /tmp/sync-dry-empty.log | head -40
```

Expected: Skript läuft durch, KEINE `["h", …]`-Tags in der Ausgabe. `t`-Tags nur aus WordPress-Tags.

```bash
grep '"h",' /tmp/sync-dry-empty.log | wc -l
```

Expected: `0`.

- [ ] **Step 5: Falls Schritt 1-4 OK: Spec-Specs als „implementiert" markieren**

In beiden Spec-Dateien Status-Zeile updaten:

`docs/superpowers/specs/2026-04-20-hashtag-enrichment-design.md`, Zeile 4:

```
**Status:** Implementiert (siehe `docs/superpowers/plans/2026-05-05-tag-enrichment.md`).
```

`docs/superpowers/specs/2026-05-05-community-h-tag-design.md`, Zeile 4:

```
**Status:** Implementiert (siehe `docs/superpowers/plans/2026-05-05-tag-enrichment.md`).
```

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/
git commit -m "Specs: Status auf 'Implementiert' aktualisieren"
```

---

### Task 14: Smoke-Test entfernen

**Files:**
- Delete: `tests/smoke.test.ts`

- [ ] **Step 1: Smoke-Test löschen** (war Bootstrap, nicht mehr nötig)

```bash
rm tests/smoke.test.ts
```

- [ ] **Step 2: Tests laufen lassen**

Run: `deno task test`
Expected: 27 passed (Smoke weg, Rest grün).

- [ ] **Step 3: Commit**

```bash
git add tests/
git commit -m "Bootstrap-Smoketest entfernen"
```

---

## Self-Review

**Spec-Coverage** (gegen beide Spec-Dokumente abgeglichen):

| Spec-Anforderung | Task |
|---|---|
| Env-Variable `EXTRA_HASHTAGS` mit Komma-Parsing, `#`-Toleranz, Whitespace-Trim | Task 2 |
| `mergeExtraHashtags`: case-insensitive Dedup, keine Mutation | Task 3 |
| Env-Variable `COMMUNITY_NPUBS` akzeptiert npub und Hex, Fail-Fast | Task 4 |
| `mergeCommunityHTags`: Dedup auf Hex, keine Mutation | Task 5 |
| Integration in `mapPostToNostrEvent`, einmaliger Parse beim Start | Task 6 |
| `inspect-mapping.ts` konsistent zum Live-Mapping | Task 7 |
| Shebang/Allow-Env-Listen in allen drei Skripten + `deno.json` | Task 1 + 7 + 8 |
| `sync.yml` mit Workflow-Defaults (relilab) | Task 9 |
| `.env.example` als Blaupause | Task 10 |
| README + kind:31923-Doku | Task 11 + 12 |
| Spec-Begleit-Edits (Hashtag-Spec auf neuen Default-Stil, Community-Frage als gelöst) | bereits erledigt vor Plan-Beginn (Spec-Doku-Phase) |
| End-to-End Smoke + Fail-Fast-Verhalten | Task 13 |

**Placeholder-Scan:** Keine TBDs/TODOs gefunden. Alle Code-Schnipsel ausformuliert. „Falls die README eine andere Spaltenstruktur hat" in Task 11 ist akzeptable Toleranz, da der Inhalt explizit ist.

**Type-Konsistenz:** Funktionsnamen `parseExtraHashtags`, `mergeExtraHashtags`, `parseCommunityNpubs`, `mergeCommunityHTags` durchgängig identisch. Signaturen identisch zwischen Test- und Implementierungs-Blocks. Variablen-Namen `EXTRA_HASHTAGS`, `COMMUNITY_HEX_PUBKEYS` konsistent zwischen Task 6 und Task 7.

**Eine Stelle überprüft und gefixt während Self-Review:** Task 4 hatte ursprünglich einen separaten `nip19decode`-Import vorgeschlagen, was den bestehenden `decode`-Import in Zeile 27 ignoriert hätte. Korrigiert: bestehenden Import wiederverwenden.

---

## Execution Handoff

**Plan komplett und gespeichert unter `docs/superpowers/plans/2026-05-05-tag-enrichment.md`. Zwei Ausführungs-Optionen:**

**1. Subagent-Driven (empfohlen)** — Ich dispatche pro Task einen frischen Subagent, reviewe dazwischen, schnelle Iteration.

**2. Inline Execution** — Tasks werden in dieser Session ausgeführt mit `executing-plans`-Skill, Batch-Execution mit Checkpoints.

**Welcher Ansatz?**
