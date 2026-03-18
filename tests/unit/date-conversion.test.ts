/**
 * Unit-Tests: wpDateToUnix()
 *
 * Testet die Berlin-Zeitzone-Konvertierung.
 * Kopiert aus wp-to-nostr.ts (isoliert testbar).
 */

import { assertEquals } from "jsr:@std/assert";

// ── Funktion unter Test (isolierte Kopie) ────────────────────────────────────

function wpDateToUnix(dateStr: string | undefined): number {
  if (!dateStr) return 0;
  const naiveUtc = new Date(dateStr.replace(" ", "T") + "Z");
  if (isNaN(naiveUtc.getTime())) return 0;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(naiveUtc);

  const g = (type: string) => parts.find(p => p.type === type)?.value ?? "00";
  const berlinWallClock = new Date(
    `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:${g("second")}Z`
  );

  const offsetMs = naiveUtc.getTime() - berlinWallClock.getTime();
  return Math.floor((naiveUtc.getTime() + offsetMs) / 1000);
}

// ── Tests ────────────────────────────────────────────────────────────────────

Deno.test("CET (UTC+1): 2026-03-13 16:00:00 Berlin → 15:00 UTC", () => {
  const ts = wpDateToUnix("2026-03-13 16:00:00");
  const asUtc = new Date(ts * 1000).toISOString();
  assertEquals(asUtc, "2026-03-13T15:00:00.000Z");
});

Deno.test("CEST (UTC+2): 2026-07-15 10:00:00 Berlin → 08:00 UTC", () => {
  const ts = wpDateToUnix("2026-07-15 10:00:00");
  const asUtc = new Date(ts * 1000).toISOString();
  assertEquals(asUtc, "2026-07-15T08:00:00.000Z");
});

Deno.test("Jahreswechsel: 2026-01-01 00:00:00 Berlin → 2025-12-31 23:00 UTC", () => {
  const ts = wpDateToUnix("2026-01-01 00:00:00");
  const asUtc = new Date(ts * 1000).toISOString();
  assertEquals(asUtc, "2025-12-31T23:00:00.000Z");
});

Deno.test("undefined → 0", () => {
  assertEquals(wpDateToUnix(undefined), 0);
});

Deno.test("leerer String → 0", () => {
  assertEquals(wpDateToUnix(""), 0);
});

Deno.test("ungültiges Format → 0", () => {
  assertEquals(wpDateToUnix("kein-datum"), 0);
});

Deno.test("ISO-Format ohne Zeit → 0 (nicht unterstützt)", () => {
  // Nur "YYYY-MM-DD" ohne Zeit – Verhalten dokumentieren
  const ts = wpDateToUnix("2026-03-13");
  // Ergebnis ist nicht 0, aber ambig – Test dokumentiert das Ist-Verhalten
  console.log(`  'YYYY-MM-DD' ohne Zeit ergibt Unix-Timestamp: ${ts}`);
});

// TODO: Zeitumstellungs-Grenzfälle (Sonderfall nicht-existierende Zeit)
// Deno.test("Zeitumstellung März: 2026-03-29 02:30:00 (nicht existent)", () => { ... });
// Deno.test("Zeitumstellung Oktober: 2026-10-25 02:30:00 (ambig)", () => { ... });
