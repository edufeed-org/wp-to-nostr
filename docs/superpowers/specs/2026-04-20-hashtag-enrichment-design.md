# Hashtag-Anreicherung für Nostr-Kalenderevents

**Datum:** 2026-04-20
**Status:** Implementiert (siehe `docs/superpowers/plans/2026-05-05-tag-enrichment.md`).
**Update 2026-05-05:** Default-Pattern angepasst — `relilab` lebt jetzt im
Workflow (`sync.yml`), Code-Default ist leer. Begründung und Begleitspec
siehe [`2026-05-05-community-h-tag-design.md`](2026-05-05-community-h-tag-design.md).
Damit ist auch die offene Frage „Community-Kopplung (NIP-72)" gelöst —
über die Communikey-Spec, nicht über NIP-72 (siehe Begleitspec).

## Ziel

Alle von `wp-to-nostr.ts` erzeugten Nostr-Events (kind:31923) sollen um einen
oder mehrere konfigurierbare Hashtags (`t`-Tags) angereichert werden, sofern
diese noch nicht aus den WordPress-Tags übernommen wurden. Für diesen Bot ist
der Default-Hashtag `relilab`, aber die Mechanik ist bewusst so gebaut, dass
das Skript als Blaupause für weitere Deployments mit anderen Hashtags dient.

## Scope

### In Scope

- Einführung einer Env-Variable `EXTRA_HASHTAGS`.
- Eine reine Anreicherungsfunktion, die bestehende `t`-Tags um konfigurierte
  Hashtags ergänzt (case-insensitive Deduplizierung).
- Integration in `mapPostToNostrEvent`.
- Unit-Tests unter `tests/`.
- Dokumentation in `README.md`, `.env.example` und
  `docs/nostr-kind-31923.md`.

### Out of Scope (aufgeschoben, siehe „Offene Fragen")

- Community-Kopplung via `a`-Tag (NIP-72, kind:34550).
- schema.org-Attribute wie `eventAttendanceMode` und `isAccessibleForFree`.
- Weitere Generalisierung der Anreicherung über Hashtags hinaus.

## Konfiguration

Neue Umgebungsvariable:

| Variable         | Pflicht | Standard (Code) | Beschreibung                                                                                                                                                  |
|------------------|---------|-----------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `EXTRA_HASHTAGS` | –       | `""`            | Komma-separierte Liste zusätzlicher Hashtags, die jedem Event als `t`-Tag hinzugefügt werden, falls noch nicht vorhanden. Leerer String → keine Anreicherung. |

Der projektspezifische Default `relilab` wird **nicht** im Code, sondern im
Workflow (`sync.yml`) als Fallback hinter einer Repo-Variable gesetzt —
analog zum Pattern bei `WP_NOSTR_RELAY` etc.:

```yaml
EXTRA_HASHTAGS: ${{ vars.WP_EXTRA_HASHTAGS || 'relilab' }}
```

Damit bleibt der Code projekt-neutral (Blaupausen-Aspekt), und Forks
können einfach eine andere Repo-Variable setzen.

### Parsing-Regeln

- Trennzeichen: Komma.
- Whitespace um jeden Eintrag wird entfernt.
- Leere Einträge werden ignoriert (z. B. `relilab,,bildung` ergibt
  `["relilab", "bildung"]`).
- Führendes `#` wird toleriert und entfernt: `#relilab` und `relilab` sind
  äquivalent.
- Leerer oder nicht gesetzter Wert → leere Liste → Mapping bleibt
  unverändert.

### Blaupausen-Aspekt

Der Default-Wert `relilab` ist projektspezifisch für den relilab-Termine-Bot,
aber jede Instanziierung dieses Repos (oder Fork) kann über die Env-Variable
einen eigenen Default setzen. Die Mechanik selbst bleibt generisch.

## Anreicherungs-Logik

### Signatur

```ts
function mergeExtraHashtags(tags: string[][], extras: string[]): string[][]
```

### Verhalten

- Baut ein `Set<string>` aus allen bestehenden `t`-Tag-Werten, jeweils per
  `toLowerCase()` normalisiert.
- Iteriert über `extras`; für jeden Eintrag wird `extra.toLowerCase()` mit
  dem Set abgeglichen.
- Ist der normalisierte Wert bereits vorhanden: Tags bleiben unverändert
  (bestehende Schreibweise bleibt erhalten — `Relilab` aus WordPress wird
  nicht durch `relilab` aus der Config ersetzt).
