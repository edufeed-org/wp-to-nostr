# Community-Zuordnung für Nostr-Kalenderevents (Communikey `h`-Tag)

**Datum:** 2026-05-05
**Status:** Implementiert (siehe `docs/superpowers/plans/2026-05-05-tag-enrichment.md`)

## Ziel

Alle von `wp-to-nostr.ts` erzeugten Nostr-Events (kind:31923) sollen einer
oder mehreren Communities zugeordnet werden, indem pro konfigurierter
Community ein `h`-Tag mit dem Hex-Pubkey der Community an das Event gehängt
wird. Für den relilab-Bot ist die Default-Community
`npub1fpcxaz2wvjl90gjs60x37ny2pa5u4yqfx7fklz73rgfjnnfujl3sr2fxgk`
(„Blüten-Balkon", relilab-org-Pubkey). Die Mechanik ist bewusst so gebaut,
dass sie als Blaupause für weitere Deployments dient.

Die Zuordnung folgt der **Communikey-Spec** (kind:10222 + `h`-Tag,
Communities = Pubkey), **nicht** NIP-72 (kind:34550 + `a`-Tag +
Mod-Approval). In der Communikey-Spec genügt das `h`-Tag mit dem
Community-Pubkey im Event; eine Approval-Runde via kind:4550 entfällt. Das
ist die offene Frage „Community-Kopplung (NIP-72)" aus dem Hashtag-Spec
vom 2026-04-20 — sie wird mit diesem Design beantwortet.

## Scope

### In Scope

- Neue Env-Variable `COMMUNITY_NPUBS`.
- Reine Funktion zum Mergen von `h`-Tags in das Event-Tags-Array.
- Auflösung npub → Hex einmalig beim Script-Start (Fail-Fast bei
  ungültigen Werten).
- Integration in `mapPostToNostrEvent`.
- Unit-Tests unter `tests/`.
- Anpassung von `sync.yml`: relilab-Default landet im Workflow, nicht im
  Code.
- **Begleitanpassung Hashtag-Spec**: Default `relilab` wandert ebenfalls
  aus dem Code in den Workflow. Damit ist das Default-Pattern für beide
  Anreicherungen einheitlich („Code projekt-neutral, Workflow trägt
  Defaults").
- Dokumentation in `README.md`, `.env.example` und
  `docs/nostr-kind-31923.md`.

### Out of Scope

- Whitelisting/Profile-List-Eintrag des Sync-npub auf `enforced`-Relays
  der Community. Annahme: das genutzte Relay ist nicht `enforced`, oder
  der Sync-npub steht ohnehin auf der relevanten Profile-List. Falls
  diese Annahme bricht, gehört das in eine separate Iteration.
- Anlegen oder Updaten des `kind 10222`-Community-Definition-Events der
  Ziel-Community (z. B. um eine Section für `k 31923` zu deklarieren).
  Das ist Aufgabe der Community-Admins, nicht des Sync-Bots.
- Generalisierung über `h`/`t`-Tags hinaus (siehe „Offene Fragen" im
  Hashtag-Spec).

## Konfiguration

Neue Umgebungsvariable:

| Variable          | Pflicht | Standard (Code) | Beschreibung                                                                                                                            |
|-------------------|---------|-----------------|-----------------------------------------------------------------------------------------------------------------------------------------|
| `COMMUNITY_NPUBS` | –       | `""`            | Komma-separierte Liste von Community-Identifiern. Jeder Eintrag ist entweder ein `npub1…` oder ein 64-stelliger Hex-Pubkey. Leer → kein `h`-Tag. |

### Eingabe-Akzeptanz

Analog zur bestehenden `resolvePrivkey()`-Logik in `wp-to-nostr.ts:66`
werden zwei Eingabeformen akzeptiert:

- **`npub1…`** (bech32) — wird via `nip19.decode` zu Hex aufgelöst.
- **64-stelliger Hex-String** (`/^[0-9a-f]{64}$/i`) — wird direkt
  übernommen, lowercase normalisiert.

### Parsing-Regeln

- Trennzeichen: Komma.
- Whitespace um jeden Eintrag wird entfernt.
- Leere Einträge werden ignoriert (z. B. `npub1abc,,npub1def` ergibt zwei
  Einträge).
- Leerer oder nicht gesetzter Wert → leere Liste → kein `h`-Tag wird
  gesetzt.
- Ungültige Eingaben (weder valides npub noch 64-Hex) → **Fail-Fast**:
  Skript wirft beim Start einen Fehler mit klarer Meldung
  (`COMMUNITY_NPUBS: ungültiger Eintrag „<wert>"`). Begründung: stilles
  Verschlucken eines Tippfehlers würde dazu führen, dass Events ohne
  Community-Zuordnung publiziert werden, ohne dass jemand es merkt.

### Defaults / Workflow-Pattern

Code-Default ist leerer String (Repo bleibt projekt-neutral, Blaupausen-
Aspekt). Der relilab-Default lebt in `sync.yml` als Fallback hinter einer
Repo-Variable, exakt wie `WP_NOSTR_RELAY` / `WP_API_URL` /
`WP_CATEGORY` heute schon (`sync.yml:34-36`):

```yaml
COMMUNITY_NPUBS: ${{ vars.WP_COMMUNITY_NPUBS || 'npub1fpcxaz2wvjl90gjs60x37ny2pa5u4yqfx7fklz73rgfjnnfujl3sr2fxgk' }}
```

Im selben Atemzug zieht der **Hashtag-Spec** nach:

```yaml
EXTRA_HASHTAGS: ${{ vars.WP_EXTRA_HASHTAGS || 'relilab' }}
```

Code-Default für `EXTRA_HASHTAGS` wird ebenfalls auf `""` umgestellt.

## Anreicherungs-Logik

### Signatur

```ts
function parseCommunityNpubs(raw: string): string[]      // → Hex-Liste
function mergeCommunityHTags(tags: string[][], hexPubkeys: string[]): string[][]
```

### Verhalten von `parseCommunityNpubs`

- Splittet auf Komma, trimmt jeden Eintrag, ignoriert leere Strings.
- Pro Eintrag:
  - Beginnt mit `npub1` → `nip19.decode`, Typ-Check (`type === "npub"`),
    Ergebnis lowercase.
  - Matcht `/^[0-9a-f]{64}$/i` → direkt lowercase übernehmen.
  - Sonst: `throw new Error(...)` mit dem fehlerhaften Eintrag im Klartext.
- Liefert Hex-Liste in Reihenfolge der Eingabe.
- Dedupliziert die Liste (case-insensitive, was nach Lowercase-Normalisierung
  trivial ist) — falls der Anwender denselben npub doppelt einträgt.

### Verhalten von `mergeCommunityHTags`

- Baut ein `Set<string>` aus allen bestehenden `h`-Tag-Werten, lowercase
  normalisiert.
- Iteriert über `hexPubkeys`; bereits enthaltene werden übersprungen,
  fehlende als `["h", hex]` an die Rückgabe gehängt.
- Reine Funktion: mutiert Input nicht, gibt neues Tags-Array zurück.

### Integration

- `parseCommunityNpubs` wird **einmalig beim Script-Start** auf `Deno.env`
  angewendet. Ergebnis (Hex-Liste) als Modul-Konstante. Damit:
  - Validierung passiert früh, nicht erst im Loop.
  - Pro Event entfällt das wiederholte bech32-Decoding.
  - Tests können die Funktion isoliert prüfen, unabhängig von Env-Lookups.
- `mergeCommunityHTags` wird in `mapPostToNostrEvent` aufgerufen,
  unmittelbar nach `mergeExtraHashtags`, vor dem `return`.

### Allow-Env-Liste

Der Shebang von `wp-to-nostr.ts` nutzt eine explizite Allowlist
(`--allow-env=…`). `COMMUNITY_NPUBS` muss dort ergänzt werden, ebenso in
`inspect-mapping.ts` und `cleanup-relay.ts`, sofern sie die
Mapping-Funktion nutzen. (Gilt analog für `EXTRA_HASHTAGS`, falls noch
nicht eingetragen.)

## Tests

Neues Testmodul `tests/community-h-tags.test.ts` mit `Deno.test`:

**`parseCommunityNpubs`:**

- Einzelner npub → korrekte Hex-Auflösung (Fixture: relilab-npub →
  `48706e894e64be57a250d3cd1f4c8a0f69ca900937936f8bd11a1329cd3c97e3`).
- Einzelner Hex-Eintrag → unverändert lowercase übernommen.
- Gemischte Liste (npub + Hex) → beide korrekt aufgelöst.
- Whitespace und leere Einträge werden ignoriert.
- Doppelter Eintrag (gleicher npub zweimal, oder npub + sein Hex) wird
  dedupliziert.
- Ungültiger Eintrag (kaputter bech32, falsche Länge) wirft mit dem
  fehlerhaften Wert in der Meldung.
- Leerer/whitespace-only Input → leere Liste, kein Throw.

**`mergeCommunityHTags`:**

- `h`-Tag wird hinzugefügt, wenn nicht vorhanden.
- Mehrere Communities → mehrere `h`-Tags in Reihenfolge.
- Bestehender `h`-Tag (z. B. aus früherem Lauf, oder manuell gesetzt) wird
  nicht dupliziert.
- Case-insensitive Vergleich gegen vorhandene `h`-Tag-Werte.
- Leere Hex-Liste → Tags unverändert zurückgegeben.
- Funktion mutiert den übergebenen Tags-Input nicht (Referenzvergleich).

Beide Funktionen werden in `wp-to-nostr.ts` exportiert, damit sie isoliert
testbar sind.

## Dokumentation

### `.env.example`

Zeile für `COMMUNITY_NPUBS` ergänzen, kurz erklärt (akzeptiert npub und
Hex, komma-separiert, leer = aus). Gleichzeitig `EXTRA_HASHTAGS`-Zeile
prüfen — Code-Default ist jetzt leer, also Beispielwert mit klarem
Kommentar setzen.

### `README.md`

- Env-Tabelle: `COMMUNITY_NPUBS` ergänzen, `EXTRA_HASHTAGS`-Default-Spalte
  korrigieren (Code: leer, Workflow-Default: `relilab`).
- Neuer kurzer Abschnitt „Community-Zuordnung (Communikey)" mit Hinweis
  auf das `h`-Tag-Pattern, Verweis auf die Communikey-Spec und Erklärung,
  dass die relilab-Defaults im Workflow leben (Blaupausen-Pattern).

### `docs/nostr-kind-31923.md`

- Anmerkung im Mapping-Abschnitt, dass zusätzlich zu den NIP-52-Tags ein
  oder mehrere `h`-Tags die Communikey-Zuordnung tragen können.
- Verweis auf die externe Communikey-Spec (kind:10222) und die Tatsache,
  dass die Auswertung clientseitig bzw. relayseitig (`enforced`) erfolgt.

### `docs/superpowers/specs/2026-04-20-hashtag-enrichment-design.md`

Begleit-Update am Hashtag-Spec:

- Status-Block ergänzen: „Default-Pattern angepasst (2026-05-05): Default
  `relilab` lebt im Workflow, Code-Default ist leer."
- Abschnitt „Konfiguration": Standard-Wert in der Tabelle auf `""`
  korrigieren, Erklärung des Workflow-Defaults nachziehen.
- Abschnitt „Offene Fragen → Community-Kopplung (NIP-72)": als
  **gelöst** markieren mit Verweis auf das vorliegende Spec-Doc; Hinweis,
  dass die Lösung nicht NIP-72, sondern die Communikey-Spec ist.

## Rollout

- **Kein Breaking Change.** `COMMUNITY_NPUBS` hat einen Default (im
  Workflow), bestehende Env-Konfiguration bleibt funktional. Ein
  privater Fork ohne Workflow-Override bekommt das relilab-`h`-Tag —
  was unerwünscht wäre, falls jemand das Repo ohne Anpassung übernimmt.
  Mitigation: README-Hinweis und `.env.example` empfehlen explizit, den
  Wert zu setzen oder `WP_COMMUNITY_NPUBS=` (leer) zu konfigurieren.
- **`created_at`-Stabilität (Altbestand-Verhalten).** Wegen des
  `MIN_CREATED_AT`-Floors in `wp-to-nostr.ts:219` und der Verwendung
  von `modified_gmt` ändert sich `created_at` nicht, solange ein
  WordPress-Post nicht erneut gespeichert wird. Das bedeutet:
  - Neue oder in WP bearbeitete Events erhalten das `h`-Tag sofort.
  - **Altbestand erhält das `h`-Tag erst, wenn der Post in WP gebumpt
    wird** — Relays ersetzen ein adressierbares Event nur bei höherem
    `created_at`.
  - Wenn alle bestehenden Events sofort umgeschrieben werden sollen
    (was der ursprüngliche Wunsch ist: „alle Termine der Community
    zuordnen"), ist ein einmaliger Cleanup + Re-Sync nötig — siehe
    bestehende `cleanup-relay.ts`-Doku. Alternativ: WP-Posts
    massenhaft re-speichern, was schwieriger ist.
- **Whitelist-Risiko.** Falls die Ziel-Community ein `enforced`-Relay
  betreibt und der Sync-npub nicht auf der Profile-List der relevanten
  Section steht, lehnt das Relay die Events ab. Das wird nicht durch
  diese Spec adressiert (Out of Scope), aber im README als bekannte
  Voraussetzung erwähnt.
- GitHub-Action: `WP_COMMUNITY_NPUBS` und `WP_EXTRA_HASHTAGS` lassen sich
  als Repository-Variablen setzen, ohne Workflow-Edit.

## Offene Fragen / Nicht-Ziele

- **Section im 10222-Event der Community.** Damit Communikey-Clients die
  Kalender-Events korrekt einer Section zuordnen, muss das
  kind:10222-Definition-Event der Community eine Section mit `k 31923`
  (und ggf. `k 31922`) deklarieren. Sollte das fehlen, erscheinen
  Events u. U. nur in „rohen" Community-Views, nicht in einer
  benannten Section. Klärung mit den Community-Admins separat.
- **`enforced`-Relay-Strategie.** Falls künftig auf `enforced`-Relays
  publiziert wird, braucht es ein Spec für den Profile-List-Eintrag
  (kind:30000) — entweder manuell durch den Community-Admin oder
  automatisiert.
