# Inkrementeller Sync via Relay-State

**Status:** Draft
**Datum:** 2026-05-07

## Problem

`wp-to-nostr.ts` holt bei jedem Lauf alle Posts der konfigurierten WordPress-Kategorie (~600 Termine) und bietet sie allen konfigurierten Relays zur Veröffentlichung an. Die Relays deduplizieren via NIP-01 Replace-Semantik (`replaced: have newer`), die Pipeline produziert also keine doppelten Events — aber jeder Lauf signiert und überträgt 600 unveränderte Events. Das bläht Logs auf, kostet WP-Traffic über mehrere REST-API-Seiten und macht echte Änderungen schwer zu erkennen.

Ziel: Nur Posts holen und veröffentlichen, deren `modified_gmt` sich seit dem letzten erfolgreichen Sync geändert hat.

## Nicht-Ziele

- Keine clientseitige Deduplizierung von _unveränderten_ Posts, die das Relay nicht kennt — wenn ein Relay leer ist (Erstbefüllung, neu hinzugefügtes Relay), wird vollständig synchronisiert.
- Keine Änderung am Event-Mapping selbst (Tags, Content, `created_at`-Logik bleiben).
- Kein eigener persistenter State im Repo, im GitHub-Cache oder einer Datenbank.

## Designentscheidungen

### Entscheidung 1: Quelle der Wahrheit ist das Relay

Vor jedem WP-Fetch fragt der Sync seine Relays nach dem neuesten eigenen Event des relevanten `kind`. Daraus wird der Cutoff für die WP-Query abgeleitet.

**Warum:** Zustandslos, kein zusätzlicher Speicher, kein Drift zwischen „was im State steht" und „was wirklich publiziert wurde". Forks funktionieren ohne zusätzliches Setup. Passt zur bestehenden Replace-Semantik.

**Trade-off:** Ein zusätzlicher Relay-REQ pro Lauf. Vernachlässigbar gegenüber der heute schon nötigen WP-Pagination (~6 Seiten).

### Entscheidung 2: Minimum über alle Relays

Wenn mehrere Relays konfiguriert sind, wird das **Minimum** der `created_at`-Werte als Cutoff verwendet.

**Warum:** Garantiert, dass jedes Relay alle Änderungen seit seinem eigenen letzten Stand bekommt. Schützt gegen „ein Relay war kurz down". Sichere Default-Wahl.

**Trade-off:** Etwas mehr Events werden veröffentlicht als theoretisch nötig. Da Relays sowieso deduplizieren, ist das praktisch kostenlos.

### Entscheidung 3: Im Zweifel Vollsync

Jede Unsicherheit (Relay nicht erreichbar, leeres Ergebnis, fehlender Pubkey im Dry-Run) → Cutoff = `null` → Vollsync.

**Warum:** Sicherer Default. Lieber 600 Events nochmal anbieten (Relay skippt) als ein Update zu verlieren.

### Entscheidung 4: `FORCE_REPUBLISH` umgeht den Filter

Wenn `FORCE_REPUBLISH=true`, wird der Relay-REQ übersprungen und wie bisher alles geholt + mit `created_at = now` publiziert.

**Warum:** `FORCE_REPUBLISH` existiert genau für den Fall „Mapping-Code geändert, alle Bestandsdaten neu rendern lassen". `modified_gmt` ändert sich dabei nicht — der Filter würde diesen Anwendungsfall sonst brechen.

## Architektur

### Komponenten

**Neu in `wp-to-nostr.ts`:**

- `getLastSyncTimestamp(relayPool, pubkey, kind): Promise<number | null>`
  Pro verbundenem Relay: REQ mit `{authors:[pubkey], kinds:[kind], limit:1}`, sammelt das `created_at` des neuesten eigenen Events. Gibt `Math.min(...)` zurück, wenn alle Relays Events liefern. Andernfalls `null` (= Vollsync). Bei Verbindungsfehlern auf einzelnen Relays → null. Timeout pro Relay: 5 s.

