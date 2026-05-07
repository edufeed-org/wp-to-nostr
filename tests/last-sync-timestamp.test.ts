import { assertEquals } from "@std/assert";
import {
  getLastSyncTimestamp,
  type RelayLike,
} from "../wp-to-nostr.ts";

// Minimal-Mock für die Subset-API, die getLastSyncTimestamp braucht.
// `subscribe` ruft onevent für gemockte Events auf, dann oneose und
// gibt ein Objekt mit close()-Methode zurück.
function fakeRelay(events: Array<{ created_at: number }>, opts: { error?: boolean } = {}): RelayLike {
  return {
    subscribe(_filters, handlers) {
      if (opts.error) {
        // Simulieren: subscribe wirft synchron
        throw new Error("connection lost");
      }
      // Async events callback, dann EOSE
      queueMicrotask(() => {
        for (const e of events) handlers.onevent?.(e as any);
        handlers.oneose?.();
      });
      return { close() {} };
    },
  };
}

Deno.test("getLastSyncTimestamp: alle Relays liefern Events → Minimum", async () => {
  const pool = [
    { url: "wss://a", relay: fakeRelay([{ created_at: 2000 }]) },
    { url: "wss://b", relay: fakeRelay([{ created_at: 1500 }]) },
    { url: "wss://c", relay: fakeRelay([{ created_at: 3000 }]) },
  ];
  const ts = await getLastSyncTimestamp(pool, "deadbeef", 31923);
  assertEquals(ts, 1500);
});

Deno.test("getLastSyncTimestamp: ein Relay leer → null", async () => {
  const pool = [
    { url: "wss://a", relay: fakeRelay([{ created_at: 2000 }]) },
    { url: "wss://b", relay: fakeRelay([]) },
  ];
  const ts = await getLastSyncTimestamp(pool, "deadbeef", 31923);
  assertEquals(ts, null);
});

Deno.test("getLastSyncTimestamp: subscribe wirft → null", async () => {
  const pool = [
    { url: "wss://a", relay: fakeRelay([{ created_at: 2000 }]) },
    { url: "wss://b", relay: fakeRelay([], { error: true }) },
  ];
  const ts = await getLastSyncTimestamp(pool, "deadbeef", 31923);
  assertEquals(ts, null);
});

Deno.test("getLastSyncTimestamp: relay=null im Pool (Connect-Fehler) → null", async () => {
  const pool = [
    { url: "wss://a", relay: fakeRelay([{ created_at: 2000 }]) },
    { url: "wss://b", relay: null },
  ];
  const ts = await getLastSyncTimestamp(pool, "deadbeef", 31923);
  assertEquals(ts, null);
});

Deno.test("getLastSyncTimestamp: leerer Pool → null", async () => {
  const ts = await getLastSyncTimestamp([], "deadbeef", 31923);
  assertEquals(ts, null);
});

Deno.test("getLastSyncTimestamp: nimmt das jüngste Event pro Relay", async () => {
  // Relay liefert mehrere Events (limit:1 ist nur Hint, Relay kann mehr senden)
  const pool = [
    {
      url: "wss://a",
      relay: fakeRelay([
        { created_at: 1000 },
        { created_at: 5000 },
        { created_at: 3000 },
      ]),
    },
    { url: "wss://b", relay: fakeRelay([{ created_at: 4000 }]) },
  ];
  const ts = await getLastSyncTimestamp(pool, "deadbeef", 31923);
  // pro Relay max → [5000, 4000] → min = 4000
  assertEquals(ts, 4000);
});
