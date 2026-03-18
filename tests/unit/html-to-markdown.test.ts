/**
 * Unit-Tests: htmlToMarkdown()
 *
 * Testet die HTML→Markdown-Konvertierung via Turndown.
 */

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
// @deno-types="npm:@types/turndown"
import TurndownService from "turndown";

// ── Funktion unter Test (isolierte Kopie) ────────────────────────────────────

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

function htmlToMarkdown(html: string): string {
  if (!html) return "";
  return turndown.turndown(html).trim();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

Deno.test("leerer String → leerer String (kein Fehler)", () => {
  assertEquals(htmlToMarkdown(""), "");
});

Deno.test("H2-Tag → ATX-Überschrift", () => {
  assertEquals(htmlToMarkdown("<h2>Titel</h2>"), "## Titel");
});

Deno.test("H1-Tag → ATX-Überschrift", () => {
  assertEquals(htmlToMarkdown("<h1>Haupt</h1>"), "# Haupt");
});

Deno.test("Strong → Fettdruck", () => {
  assertEquals(htmlToMarkdown("<strong>fett</strong>"), "**fett**");
});

Deno.test("Em → Kursiv", () => {
  assertEquals(htmlToMarkdown("<em>kursiv</em>"), "_kursiv_");
});

Deno.test("Anchor → Markdown-Link", () => {
  assertEquals(
    htmlToMarkdown('<a href="https://example.com">Link</a>'),
    "[Link](https://example.com)"
  );
});

Deno.test("Code-Block → Fenced Block", () => {
  const result = htmlToMarkdown("<pre><code>const x = 1;</code></pre>");
  assertStringIncludes(result, "```");
  assertStringIncludes(result, "const x = 1;");
});

Deno.test("Paragraph-Tags werden entfernt", () => {
  assertEquals(htmlToMarkdown("<p>Normaler Text</p>"), "Normaler Text");
});

Deno.test("Unordered List → Markdown-Liste", () => {
  const result = htmlToMarkdown("<ul><li>Item 1</li><li>Item 2</li></ul>");
  assertStringIncludes(result, "- Item 1");
  assertStringIncludes(result, "- Item 2");
});

// TODO: HTML-Entitäten-Behandlung durch Turndown verifizieren
// Deno.test("HTML-Entitäten im Content werden dekodiert", () => { ... });
