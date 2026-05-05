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
