# Test-Fahrplan: wp-to-nostr

Übersicht aller geplanten Tests und Evaluierungsschritte für das WordPress → Nostr Mapping-Tool.

---

## Testbereiche

| # | Bereich | Datei | Status |
|---|---------|-------|--------|
| 1 | Datumskonvertierung (`wpDateToUnix`) | `unit/date-conversion.test.ts` | 🔲 offen |
| 2 | Private-Key-Auflösung (`resolvePrivkey`) | `unit/privkey.test.ts` | 🔲 offen |
| 3 | HTML → Markdown (`htmlToMarkdown`) | `unit/html-to-markdown.test.ts` | 🔲 offen |
| 4 | WP → Nostr Mapping (`mapPostToNostrEvent`) | `unit/mapping.test.ts` | 🔲 offen |
| 5 | WordPress API Pagination (`fetchWpPosts`) | `integration/wp-api.test.ts` | 🔲 offen |
| 6 | Nostr Event Signierung & Relay-Publish | `integration/nostr-publish.test.ts` | 🔲 offen |
| 7 | Dry-Run End-to-End | `e2e/dry-run.test.ts` | 🔲 offen |

---

## 1. Unit-Tests: Datumskonvertierung

**Datei:** `unit/date-conversion.test.ts`

Testet `wpDateToUnix()` – die kritische Berlin-Zeitzone-Konvertierung.

### Testfälle

| Eingabe | Erwartung | Beschreibung |
|---------|-----------|--------------|
| `"2026-03-13 16:00:00"` | `1741874400` | CET → UTC+1 korrekt |
| `"2026-07-15 10:00:00"` | `1752570000` | CEST → UTC+2 korrekt |
| `"2026-03-29 02:30:00"` | Sonderfall | Umstellungsnacht (nicht-existierende Zeit) |
| `"2026-10-25 02:30:00"` | Sonderfall | Rückstellung (ambige Zeit) |
| `undefined` | `0` | fehlender Wert |
| `""` | `0` | leerer String |
| `"kein-datum"` | `0` | ungültiges Format |

### Prüfpunkte

- [ ] UTC+1 (CET, Winter) wird korrekt subtrahiert
- [ ] UTC+2 (CEST, Sommer) wird korrekt subtrahiert
- [ ] Grenzwert Zeitumstellung (März) ist stabil
- [ ] Grenzwert Zeitumstellung (Oktober) ist stabil
- [ ] Ungültige Eingaben liefern `0`

---

## 2. Unit-Tests: Private-Key-Auflösung

**Datei:** `unit/privkey.test.ts`

Testet `resolvePrivkey()` – nsec- und Hex-Format-Parsing.

### Testfälle

| Eingabe | Erwartung |
|---------|-----------|
| Gültiger `nsec1…`-Schlüssel | `Uint8Array` (32 Byte) |
| Gültiger 64-stelliger Hex-String | `Uint8Array` (32 Byte) |
| Leerer String | `Error: NOSTR_PRIVATE_KEY ist nicht gesetzt.` |
| Ungültiger nsec | `Error: Ungültiger nsec-Schlüssel.` |
| Zu kurzer Hex-String | `Error` |
| Hex mit Großbuchstaben | `Uint8Array` (case-insensitive) |

### Prüfpunkte

- [ ] nsec-Bech32-Dekodierung funktioniert
- [ ] Hex-Dekodierung funktioniert
- [ ] Hex-Dekodierung ist case-insensitive
- [ ] Alle Fehlerpfade werfen die richtigen Fehlermeldungen

---

## 3. Unit-Tests: HTML → Markdown

**Datei:** `unit/html-to-markdown.test.ts`

Testet `htmlToMarkdown()` via Turndown.

### Testfälle

| Eingabe | Erwartung |
|---------|-----------|
| `<h2>Titel</h2>` | `## Titel` |
| `<strong>fett</strong>` | `**fett**` |
| `<a href="url">Link</a>` | `[Link](url)` |
| `<pre><code>code</code></pre>` | Fenced code block |
| `""` | `""` (leerer String, kein Fehler) |
| `"<p>Text mit &amp; HTML-Entität</p>"` | `Text mit & HTML-Entität` |
| Verschachteltes HTML | Valides Markdown |

### Prüfpunkte

- [ ] Überschriften werden als ATX (`##`) ausgegeben
- [ ] Code-Blöcke werden als Fenced-Blocks ausgegeben
- [ ] Leerer Input → leerer Output (kein Crash)
- [ ] HTML-Entitäten werden korrekt dekodiert

---

## 4. Unit-Tests: WP → Nostr Mapping

**Datei:** `unit/mapping.test.ts`

Testet `mapPostToNostrEvent()` – das Herzstück des Tools.

### Testfälle

