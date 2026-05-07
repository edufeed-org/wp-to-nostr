import { assertEquals } from "@std/assert";
import { buildWpUrl } from "../wp-to-nostr.ts";

const BASE = "https://relilab.org/wp-json/wp/v2/posts";

Deno.test("buildWpUrl: calendar-Mode → setzt meta_key/meta_value-Sortierung", () => {
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

Deno.test("buildWpUrl: article-Mode → nutzt date-Sortierung mit author-embed", () => {
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
