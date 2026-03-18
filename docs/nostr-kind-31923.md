# Nostr kind:31923 – Time-Based Calendar Event (NIP-52)

## Überblick

**kind:31923** ist ein *adressierbares* (replaceable) Nostr-Event für zeitbasierte
Kalendereinträge, definiert in [NIP-52](https://github.com/nostr-protocol/nips/blob/master/52.md).

- **Adressierbar** = Der `d`-Tag bildet zusammen mit `kind` und `pubkey` eine
  eindeutige Adresse. Ein neueres Event (höherer `created_at`) mit derselben
  Adresse **ersetzt** das ältere auf dem Relay.
- **Nicht zu verwechseln** mit kind:31924 (Calendar) oder kind:31925 (Calendar
  Event RSVP, welches `status`-Tags wie `accepted`/`declined`/`tentative` kennt).

## Tag-Referenz

| Tag          | Pflicht | Beschreibung                                             |
|--------------|---------|----------------------------------------------------------|
| `d`          | ✅      | Eindeutiger Bezeichner (hier: WordPress-Permalink-URL)   |
| `title`      | ✅      | Titel des Termins                                        |
| `start`      | ✅      | Beginn als Unix-Timestamp (Sekunden)                     |
| `start_tzid` | –       | IANA-Zeitzone des Starts (z. B. `Europe/Berlin`)         |
| `end`        | –       | Ende als Unix-Timestamp (Sekunden)                       |
| `end_tzid`   | –       | IANA-Zeitzone des Endes                                  |
| `summary`    | –       | Kurzbeschreibung (Markdown)                              |
| `location`   | –       | Ort oder Online-Link (z. B. `Zoom: https://…`)          |
| `image`      | –       | URL eines Vorschaubilds                                  |
| `r`          | –       | Referenz-URL (hier: WordPress-Permalink)                 |
| `t`          | –       | Schlagwort / Tag (mehrfach möglich)                      |

### Felder im Event-Body

| Feld         | Beschreibung                                              |
|--------------|-----------------------------------------------------------|
| `kind`       | `31923`                                                   |
| `created_at` | Unix-Timestamp aus `modified_gmt` (Relay-Deduplizierung, siehe unten) |
| `content`    | Langbeschreibung als Markdown (aus WP `content.rendered`) |

## Mapping: WordPress → Nostr

| WordPress-Feld                       | Nostr-Ziel                         |
|--------------------------------------|-------------------------------------|
| `post.link` (Permalink-URL)          | `d`-Tag + `r`-Tag                  |
| `title.rendered`                     | `title`-Tag (HTML-Entities decoded) |
| `acf.relilab_startdate`             | `start`-Tag (Unix-TS, TZ-korrigiert)|
| *(fest)*                             | `start_tzid`: `Europe/Berlin`      |
| `acf.relilab_enddate`               | `end`-Tag (Unix-TS, TZ-korrigiert) |
| *(fest)*                             | `end_tzid`: `Europe/Berlin`        |
| `excerpt.rendered`                   | `summary`-Tag (HTML → Markdown)    |
| `content.rendered`                   | `content` (HTML → Markdown)        |
| `acf.relilab_custom_zoom_link`      | `location`-Tag (`Zoom: URL`)       |
| `featured_image_urls_v2.thumbnail[0]`| `image`-Tag                        |
| `taxonomy_info.post_tag[].label`     | je ein `t`-Tag                     |
| `modified_gmt`                       | `created_at` (Relay-Deduplizierung) |

## Zeitzonenkonvertierung

WordPress speichert Datumsangaben als Berliner Lokalzeit ohne Zeitzonen-Suffix
(`"2026-03-13 16:00:00"`). Die Konvertierung nutzt `Intl.DateTimeFormat` um den
aktuellen UTC-Offset für `Europe/Berlin` zu berechnen (CET = UTC+1, CEST = UTC+2)
und den korrekten Unix-Timestamp zu erzeugen.

**Beispiel (CET/Winterzeit):**
```
WP-Datum:     "2026-03-13 16:00:00"  (= 16:00 Berlin, CET)
UTC-Offset:   +1h
Unix-TS:      1773414000  = 2026-03-13T15:00:00Z  (= 16:00 Berlin ✓)
```

## Relay-Deduplizierung via `created_at`

`created_at` wird auf den Unix-Timestamp von `modified_gmt` aus WordPress gesetzt.
Da kind:31923 ein adressierbares ersetzbares Event ist (NIP-33, kind 30000–39999),
vergleicht das Relay bei gleichem `d`-Tag + `pubkey` + `kind` den `created_at`-Wert:

- `created_at` ≤ vorhandenes Event → Relay ignoriert (hat schon neuere Version)
- `created_at` > vorhandenes Event → Relay ersetzt

Damit werden bei jedem Sync nur tatsächlich geänderte WordPress-Posts neu auf das
Relay geschrieben. Für Posts mit `modified_gmt` vor 2025 greift ein fester
Floor-Wert (`2025-01-01T00:00:00Z` = `1735689600`), da viele Relays Events mit
zu altem `created_at` ablehnen (`created_at too early`).

## Beispiel-Event (JSON)

```json
{
  "kind": 31923,
  "created_at": 1742300000,
  "tags": [
    ["d",          "https://relilab.org/beispiel-termin/"],
    ["title",      "relilab Impuls: Beispieltermin"],
    ["start",      "1773414000"],
    ["start_tzid", "Europe/Berlin"],
    ["end",        "1773421200"],
    ["end_tzid",   "Europe/Berlin"],
    ["summary",    "Ein Beispieltermin für die Dokumentation."],
    ["location",   "Zoom: https://zoom.us/j/123456789"],
    ["image",      "https://relilab.org/wp-content/uploads/bild.jpg"],
    ["r",          "https://relilab.org/beispiel-termin/"],
    ["t",          "Grundschule"],
    ["t",          "Religion"]
  ],
  "content": "# Beispieltermin\n\nAusführliche Beschreibung in Markdown …"
}
```
