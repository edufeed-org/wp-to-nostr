import { assertEquals } from "@std/assert";
import { parseExtraHashtags, mergeExtraHashtags } from "../wp-to-nostr.ts";

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
