import { assertEquals } from "@std/assert";
import { kindForSyncMode } from "../wp-to-nostr.ts";

Deno.test("kindForSyncMode: calendar → 31923", () => {
  assertEquals(kindForSyncMode("calendar"), 31923);
});

Deno.test("kindForSyncMode: article → 30023", () => {
  assertEquals(kindForSyncMode("article"), 30023);
});
