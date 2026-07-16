import { assert, assertEquals } from "@std/assert";
import { mapPostToCalendarEvent } from "../wp-to-nostr.ts";

// Minimal-Fixture eines WP-Termin-Posts (nur die für mapPostToCalendarEvent
// relevanten Felder). Start/Ende sind Berliner Lokalzeit (CET, UTC+1):
// 2026-01-13 16:30 Berlin = 2026-01-13T15:30:00Z.
function fixturePost(overrides: Record<string, unknown> = {}): any {
  return {
    id: 12345,
    link: "https://relilab.org/mini-erklaerfilme/",
    guid: { rendered: "https://relilab.org/?p=12345" },
    title: { rendered: "MINI-Erklärfilme im Religionsunterricht" },
    content: { rendered: "<p>Beschreibung</p>" },
    excerpt: { rendered: "<p>Kurz</p>" },
    date_gmt: "2025-12-01T10:00:00",
    modified_gmt: "2026-07-15T13:10:42",
    acf: {
      relilab_startdate: "2026-01-13 16:30:00",
      relilab_enddate: "2026-01-13 17:30:00",
    },
    ...overrides,
  };
}

const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

Deno.test("mapPostToCalendarEvent: Termin komplett in der Vergangenheit → null", () => {
  // "jetzt" ist ein halbes Jahr nach dem Termin
  const now = unix("2026-07-16T12:00:00Z");
  assertEquals(mapPostToCalendarEvent(fixturePost(), now), null);
});

Deno.test("mapPostToCalendarEvent: laufender Termin (Start vorbei, Ende offen) bleibt", () => {
  // Termin läuft gerade: 16:45 Berlin = 15:45 UTC
  const now = unix("2026-01-13T15:45:00Z");
  const evt = mapPostToCalendarEvent(fixturePost(), now);
  assert(evt !== null);
});

Deno.test("mapPostToCalendarEvent: zukünftiger Termin bleibt", () => {
  const now = unix("2026-01-01T00:00:00Z");
  const evt = mapPostToCalendarEvent(fixturePost(), now);
  assert(evt !== null);
  assertEquals(evt!.kind, 31923);
});

Deno.test("mapPostToCalendarEvent: vergangener Start ohne Enddatum → null", () => {
  const now = unix("2026-07-16T12:00:00Z");
  const post = fixturePost({
    acf: { relilab_startdate: "2026-01-13 16:30:00" },
  });
  assertEquals(mapPostToCalendarEvent(post, now), null);
});

Deno.test("mapPostToCalendarEvent: ohne Startdatum → null (bestehendes Verhalten)", () => {
  const now = unix("2026-01-01T00:00:00Z");
  const post = fixturePost({ acf: {} });
  assertEquals(mapPostToCalendarEvent(post, now), null);
});