- `fetchWpPosts(modifiedAfter?: Date)`
  Bestehende Funktion bekommt einen optionalen Parameter. Wenn gesetzt: hängt einen TZ-sicheren `modified_after_gmt`- bzw. `modified_after`-Parameter an die WP-Query. Konkrete Variante wird in der Implementierung empirisch geprüft (siehe „Offene Implementierungsfragen").

**Geänderter Flow in `main()`:**

1. Privkey resolven (wie heute, nur im Live-Modus).
2. Pubkey aus Privkey ableiten.
3. Relay-Pool aufbauen (heute erst nach WP-Fetch — wird vorgezogen).
4. Cutoff bestimmen:
   - `FORCE_REPUBLISH=true` → null
   - `DRY_RUN=true` ohne Privkey → null
   - sonst: `getLastSyncTimestamp(relayPool, pubkey, kindFürSyncMode)`
5. Cutoff (mit −60 s Sicherheitspuffer gegen Clock-Drift) an `fetchWpPosts` übergeben.
6. Mapping + Publishing wie bisher.

**Kind je Sync-Mode:**
- `SYNC_MODE=calendar` → `kind=31923`
- `SYNC_MODE=article` → `kind=30023`

Beide Modi laufen weiterhin als separate Workflows mit eigenem Cutoff.

### Datenfluss

```
main()
  ├─ resolvePrivkey() → privkey, pubkey
  ├─ Relay.connect() pro NOSTR_RELAYS  → relayPool
  ├─ getLastSyncTimestamp(relayPool, pubkey, kind)  → cutoff | null
  ├─ fetchWpPosts(cutoff)  → posts (gefiltert von WP-Seite)
  ├─ posts → events (mappen)
  └─ publishEvent() pro event auf relayPool (wie bisher)
```

### Fehlerverhalten

| Situation | Verhalten |
|---|---|
| Alle Relays liefern Events | Cutoff = `min(created_at)`, inkrementell |
| Mind. 1 Relay liefert kein Event | Cutoff = `null`, Vollsync |
| Mind. 1 Relay nicht erreichbar | Cutoff = `null`, Vollsync |
| `FORCE_REPUBLISH=true` | REQ übersprungen, Vollsync mit `created_at=now` |
| `DRY_RUN=true` ohne Privkey | REQ übersprungen, Vollsync (Anzeige-Zwecke) |
| WP-API liefert 0 Posts bei aktivem Filter | Pipeline endet sauber mit „Nichts zu publizieren" |

## Tests

Drei neue Tests in `tests/`:

1. **`getLastSyncTimestamp` mit gemocktem Relay-Pool**
   - alle Relays liefern Events → gibt `min(created_at)` zurück
   - ein Relay liefert kein Event → gibt `null` zurück
   - ein Relay-REQ wirft Fehler → gibt `null` zurück

2. **Query-Bau in `fetchWpPosts(modifiedAfter)`**
   - Argument gesetzt → URL enthält den Filter-Param mit korrektem ISO-Format
   - Argument fehlt → URL enthält keinen Filter-Param (Backwards-Compat)

3. **End-to-End mit Mock-WP**
   - Mock-WP gibt 0 Posts zurück bei aktivem Filter → `main()` endet ohne Fehler, gibt „nichts zu publizieren" aus

Bestehende Tests bleiben unberührt — `fetchWpPosts()` ohne Argument behält das Altverhalten.

## Doku-Änderungen

`README.md` bekommt einen Absatz:

- Wie der inkrementelle Sync funktioniert (Relay als State-Quelle).
- Wann ein Vollsync passiert (leeres Relay, Fehler, `FORCE_REPUBLISH`).
- Hinweis: Bei Mapping-Änderungen einmalig `FORCE_REPUBLISH=true` per `workflow_dispatch` triggern.

## Offene Implementierungsfragen

Diese werden im Plan / während der Umsetzung aufgelöst, nicht im Design:

- **TZ-sicherer WP-Query-Param:** WP-REST-API akzeptiert sowohl `modified_after` (Site-Lokalzeit, hier Berlin) als auch — abhängig von Plugin/Version — `modified_after_gmt`. Wir prüfen empirisch gegen `relilab.org`, welche Variante korrekt UTC-basiert filtert, und nehmen die.
- **Relay-Subscribe-API in nostr-tools:** Ob wir `pool.querySync()` auf einer einzelnen `Relay`-Instanz nutzen oder direkt `relay.subscribe()` mit EOSE/Timeout — wird beim Implementieren entschieden, kommt auf nostr-tools-Version an.

## Was sich für Nutzer ändert

- Schnellere Läufe, weniger Logspam (typischer Lauf: 0–5 Posts statt 600).
- Bei Mapping-Änderungen: einmal `FORCE_REPUBLISH=true` per `workflow_dispatch` triggern (wie bisher gedacht).
- Neue Relays werden beim ersten Lauf automatisch vollständig befüllt.
