# strfry: Delete-Events entfernen (Relay-Admin)

## Problem

strfry speichert NIP-09 Delete-Events (kind:5) persistent. Nach einem Cleanup per
`cleanup-relay.ts` lehnt strfry Neu-Publikationen für die gelöschten Adressen ab:

```
❌ Fehler: deleted: user requested deletion
```

## Lösung

Auf dem Relay-Server die Delete-Events unseres Pubkeys entfernen:

```bash
PUBKEY="f6c14ab7add65d61cf9311a8685575c3f2de0ca540bc4ddf916f76f089f1aa43"

# 1. Prüfen wie viele Delete-Events vorhanden sind
strfry export --filter "{\"kinds\":[5],\"authors\":[\"$PUBKEY\"]}" | wc -l

# 2. Backup erstellen (Sicherheit)
strfry export > /tmp/strfry-backup-$(date +%Y%m%d).jsonl

# 3. Delete-Events entfernen
strfry export --filter "{\"kinds\":[5],\"authors\":[\"$PUBKEY\"]}" | while read -r line; do
  id=$(echo "$line" | jq -r '.id')
  strfry delete --filter "{\"ids\":[\"$id\"]}"
done

# 4. Prüfen ob entfernt
strfry export --filter "{\"kinds\":[5],\"authors\":[\"$PUBKEY\"]}" | wc -l
```

Danach kann der Sync (`deno task start`) alle Events wieder sauber publizieren.

## Empfehlung

Statt `cleanup-relay.ts` (NIP-09) für einen Neuaufbau zu verwenden, ist es bei
strfry einfacher, die Events direkt auf dem Server zu entfernen:

```bash
# Alle kind:31923 Events unseres Pubkeys löschen (statt NIP-09)
strfry export --filter "{\"kinds\":[31923],\"authors\":[\"$PUBKEY\"]}" | while read -r line; do
  id=$(echo "$line" | jq -r '.id')
  strfry delete --filter "{\"ids\":[\"$id\"]}"
done
```
