import { assertEquals, assert, assertStringIncludes } from "@std/assert";
import { mapPostToArticleEvent } from "../wp-to-nostr.ts";

// Minimal-Fixture eines WP-Posts (nur die für mapPostToArticleEvent
// relevanten Felder; alles andere darf fehlen oder leer sein).
function fixturePost(overrides: Record<string, unknown> = {}): any {
  return {
    id: 22259,
    link: "https://relilab.org/lernmodul-test/",
    guid: { rendered: "https://relilab.org/?p=22259" },
    title: { rendered: "Mein &amp; Test-Lernmodul" },
    content: { rendered: "<p>Hallo Welt</p>" },
    excerpt: { rendered: "<p>Kurzbeschreibung</p>" },
    date_gmt: "2026-04-30T13:07:13",
    modified_gmt: "2026-04-30T14:29:42",
    featured_image_urls_v2: { thumbnail: ["https://relilab.org/img.png"] },
    taxonomy_info: { post_tag: [{ label: "OER" }, { label: "Theologie" }] },
    _embedded: {
      author: [{ name: "Corinna Ullmann", link: "https://relilab.org/author/colibri/" }],
    },
    ...overrides,
  };
}

Deno.test("mapPostToArticleEvent: kind ist 30023", () => {
  const evt = mapPostToArticleEvent(fixturePost());
  assertEquals(evt.kind, 30023);
});

Deno.test("mapPostToArticleEvent: title-Tag mit dekodierten HTML-Entitäten", () => {
  const evt = mapPostToArticleEvent(fixturePost());
  const title = evt.tags.find((t) => t[0] === "title")?.[1];
  assertEquals(title, "Mein & Test-Lernmodul");
});

Deno.test("mapPostToArticleEvent: d-Tag und r-Tag sind WP-Permalink", () => {
  const evt = mapPostToArticleEvent(fixturePost());
  const d = evt.tags.find((t) => t[0] === "d")?.[1];
  const r = evt.tags.find((t) => t[0] === "r")?.[1];
  assertEquals(d, "https://relilab.org/lernmodul-test/");
  assertEquals(r, "https://relilab.org/lernmodul-test/");
});

Deno.test("mapPostToArticleEvent: published_at = date_gmt als Unix-Sekunden", () => {
  const evt = mapPostToArticleEvent(fixturePost());
  const publishedAt = Number(evt.tags.find((t) => t[0] === "published_at")?.[1]);
  // 2026-04-30T13:07:13Z = 1777554433
  assertEquals(publishedAt, 1777554433);
});

Deno.test("mapPostToArticleEvent: image-Tag aus featured_image_urls_v2", () => {
  const evt = mapPostToArticleEvent(fixturePost());
  const img = evt.tags.find((t) => t[0] === "image")?.[1];
  assertEquals(img, "https://relilab.org/img.png");
});

Deno.test("mapPostToArticleEvent: WP-Tags werden zu t-Tags", () => {
  const evt = mapPostToArticleEvent(fixturePost());
  const tTagValues = evt.tags.filter((t) => t[0] === "t").map((t) => t[1]);
  assert(tTagValues.includes("OER"));
  assert(tTagValues.includes("Theologie"));
});

Deno.test("mapPostToArticleEvent: Content beginnt mit Autor-Header (Markdown)", () => {
  const evt = mapPostToArticleEvent(fixturePost());
  // Erste Zeile: blockquote mit Autor und Link
  assertStringIncludes(
    evt.content,
    "> Erstellt von: [Corinna Ullmann](https://relilab.org/author/colibri/)",
  );
  // Zweite Zeile: Link zur Quelle
  assertStringIncludes(
    evt.content,
    "> Veröffentlicht auf [relilab.org](https://relilab.org/lernmodul-test/)",
  );
  // Danach der eigentliche Content
  assertStringIncludes(evt.content, "Hallo Welt");
});

Deno.test("mapPostToArticleEvent: ohne Autor nur Quellen-Header", () => {
  const post = fixturePost({ _embedded: undefined });
  const evt = mapPostToArticleEvent(post);
  assertStringIncludes(evt.content, "> Veröffentlicht auf");
  assert(!evt.content.includes("Erstellt von:"));
});

Deno.test("mapPostToArticleEvent: Autor ohne Link → Header ohne Markdown-Link", () => {
  const post = fixturePost({
    _embedded: { author: [{ name: "Anonymer Autor" }] },
  });
  const evt = mapPostToArticleEvent(post);
  assertStringIncludes(evt.content, "> Erstellt von: Anonymer Autor");
  assert(!evt.content.includes("[Anonymer Autor]"));
});

Deno.test("mapPostToArticleEvent: kein start/end/start_tzid (das ist Calendar-Spezifika)", () => {
  const evt = mapPostToArticleEvent(fixturePost());
  assert(!evt.tags.some((t) => t[0] === "start"));
  assert(!evt.tags.some((t) => t[0] === "end"));
  assert(!evt.tags.some((t) => t[0] === "start_tzid"));
});
