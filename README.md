# wp-to-nostr

WordPress-Termine als Nostr-Kalenderevents (kind:31923, NIP-52) veröffentlichen.

Holt Posts aus einer WordPress REST-API, mappt sie auf das [NIP-52](https://github.com/nostr-protocol/nips/blob/master/52.md) Kalenderformat und publiziert sie auf einem Nostr-Relay. Läuft als **GitHub Action** (Cron alle 6 h) oder lokal mit **Deno**.

## Features

- **Vollständige Pagination** – holt alle Posts, nicht nur die erste Seite
- **Korrekte Zeitzonenkonvertierung** – WordPress-Lokalzeit (Europe/Berlin) → UTC-Timestamp
- **HTML → Markdown** – Content und Excerpt via Turndown
- **Addressable Events** – `d`-Tag = WordPress-Permalink, Relay ersetzt automatisch ältere Versionen
- **Relay-Deduplizierung** – `created_at` = `modified_gmt` aus WordPress → unveränderte Posts werden vom Relay automatisch ignoriert (kein unnötiger Write)
- **Single-Connection** – alle Events über eine einzige WebSocket-Verbindung (statt pro Event eine neue)
- **Dry-Run-Modus** – Events anzeigen ohne zu posten
- **Inspect-Tool** – einzelne Posts debuggen mit Vergleichstabelle
- **Cleanup-Tool** – alle Events per NIP-09 vom Relay löschen (für sauberen Neuaufbau)

## Schnellstart

### Voraussetzung

[Deno](https://deno.com) ≥ 2.x installieren:

```bash
# macOS
brew install deno

# Linux / Windows
curl -fsSL https://deno.land/install.sh | sh
```

### Dry Run (lokal testen, nichts posten)

```bash
deno task dry-run
```

### Live (auf Relay veröffentlichen)

```bash
NOSTR_PRIVATE_KEY=nsec1… deno task start
```

### Einzelnen Post inspizieren

```bash
deno task inspect              # erster Post
WP_PAGE=3 deno task inspect    # erster Post von Seite 3
```

### Relay aufräumen (alle Events löschen)

```bash
# Dry-Run – zeigt was gelöscht würde
NOSTR_PRIVATE_KEY=nsec1… DRY_RUN=true deno task cleanup-dry

# Live – löscht alle kind:31923-Events per NIP-09
NOSTR_PRIVATE_KEY=nsec1… deno task cleanup
```

> **Hinweis zu strfry:** NIP-09 Delete-Events werden von strfry persistent gespeichert.
> Nach einem Cleanup lehnt strfry Neu-Publikationen für gelöschte Adressen ab.
> Für einen sauberen Neuaufbau müssen die Delete-Events (kind:5) direkt auf dem
> Relay-Server entfernt werden – siehe [docs/strfry-cleanup.md](docs/strfry-cleanup.md).

## Umgebungsvariablen

| Variable           | Pflicht       | Standard                                          | Beschreibung                            |
|--------------------|---------------|---------------------------------------------------|-----------------------------------------|
| `NOSTR_PRIVATE_KEY`| Live-Modus ✅ | –                                                 | `nsec1…` oder 64-stellige Hex-Zeichenkette |
| `DRY_RUN`          | –             | `false`                                           | `true` → nur anzeigen, nicht posten     |
| `FORCE_REPUBLISH`  | –             | `false`                                           | `true` → `created_at = now`, ersetzt rückwirkend alle Events einmalig |
| `SYNC_MODE`        | –             | `calendar`                                        | `calendar` (kind:31923 Termine) oder `article` (kind:30023 Long-Form) |
| `WP_API_URL`       | –             | `https://relilab.org/wp-json/wp/v2/posts`         | WordPress REST-API-Endpunkt             |
| `WP_CATEGORY`      | –             | `176`                                             | WordPress-Kategorie-ID (Termine: 176; Lernmodule: 6) |
| `NOSTR_RELAY`      | –             | `wss://relay-rpi.edufeed.org`                     | Ziel-Relay (WSS-URL)                    |
| `EXTRA_HASHTAGS`  | –             | `""` (Workflow: `relilab`)                        | Komma-separierte Hashtag-Liste, wird jedem Event als `t`-Tag angehängt, falls nicht ohnehin aus WordPress-Tags vorhanden. Case-insensitive Dedup. |
| `COMMUNITY_NPUBS` | –             | `""` (Workflow: relilab-npub)                     | Komma-separierte Liste von Community-Pubkeys (npub1… oder Hex), die als `h`-Tag (Communikey-Spec) an jedes Event angehängt werden. |

## Tag-Anreicherung

Jedes Event wird vor dem Publish um zwei optionale Tag-Gruppen ergänzt:

- **`t`-Tags (Hashtags)** aus `EXTRA_HASHTAGS`. Bestehende Hashtags aus den
  WordPress-Tags werden case-insensitive dedupliziert (`Relilab` aus WP
  blockt `relilab` aus der Konfig).
- **`h`-Tags (Community-Zuordnung nach Communikey-Spec)** aus
  `COMMUNITY_NPUBS`. npubs werden beim Start zu Hex aufgelöst; pro
  Community ein `h`-Tag.

Beide Defaults leben in `.github/workflows/sync.yml` (relilab-spezifisch) —
der Code-Default ist leer. Forks setzen entweder die Repo-Variablen
`WP_EXTRA_HASHTAGS` / `WP_COMMUNITY_NPUBS` oder editieren den Workflow.

**Hinweis zur Sichtbarkeit:** Die Communikey-Spec setzt voraus, dass das
Ziel-Relay nicht im `enforced`-Modus läuft, oder dass der Sync-npub auf der
relevanten Profile-List der Community steht. Bei `enforced`-Relays ohne
Eintrag werden Events sonst stumm verworfen. Aktuell trifft das auf
`relay-rpi.edufeed.org` nicht zu.

**Altbestand:** Bestehende Events erhalten den neuen Tag erst, wenn der
zugehörige WordPress-Post wieder gespeichert wird (`modified_gmt` steigt).
Für sofortigen Rewrite aller Events `cleanup-relay.ts` + Re-Sync nutzen.

## GitHub Actions

Es laufen zwei voneinander unabhängige Workflows alle 6 Stunden:

- **`.github/workflows/sync.yml`** — Termine-Sync (`SYNC_MODE=calendar`,
  `WP_CATEGORY=176`, kind:31923). Cron-Offset: `:00`.
- **`.github/workflows/sync-articles.yml`** — Article-Sync (`SYNC_MODE=article`,
  `WP_CATEGORY=6` Lernmodule, kind:30023 Long-Form). Cron-Offset: `:30`.

Beide nutzen denselben Sync-npub (`NOSTR_PRIVATE_KEY`-Secret), unterscheiden
sich nur durch Env-Variablen.

### Einrichtung

1. **Secret anlegen:** Repository → Settings → Secrets → Actions → `NOSTR_PRIVATE_KEY`
2. **Optional – Variables:** `WP_API_URL`, `WP_CATEGORY` (Termine), `WP_ARTICLE_CATEGORY` (Beiträge), `WP_NOSTR_RELAY`, `WP_EXTRA_HASHTAGS`, `WP_COMMUNITY_NPUBS` als Repository-Variables setzen, um die Defaults zu überschreiben
3. **Manueller Test:** Actions → „WordPress → Nostr Sync" / „WordPress → Nostr Article Sync" → „Run workflow" → Dry Run = `true`
4. **Live schalten:** Workflow erneut starten mit Dry Run = `false`

Beide Cron-Jobs laufen automatisch im Live-Modus (`DRY_RUN=false`).

### Article-Sync: Autorenzuschreibung

Long-Form-Articles erhalten am Anfang des Markdown-Contents einen
Header-Block, der WP-Autor*in und Quelle sichtbar macht:

```markdown
> Erstellt von: [Corinna Ullmann](https://relilab.org/author/colibri/)
> Veröffentlicht auf [relilab.org](https://relilab.org/lernmodul-test/)

(eigentlicher Content folgt …)
```

Solange keine eigenen Autoren-npubs existieren, signiert der Bot-npub. Die
Zuschreibung im Text bleibt sichtbar und kann später durch echte
pubkey-Zuordnung ersetzt werden.

## Projektstruktur

```
wp-to-nostr/
├── wp-to-nostr.ts              # Haupt-Sync-Script
├── inspect-mapping.ts          # Debug: einzelnen Post inspizieren
├── cleanup-relay.ts            # NIP-09: alle Events vom Relay löschen
├── deno.json                   # Tasks & Import-Map
├── .github/workflows/sync.yml  # GitHub Actions Workflow
├── docs/
│   └── nostr-kind-31923.md     # NIP-52 Mapping-Dokumentation
├── LICENSE
└── README.md
```

## Mapping-Übersicht

| WordPress                           | → Nostr kind:31923                   |
|--------------------------------------|--------------------------------------|
| `post.link`                          | `d`-Tag + `r`-Tag                   |
| `title.rendered`                     | `title`-Tag                         |
| `acf.relilab_startdate`             | `start`-Tag (UTC Unix-Timestamp)    |
| `acf.relilab_enddate`               | `end`-Tag (UTC Unix-Timestamp)      |
| *(fest: Europe/Berlin)*              | `start_tzid` / `end_tzid`           |
| `excerpt.rendered`                   | `summary`-Tag (Markdown)            |
| `content.rendered`                   | `content` (Markdown)                |
| `acf.relilab_custom_zoom_link`      | `location`-Tag                      |
| `featured_image_urls_v2.thumbnail`   | `image`-Tag                         |
| `taxonomy_info.post_tag[].label`     | `t`-Tags                            |
| `modified_gmt`                       | `created_at` (Relay-Deduplizierung) |

### Relay-Deduplizierung via `created_at`

`created_at` wird auf den `modified_gmt`-Wert aus WordPress gesetzt (Unix-Timestamp).
Da kind:31923 ein adressierbares ersetzbares Event ist (NIP-33), gilt:

- **Post unverändert** → `modified_gmt` gleich → `created_at` gleich → Relay ignoriert das Event
- **Post bearbeitet** → `modified_gmt` steigt → `created_at` höher → Relay ersetzt das Event

Für sehr alte Posts (deren `modified_gmt` vor 2025 liegt) greift ein fester Floor-Wert
(`2025-01-01T00:00:00Z`), da viele Relays Events mit zu altem `created_at` ablehnen.

Detaillierte Spezifikation: [docs/nostr-kind-31923.md](docs/nostr-kind-31923.md)

## Anpassen für andere WordPress-Instanzen

1. `WP_API_URL` auf deinen Endpunkt setzen
2. `WP_CATEGORY` anpassen (oder Parameter entfernen)
3. ACF-Feldnamen in `mapPostToNostrEvent()` an dein Schema anpassen
4. Zeitzone in `wpDateToUnix()` und den `_tzid`-Tags ändern falls nötig

## Lizenz

[MIT](LICENSE)
