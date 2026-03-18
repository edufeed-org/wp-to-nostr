/**
 * Integrationstests: fetchWpPosts()
 *
 * Verwendet einen lokalen Mock-Server statt der echten WordPress-API.
 * Kein Netzwerkzugang zur Produktions-API nötig.
 */

import { assertEquals } from "jsr:@std/assert";

// ── Mock-Server-Hilfsfunktion ─────────────────────────────────────────────────

function startMockServer(
  handler: (req: Request) => Response,
  port = 8788
): Deno.HttpServer<Deno.NetAddr> {
  return Deno.serve({ port, onListen: () => {} }, handler);
}

// ── Funktion unter Test (parametrisierbar) ────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function fetchWpPosts(apiUrl: string, category = "176"): Promise<any[]> {
  const base = new URL(apiUrl);
  base.searchParams.set("categories", category);
  base.searchParams.set("per_page", "100");
  base.searchParams.set("meta_key", "relilab_startdate");
  base.searchParams.set("orderby", "meta_value");
  base.searchParams.set("order", "desc");

  // deno-lint-ignore no-explicit-any
  const all: any[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    base.searchParams.set("page", String(page));
    const res = await fetch(base.toString());
    if (!res.ok) throw new Error(`WordPress API Fehler: ${res.status}`);
    totalPages = Number(res.headers.get("X-WP-TotalPages") ?? "1");
    const posts = await res.json();
    all.push(...posts);
    page++;
  } while (page <= totalPages);

  return all;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

Deno.test("Einzelseite: gibt korrektes Array zurück", async () => {
  const mockPosts = [{ id: 1, title: { rendered: "Post 1" } }];
  const server = startMockServer((_req) =>
    new Response(JSON.stringify(mockPosts), {
      headers: { "Content-Type": "application/json", "X-WP-TotalPages": "1" },
    })
  );

  const posts = await fetchWpPosts("http://localhost:8788/wp-json/wp/v2/posts");
  assertEquals(posts.length, 1);
  assertEquals(posts[0].id, 1);

  await server.shutdown();
});

Deno.test("Pagination: alle 2 Seiten werden abgerufen", async () => {
  const page1 = [{ id: 1 }, { id: 2 }];
  const page2 = [{ id: 3 }, { id: 4 }];
  let requestCount = 0;

  const server = startMockServer((req) => {
    const url = new URL(req.url);
    const page = url.searchParams.get("page") ?? "1";
    requestCount++;
    const data = page === "1" ? page1 : page2;
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json", "X-WP-TotalPages": "2" },
    });
  }, 8789);

  const posts = await fetchWpPosts("http://localhost:8789/wp-json/wp/v2/posts");
  assertEquals(posts.length, 4);
  assertEquals(requestCount, 2);

  await server.shutdown();
});

Deno.test("Leere Ergebnisliste → leeres Array", async () => {
  const server = startMockServer((_req) =>
    new Response(JSON.stringify([]), {
      headers: { "Content-Type": "application/json", "X-WP-TotalPages": "1" },
    })
  , 8790);

  const posts = await fetchWpPosts("http://localhost:8790/wp-json/wp/v2/posts");
  assertEquals(posts.length, 0);

  await server.shutdown();
});

Deno.test("HTTP 500 → Error wird geworfen", async () => {
  const server = startMockServer((_req) =>
    new Response("Internal Server Error", { status: 500 })
  , 8791);

  let threw = false;
  try {
    await fetchWpPosts("http://localhost:8791/wp-json/wp/v2/posts");
  } catch {
    threw = true;
  }
  assertEquals(threw, true);

  await server.shutdown();
});
