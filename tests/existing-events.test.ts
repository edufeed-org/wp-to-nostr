import { assertEquals } from "@std/assert";
import { fetchExistingEventsByD, type RelayLike } from "../wp-to-nostr.ts";

interface FakeEvent {
  created_at: number;
  tags: string[][];
  content: string;
}

function fakeRelay(events: FakeEvent[], opts: { error?: boolean } = {}): RelayLike {
  return {
    subscribe(_filters, handlers) {
      if (opts.error) throw new Error("connection lost");
      queueMicrotask(() => {
        for (const e of events) handlers.onevent?.(e as any);
        handlers.oneose?.();
      });
      return { close() {} };
    },
  };
}

Deno.test("fetchExistingEventsByD: Map d-Tag → Event, neueste Version gewinnt", async () => {
  const relay = fakeRelay([
    { created_at: 1000, tags: [["d", "url-a"], ["title", "Alt"]], content: "alt" },
    { created_at: 2000, tags: [["d", "url-a"], ["title", "Neu"]], content: "neu" },
    { created_at: 1500, tags: [["d", "url-b"]], content: "b" },
  ]);
  const map = await fetchExistingEventsByD("wss://a", relay, "deadbeef", 31923);
  assertEquals(map?.size, 2);
  assertEquals(map?.get("url-a")?.content, "neu");
  assertEquals(map?.get("url-a")?.created_at, 2000);
  assertEquals(map?.get("url-b")?.content, "b");
});

Deno.test("fetchExistingEventsByD: leeres Relay → leere Map (nicht null)", async () => {
  const map = await fetchExistingEventsByD("wss://a", fakeRelay([]), "deadbeef", 31923);
  assertEquals(map?.size, 0);
});

Deno.test("fetchExistingEventsByD: subscribe wirft → null (Zustand unbekannt)", async () => {
  const map = await fetchExistingEventsByD(
    "wss://a",
    fakeRelay([], { error: true }),
    "deadbeef",
    31923,
  );
  assertEquals(map, null);
});

Deno.test("fetchExistingEventsByD: relay=null (Connect-Fehler) → null", async () => {
  const map = await fetchExistingEventsByD("wss://a", null, "deadbeef", 31923);
  assertEquals(map, null);
});

Deno.test("fetchExistingEventsByD: Events ohne d-Tag werden ignoriert", async () => {
  const relay = fakeRelay([
    { created_at: 1000, tags: [["title", "ohne d"]], content: "x" },
  ]);
  const map = await fetchExistingEventsByD("wss://a", relay, "deadbeef", 31923);
  assertEquals(map?.size, 0);
});
