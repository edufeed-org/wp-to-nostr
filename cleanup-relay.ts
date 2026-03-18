#!/usr/bin/env -S deno run --allow-net --allow-env=NOSTR_PRIVATE_KEY,NOSTR_RELAY,DRY_RUN
/**
 * cleanup-relay.ts
 *
 * Löscht alle kind:31923 Calendar-Events des eigenen Pubkeys vom Relay
 * per NIP-09 (kind:5 Deletion Events).
 *
 * Danach kann wp-to-nostr.ts sauber neu publizieren.
 *
 * Verwendung:
 *   DRY_RUN=true  deno run --allow-net --allow-env cleanup-relay.ts   # nur anzeigen
 *   NOSTR_PRIVATE_KEY=nsec1… deno run --allow-net --allow-env cleanup-relay.ts  # löschen
 */

import { finalizeEvent, getPublicKey } from "nostr-tools";
import { Relay } from "nostr-tools/relay";
import { decode } from "nostr-tools/nip19";

// ── Konfiguration ────────────────────────────────────────────────────────────

const NOSTR_RELAY = Deno.env.get("NOSTR_RELAY") ?? "wss://relay-rpi.edufeed.org";
const DRY_RUN     = Deno.env.get("DRY_RUN") === "true";
const PRIVKEY_RAW = Deno.env.get("NOSTR_PRIVATE_KEY") ?? "";

// ── Privaten Schlüssel auflösen ─────────────────────────────────────────────

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

// ── Alle kind:31923-Events vom Relay abrufen ────────────────────────────────

interface NostrEvent {
  id: string;
  kind: number;
  created_at: number;
  pubkey: string;
  tags: string[][];
  content: string;
  sig: string;
}

async function fetchExistingEvents(
  relay: Relay,
  pubkey: string
): Promise<NostrEvent[]> {
  return new Promise((resolve) => {
    const events: NostrEvent[] = [];

    const sub = relay.subscribe(
      [{ kinds: [31923], authors: [pubkey] }],
      {
        onevent(event: NostrEvent) {
          events.push(event);
        },
        oneose() {
          sub.close();
          resolve(events);
        },
      }
    );
  });
}

// ── NIP-09 Delete-Event erstellen ───────────────────────────────────────────

function createDeleteEvent(
  eventToDelete: NostrEvent
): { kind: number; created_at: number; tags: string[][]; content: string } {
  // NIP-09: kind:5 mit e-Tag (Event-ID) und a-Tag (adressierbare Referenz)
  const dTag = eventToDelete.tags.find((t) => t[0] === "d")?.[1] ?? "";

  return {
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["e", eventToDelete.id],                                    // Event-ID löschen
      ["a", `31923:${eventToDelete.pubkey}:${dTag}`],             // Adressierbare Referenz löschen
    ],
    content: "cleanup: replace with modified_gmt-based created_at",
  };
}

// ── Hauptprogramm ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n🧹 Relay Cleanup – NIP-09 Deletion");
  console.log(`   Relay : ${NOSTR_RELAY}`);
  console.log(`   Modus : ${DRY_RUN
    ? "🧪 DRY RUN – nichts wird gelöscht"
    : "🗑️  LIVE – Events werden gelöscht"}\n`);

  const privkey = resolvePrivkey(PRIVKEY_RAW);
  const pubkey  = getPublicKey(privkey);
  console.log(`🔑 Pubkey: ${pubkey}\n`);

  // 1. Bestehende Events abrufen
  console.log("📥 Bestehende kind:31923-Events vom Relay abrufen …");
  const relay = await Relay.connect(NOSTR_RELAY);

  let events: NostrEvent[];
  try {
    events = await fetchExistingEvents(relay, pubkey);
  } finally {
    relay.close();
  }

  console.log(`   ${events.length} Events gefunden\n`);

  if (events.length === 0) {
    console.log("✅ Relay ist bereits leer – nichts zu löschen.");
    return;
  }

  // 2. Übersicht anzeigen
  for (const evt of events) {
    const title = evt.tags.find((t) => t[0] === "title")?.[1] ?? "(kein Titel)";
    const dTag  = evt.tags.find((t) => t[0] === "d")?.[1] ?? "(kein d-Tag)";
    const date  = new Date(evt.created_at * 1000).toISOString();
    console.log(`  🗓️  "${title}"`);
    console.log(`     d-Tag:      ${dTag}`);
    console.log(`     created_at: ${date}`);
    console.log(`     Event-ID:   ${evt.id}`);
    console.log();
  }

  if (DRY_RUN) {
    console.log(`📊 DRY RUN: ${events.length} Events würden gelöscht.`);
    return;
  }

  // 3. Delete-Events publizieren (eine Verbindung für alle)
  console.log(`🗑️  Lösche ${events.length} Events …\n`);
  console.log(`🔌 Verbinde mit ${NOSTR_RELAY} …`);
  const delRelay = await Relay.connect(NOSTR_RELAY);
  console.log("   ✅ Verbunden\n");

  let deleted = 0;
  let failed  = 0;

  try {
    for (const evt of events) {
      const title    = evt.tags.find((t) => t[0] === "title")?.[1] ?? "(kein Titel)";
      const deleteTemplate = createDeleteEvent(evt);

      try {
        const signed = finalizeEvent(deleteTemplate, privkey);
        await delRelay.publish(signed);
        console.log(`  ✅ Gelöscht: "${title}"`);
        deleted++;
      } catch (err) {
        console.error(`  ❌ Fehler bei "${title}": ${(err as Error).message}`);
        failed++;
      }
    }
  } finally {
    delRelay.close();
    console.log("\n🔌 Relay-Verbindung geschlossen");
  }

  // Zusammenfassung
  console.log(`\n📊 Zusammenfassung:`);
  console.log(`   ${deleted} von ${events.length} Events gelöscht`);
  if (failed > 0) console.log(`   ⚠️  ${failed} Fehler`);
  console.log(`\n💡 Jetzt wp-to-nostr.ts ausführen um sauber neu zu publizieren.`);
}

main().catch((err: Error) => {
  console.error("\n💥 Fatal:", err.message);
  Deno.exit(1);
});
