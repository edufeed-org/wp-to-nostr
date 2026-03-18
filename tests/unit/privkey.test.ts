/**
 * Unit-Tests: resolvePrivkey()
 *
 * Testet nsec-Bech32 und Hex-Format-Parsing.
 */

import { assertEquals, assertThrows } from "jsr:@std/assert";
import { decode } from "nostr-tools/nip19";

// ── Funktion unter Test (isolierte Kopie) ────────────────────────────────────

function resolvePrivkey(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("NOSTR_PRIVATE_KEY ist nicht gesetzt.");

  if (trimmed.startsWith("nsec")) {
    const decoded = decode(trimmed);
    if (decoded.type !== "nsec") throw new Error("Ungültiger nsec-Schlüssel.");
    return decoded.data as Uint8Array;
  }

  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return Uint8Array.from(
      trimmed.match(/.{2}/g)!.map((byte) => parseInt(byte, 16))
    );
  }

  throw new Error("NOSTR_PRIVATE_KEY muss nsec1… oder eine 64-stellige Hex-Zeichenkette sein.");
}

// ── Testdaten ─────────────────────────────────────────────────────────────────
// Öffentlicher Testschlüssel – niemals für echte Funds verwenden

const TEST_HEX = "0000000000000000000000000000000000000000000000000000000000000001";
// Entspricht nsec: nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnqpv6gl

// ── Tests ─────────────────────────────────────────────────────────────────────

Deno.test("Hex-Format (Kleinbuchstaben) → Uint8Array (32 Byte)", () => {
  const key = resolvePrivkey(TEST_HEX);
  assertEquals(key.length, 32);
  assertEquals(key[31], 1); // letztes Byte = 0x01
});

Deno.test("Hex-Format (Großbuchstaben) → Uint8Array (case-insensitive)", () => {
  const key = resolvePrivkey(TEST_HEX.toUpperCase());
  assertEquals(key.length, 32);
  assertEquals(key[31], 1);
});

Deno.test("Leerer String → Error 'nicht gesetzt'", () => {
  assertThrows(
    () => resolvePrivkey(""),
    Error,
    "NOSTR_PRIVATE_KEY ist nicht gesetzt."
  );
});

Deno.test("Nur Whitespace → Error 'nicht gesetzt'", () => {
  assertThrows(
    () => resolvePrivkey("   "),
    Error,
    "NOSTR_PRIVATE_KEY ist nicht gesetzt."
  );
});

Deno.test("Zu kurzer Hex-String → Error", () => {
  assertThrows(
    () => resolvePrivkey("deadbeef"),
    Error
  );
});

Deno.test("Ungültiges Format → Error", () => {
  assertThrows(
    () => resolvePrivkey("not-a-key"),
    Error
  );
});

// TODO: nsec-Format testen (erfordert gültigen nsec-Testschlüssel)
// Deno.test("Gültiger nsec1-Schlüssel → Uint8Array (32 Byte)", () => { ... });
// Deno.test("Ungültiger nsec-Prefix → Error 'Ungültiger nsec-Schlüssel'", () => { ... });