**Vollständiger Post (alle Felder gesetzt):**
- [ ] `kind` ist `31923`
- [ ] `d`-Tag = WordPress-URL
- [ ] `title`-Tag = dekodierter Titel (HTML-Entitäten aufgelöst)
- [ ] `start`-Tag = korrekter Unix-Timestamp
- [ ] `end`-Tag = korrekter Unix-Timestamp
- [ ] `start_tzid` und `end_tzid` = `"Europe/Berlin"`
- [ ] `summary`-Tag vorhanden (wenn Excerpt gesetzt)
- [ ] `location`-Tag = `"Zoom: <url>"` (wenn Zoom-Link gesetzt)
- [ ] `image`-Tag vorhanden (wenn Thumbnail gesetzt)
- [ ] `r`-Tag = WordPress-URL
- [ ] `t`-Tags für alle Schlagwörter

**Minimaler Post (Pflichtfelder):**
- [ ] Post ohne `acf.relilab_startdate` → gibt `null` zurück
- [ ] Post ohne Excerpt → kein `summary`-Tag
- [ ] Post ohne Zoom-Link → kein `location`-Tag
- [ ] Post ohne Bild → kein `image`-Tag
- [ ] Post ohne Tags → keine `t`-Tags

**HTML-Entitäten im Titel:**
- [ ] `&#8211;` → `–`
- [ ] `&amp;` → `&`
- [ ] `&lt;` / `&gt;` → `<` / `>`

---

## 5. Integrationstests: WordPress API

**Datei:** `integration/wp-api.test.ts`

Testet `fetchWpPosts()` mit gemockter oder echter API.

### Strategie

Für CI: Mock-Server via `Deno.serve()` oder `fetch`-Stub.
Für manuelle Prüfung: Echter API-Aufruf (erfordert Netzwerkzugang).

### Testfälle

- [ ] Einzelseite → korrektes Array zurückgegeben
- [ ] Pagination: `X-WP-TotalPages: 3` → alle 3 Seiten werden abgerufen
- [ ] API-Fehler (HTTP 500) → `Error` wird geworfen
- [ ] Leere Ergebnisliste → leeres Array zurückgegeben
- [ ] Korrekte Query-Parameter werden gesetzt (`categories`, `per_page`, `meta_key`, etc.)

---

## 6. Integrationstests: Nostr Relay

**Datei:** `integration/nostr-publish.test.ts`

Testet `publishEvent()` – Signierung und Relay-Verbindung.

### Strategie

Mock-Relay via lokalem WebSocket-Server (kein echter Relay nötig).

### Testfälle

- [ ] Event wird korrekt signiert (ID und Signatur sind valide)
- [ ] Signiertes Event enthält korrekte `pubkey`
- [ ] Relay-Verbindung wird korrekt geöffnet und geschlossen
- [ ] Relay-Verbindungsfehler → `Error` propagiert
- [ ] Relay lehnt Event ab → `Error` propagiert

---

## 7. End-to-End: Dry-Run

**Datei:** `e2e/dry-run.test.ts`

Vollständiger Durchlauf im Dry-Run-Modus – kein echter Relay-Aufruf.

### Voraussetzungen

- Netzwerkzugang zur WordPress API (oder Mock)
- `DRY_RUN=true` gesetzt

### Prüfpunkte

- [ ] Programm startet ohne Fehler
- [ ] Posts werden korrekt abgerufen
- [ ] Events werden gemappt (kein `null`-Fehler)
- [ ] Kein Relay-Aufruf erfolgt
- [ ] Ausgabe enthält `[DRY RUN]`-Meldungen
- [ ] Exit-Code ist `0`

---

## Ausführung

```bash
# Alle Tests
deno test --allow-net --allow-env tests/

# Nur Unit-Tests
deno test --allow-net --allow-env tests/unit/

# Nur Integrationstests
deno test --allow-net --allow-env tests/integration/

# Einzelne Testdatei
deno test --allow-net --allow-env tests/unit/date-conversion.test.ts
```

---

## Evaluation: Qualitätskriterien

| Kriterium | Ziel | Messung |
|-----------|------|---------|
| Zeitzone-Korrektheit | 100 % korrekte Unix-Timestamps | Unit-Tests mit bekannten Werten |
| Mapping-Vollständigkeit | Alle WP-Felder werden korrekt gemappt | Unit-Tests mit vollständigem Mock-Post |
| NIP-52-Konformität | kind:31923-Events sind valide | Nostr-Tools-Validierung |
| Fehlerresistenz | Kein Absturz bei fehlenden Feldern | Tests mit unvollständigen Posts |
| Pagination | Alle Seiten werden gelesen | Mock-API mit mehreren Seiten |

---

## Offene Fragen / Risiken

1. **Zeitumstellung Grenzfälle** – Was passiert bei Posts mit Datum in der nicht-existierenden Stunde (Uhrzeitumstellung März)?
2. **Relay-Timeouts** – Gibt es ein Timeout für `relay.publish()`? Was passiert bei langsamen Relays?
3. **`created_at` = jetzt** – Führt das bei jedem Sync zu neuen Event-IDs, obwohl sich der Inhalt nicht geändert hat?
4. **Duplicate `d`-Tags** – Nostr-Clients sollten ältere Events überschreiben, aber ist das Relay-Verhalten einheitlich?
5. **Großer Content** – Gibt es ein Limit für `content`-Größe bei Nostr-Relays?
