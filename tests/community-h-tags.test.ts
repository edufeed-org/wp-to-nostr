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
