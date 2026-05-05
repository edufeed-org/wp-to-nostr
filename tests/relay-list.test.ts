import { assertEquals } from "@std/assert";
import { parseRelayList } from "../wp-to-nostr.ts";

Deno.test("parseRelayList: leerer String → leere Liste", () => {
  assertEquals(parseRelayList(""), []);
});

Deno.test("parseRelayList: nur whitespace → leere Liste", () => {
  assertEquals(parseRelayList("   ,, ,"), []);
});

Deno.test("parseRelayList: einzelner Eintrag", () => {
  assertEquals(
    parseRelayList("wss://relay-rpi.edufeed.org"),
    ["wss://relay-rpi.edufeed.org"],
  );
});

Deno.test("parseRelayList: mehrere Einträge mit Whitespace", () => {
  assertEquals(
    parseRelayList(" wss://a.example , wss://b.example "),
    ["wss://a.example", "wss://b.example"],
  );
});

Deno.test("parseRelayList: leere Einträge werden ignoriert", () => {
  assertEquals(
    parseRelayList("wss://a.example,,wss://b.example,"),
    ["wss://a.example", "wss://b.example"],
  );
});

Deno.test("parseRelayList: case-insensitive Dedup, Original-Casing bleibt", () => {
  assertEquals(
    parseRelayList("wss://Relay.Example,WSS://relay.example"),
    ["wss://Relay.Example"],
  );
});

Deno.test("parseRelayList: Reihenfolge der ersten Vorkommen bleibt", () => {
  assertEquals(
    parseRelayList("wss://a,wss://b,wss://a,wss://c"),
    ["wss://a", "wss://b", "wss://c"],
  );
});
