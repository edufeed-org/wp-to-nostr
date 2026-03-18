/**
 * Integrationstests: Event-Signierung
 *
 * Testet die kryptografische Korrektheit signierter Nostr-Events.
 * Kein echter Relay nötig – nur nostr-tools-Validierung.
 *
 * Hinweis: relay.publish() ist nicht isoliert testbar ohne echten WebSocket-Server.
 * Dieser Test fokussiert auf die Signierung (finalizeEvent + verifyEvent).
 */

import { assertEquals, assert } from "jsr:@std/assert";
import { finalizeEvent, getPublicKey, verifyEvent } from "nostr-tools";

// ── Testschlüssel (öffentlich, nur für Tests) ─────────────────────────────────

const TEST_PRIVKEY = Uint8Array.from(
  "0000000000000000000000000000000000000000000000000000000000000001"
    .match(/.{2}/g)!.map(b => parseInt(b, 16))
);

// ── Tests ─────────────────────────────────────────────────────────────────────

Deno.test("finalizeEvent erzeugt valides signiertes Event", () => {
  const template = {
    kind: 31923,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["d", "https://example.com/event/"],
      ["title", "Test-Event"],
      ["start", "1744286400"],
      ["start_tzid", "Europe/Berlin"],
    ],
    content: "Testbeschreibung",
  };

  const signed = finalizeEvent(template, TEST_PRIVKEY);

  // Pflichtfelder vorhanden
  assert(signed.id.length === 64, "ID muss 64-stelliger Hex-String sein");
  assert(signed.sig.length === 128, "Signatur muss 128-stelliger Hex-String sein");
  assertEquals(signed.kind, 31923);

  // Signatur kryptografisch korrekt
  assert(verifyEvent(signed), "Event-Signatur muss valide sein");
});

Deno.test("pubkey stimmt mit Testschlüssel überein", () => {
  const expectedPubkey = getPublicKey(TEST_PRIVKEY);
  const template = {
    kind: 31923,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: "",
  };
  const signed = finalizeEvent(template, TEST_PRIVKEY);
  assertEquals(signed.pubkey, expectedPubkey);
});

Deno.test("Manipuliertes Event ist nicht mehr valide", () => {
  const template = {
    kind: 31923,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["title", "Original"]],
    content: "Original",
  };
  const signed = finalizeEvent(template, TEST_PRIVKEY);

  // Content manipulieren
  const tampered = { ...signed, content: "Manipuliert" };
  assertEquals(verifyEvent(tampered), false);
});

// TODO: relay.publish() mit Mock-WebSocket-Server
// Deno.test("relay.publish() verbindet und sendet Event", async () => { ... });
// Deno.test("Relay-Verbindungsfehler propagiert als Error", async () => { ... });