- Ist der normalisierte Wert nicht vorhanden: `["t", extra]` wird an die
  Rückgabe angehängt. Der Originalwert aus der Config (ohne `#`, aber in
  der dort festgelegten Schreibweise) wird verwendet.
- Die Funktion ist rein: sie mutiert ihren Input nicht, sondern gibt ein
  neues Tags-Array zurück.

### Integration

Aufruf in `mapPostToNostrEvent` am Ende, unmittelbar vor dem `return`. Die
Konfiguration wird einmalig beim Script-Start aus `Deno.env` gelesen und als
Modul-Konstante an die Funktion übergeben. Dadurch bleibt der Datenfluss
nachvollziehbar und die Funktion selbst unabhängig von Env-Lookups testbar.

Der Shebang in `wp-to-nostr.ts` nutzt eine explizite Env-Allowlist
(`--allow-env=…`). `EXTRA_HASHTAGS` muss dort ergänzt werden, sonst scheitert
der `Deno.env.get`-Zugriff zur Laufzeit. Gleiches gilt für `inspect-mapping.ts`
und `cleanup-relay.ts`, sofern sie die Mapping-Funktion ebenfalls nutzen.

## Tests

Neues Testmodul `tests/hashtag-enrichment.test.ts` mit `Deno.test`:

- Hashtag wird hinzugefügt, wenn in bestehenden `t`-Tags nicht vorhanden.
- Hashtag wird nicht dupliziert, wenn in exakt gleicher Schreibweise schon
  da.
- Hashtag wird nicht dupliziert bei abweichender Groß-/Kleinschreibung
  (`Relilab` im Event blockiert `relilab` aus der Config).
- Mehrere Extras: alle fehlenden werden angehängt, bestehende nicht
  dupliziert.
- Leere Konfig (`[]`) → Tags unverändert zurückgegeben.
- `#relilab`-Notation in der Config wird wie `relilab` behandelt.
- Funktion mutiert den übergebenen Tags-Input nicht (Referenzvergleich).

Die Funktion `mergeExtraHashtags` muss exportierbar sein, damit sie isoliert
testbar ist. Die Env-Parsing-Logik wird ebenfalls als eigene exportierte
Funktion (`parseExtraHashtags(raw: string): string[]`) gebaut und
separat getestet.

## Dokumentation

### `.env.example` (neu)

Im Repo-Root anlegen. Enthält **alle** Env-Variablen (nicht nur die neue),
damit die Datei als Blaupause für Forks dient. Sensible Werte
(`NOSTR_PRIVATE_KEY`) werden mit Platzhaltern gezeigt und klar als
Pflichtfeld im Live-Modus markiert.

### `README.md`

- Zeile in der Env-Tabelle für `EXTRA_HASHTAGS`.
- Kurzer Abschnitt „Hashtag-Anreicherung" mit Hinweis auf
  Case-Insensitivität und Blaupausen-Nutzung.

### `docs/nostr-kind-31923.md`

- Im Mapping-Abschnitt eine Anmerkung, dass zusätzlich zu den aus
  WordPress-Tags abgeleiteten `t`-Tags weitere Hashtags per Konfig injiziert
  werden können.

## Offene Fragen für künftige Entwicklungen

Im Rahmen der Anforderungsklärung kamen drei weitere Wünsche auf, die
bewusst **nicht** Teil dieser Änderung sind, weil die Zielsemantik noch
nicht abschließend geklärt ist. Sie werden hier dokumentiert, damit spätere
Iterationen darauf aufbauen können.

### Community-Kopplung (NIP-72)

**Status (Update 2026-05-05): Gelöst.** Die Community-Zuordnung wurde im
Begleitspec [`2026-05-05-community-h-tag-design.md`](2026-05-05-community-h-tag-design.md)
spezifiziert — allerdings **nicht** über NIP-72 (`a`-Tag, kind:34550,
Mod-Approval), sondern über die **Communikey-Spec** (`h`-Tag, kind:10222,
Community = Pubkey). Der untenstehende Abschnitt bleibt als
Entscheidungs-Historie erhalten.

**Wunsch (ursprünglich):** Events sollen automatisch der relilab-Community
(auf edufeed.org, Owner-Pubkey
`npub1fpcxaz2wvjl90gjs60x37ny2pa5u4yqfx7fklz73rgfjnnfujl3sr2fxgk` =
`48706e894e64be57a250d3cd1f4c8a0f69ca900937936f8bd11a1329cd3c97e3`)
zugeordnet werden.

