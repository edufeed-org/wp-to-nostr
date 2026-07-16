import { assert, assertEquals } from "@std/assert";
import { eventPayloadEquals, planPublish } from "../wp-to-nostr.ts";

// ── eventPayloadEquals ────────────────────────────────────────────────────────
// Vergleicht nur die inhaltliche Identität (tags + content) — created_at ist
// bewusst ausgenommen, damit ein reiner modified_gmt-Bump (z. B. WP-Bulk-Edit)
// nicht als Änderung zählt.

const basePayload = () => ({
  tags: [
    ["d", "https://relilab.org/termin/"],
    ["title", "Ein Termin"],
    ["start", "1768321800"],
  ],
  content: "Beschreibung",
});

Deno.test("eventPayloadEquals: identische tags + content → true", () => {
  assert(eventPayloadEquals(basePayload(), basePayload()));
});

Deno.test("eventPayloadEquals: abweichender content → false", () => {
  const b = { ...basePayload(), content: "Neue Beschreibung" };
  assertEquals(eventPayloadEquals(basePayload(), b), false);
});

Deno.test("eventPayloadEquals: gleiche Tags in anderer Reihenfolge → true", () => {
  // WP liefert Schlagwörter in instabiler Reihenfolge; die Tag-Reihenfolge
  // trägt keine Semantik und darf kein Republish auslösen.
  const b = basePayload();
  b.tags.reverse();
  assert(eventPayloadEquals(basePayload(), b));
});

Deno.test("eventPayloadEquals: abweichende tags → false", () => {
  const b = basePayload();
  b.tags[1] = ["title", "Umbenannt"];
  assertEquals(eventPayloadEquals(basePayload(), b), false);
});

// ── planPublish ───────────────────────────────────────────────────────────────
// Entscheidet pro Relay, ob publiziert wird:
//   existing = StoredEvent  → nur publizieren, wenn Payload abweicht
//   existing = null         → Event fehlt auf dem Relay → publizieren (Backfill)
//   existing = undefined    → Zustand unbekannt (Query-Fehler) → publizieren
// createdAt wird auf existing.created_at + 1 angehoben, wenn ein Relay mit
// abweichendem Payload bereits eine neuere Version hält (sonst würde das
// adressierbare Event dort mit „have newer" abgelehnt).

const evtTemplate = () => ({
  kind: 31923,
  created_at: 1000,
  ...basePayload(),
});

Deno.test("planPublish: Payload überall unverändert → keine Ziel-Relays", () => {
  const stored = { created_at: 900, ...basePayload() };
  const plan = planPublish(evtTemplate(), [
    { url: "wss://a", existing: stored },
    { url: "wss://b", existing: stored },
  ]);
  assertEquals(plan.relayUrls, []);
});

Deno.test("planPublish: Event fehlt auf einem Relay → nur dieses Relay, created_at unverändert", () => {
  const stored = { created_at: 900, ...basePayload() };
  const plan = planPublish(evtTemplate(), [
    { url: "wss://a", existing: stored },
    { url: "wss://b", existing: null },
  ]);
  assertEquals(plan.relayUrls, ["wss://b"]);
  assertEquals(plan.createdAt, 1000);
});

Deno.test("planPublish: unbekannter Relay-Zustand (Query-Fehler) → publizieren", () => {
  const plan = planPublish(evtTemplate(), [
    { url: "wss://a", existing: undefined },
  ]);
  assertEquals(plan.relayUrls, ["wss://a"]);
});

Deno.test("planPublish: geänderter Payload → publizieren, created_at über neuerer Bestandsversion", () => {
  const stored = {
    created_at: 5000, // neuer als evt.created_at (z. B. früherer FORCE_REPUBLISH)
    tags: basePayload().tags,
    content: "Alte Beschreibung",
  };
  const plan = planPublish(evtTemplate(), [
    { url: "wss://a", existing: stored },
  ]);
  assertEquals(plan.relayUrls, ["wss://a"]);
  assertEquals(plan.createdAt, 5001);
});

Deno.test("planPublish: geänderter Payload, Bestandsversion älter → created_at bleibt", () => {
  const stored = {
    created_at: 900,
    tags: basePayload().tags,
    content: "Alte Beschreibung",
  };
  const plan = planPublish(evtTemplate(), [
    { url: "wss://a", existing: stored },
  ]);
  assertEquals(plan.relayUrls, ["wss://a"]);
  assertEquals(plan.createdAt, 1000);
});