**Ungeklärt:**

- Auf den geprüften Relays (`relay-rpi.edufeed.org`, `relay.damus.io`,
  `nos.lol`, Stand 2026-04-20) existiert *keine* kind:34550-Definition von
  diesem Pubkey. Der `d`-Identifier der Community ist deshalb unbekannt.
- Die bestehenden Events im relay-rpi (vom selben Pubkey, Client-Tag
  `wp2nostr` — offenbar eine ältere Version dieses Bots) enthalten
  **weder** einen `a`-Tag noch einen `t`-Tag `relilab`. Sie erscheinen
  dennoch im edufeed.org-Community-View. Vermutung: edufeed.org erkennt
  Community-Zugehörigkeit über den Author-Pubkey, nicht über explizite
  Tags.
- NIP-72 selbst spezifiziert den `a`-Tag-Mechanismus eigentlich nur für
  kind:1-Posts; für kind:31923 ist die Verknüpfung Konvention.

**Drei Handlungsoptionen, wenn das geklärt wird:**

- **A)** Konkreten `a`-Tag-Wert `34550:<hex>:<slug>` als Env-Variable
  (`COMMUNITY_A_TAG` o. ä.) konfigurierbar machen. Erfordert, dass der
  `d`-Identifier bekannt ist oder eine kind:34550-Definition angelegt wird.
- **B)** Keine explizite Tag-Koppelung, Zugehörigkeit läuft allein über
  den geteilten Author-Pubkey. Keine Code-Änderung nötig.
- **C)** Generisches Tag-Enrichment-Framework mit optional leerem
  `a`-Tag-Slot — der Blaupausen-Aspekt bleibt, auch wenn für relilab
  zunächst nichts gesetzt wird.

### schema.org-Attribute: `isAccessibleForFree` und `eventAttendanceMode`

**Wunsch:** Alle Events sollen automatisch
`isAccessibleForFree=true` und `eventAttendanceMode=online` erhalten.
Diese Defaults sollen ebenfalls über Env-Variablen konfigurierbar sein.

**Ungeklärt:** Die Tag-Form für diese schema.org-Attribute ist in NIP-52
nicht definiert. Drei Varianten stehen zur Wahl:

- **a)** Generische Tags mit schema.org-Namen:
  `["isAccessibleForFree", "true"]`, `["eventAttendanceMode", "online"]`.
- **b)** NIP-32 Label-Tags mit Namespace:
  `["L", "schema.org"]`, `["l", "isAccessibleForFree:true", "schema.org"]`
  — semantisch sauberer, aber verbose.
- **c)** Das Format, das edufeed.org tatsächlich konsumiert — aktuell
  unbekannt.

Vor Implementierung muss geklärt werden, welches Format das Zielrelay
bzw. die Ziel-Clients tatsächlich auswerten. Sonst werden Tags gesetzt,
die niemand liest.

### Generalisierung der Anreicherung

Falls sowohl Community-Kopplung als auch schema.org-Attribute umgesetzt
werden, lohnt sich eine gemeinsame Abstraktion: eine einzige
„Enrichment-Pipeline", konfigurierbar über eine strukturierte Umgebung
(z. B. eine Liste statischer Tags in einer Env-Variable oder einer
separaten Config-Datei). Für die jetzige Iteration ist diese
Abstraktion bewusst **nicht** vorgesehen (YAGNI) — `mergeExtraHashtags`
reicht für den aktuellen Bedarf.

## Rollout

- Kein Breaking Change: `EXTRA_HASHTAGS` hat einen Default, bestehende
  Env-Konfiguration bleibt funktional.
- GitHub-Action: optional `EXTRA_HASHTAGS` als Repository-Variable
  überschreibbar, Default `relilab` wird sonst verwendet.
- Nach Deployment: erster Live-Sync anreichert alle Events um den
  fehlenden `t`-Tag. Da `created_at` weiterhin aus `modified_gmt` kommt
  und unveränderte Posts dieselben `created_at` behalten, werden Events
  **nicht** automatisch neu geschrieben, solange in WordPress nichts
  geändert wurde. Relevant: Neue und in WordPress bearbeitete Events
  erhalten den neuen `t`-Tag sofort, Altbestand erst bei nächster
  Post-Änderung. Falls ein vollständiger Rewrite aller Events gewünscht
  ist, müsste einmalig das Cleanup-Tool + Re-Sync laufen (siehe
  bestehende Doku zu strfry).
