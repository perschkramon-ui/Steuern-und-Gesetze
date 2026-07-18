# TODO (nächste Cloud-Session): Wochen-Routine neu anlegen

> **Status: ERLEDIGT (2026-07-18, cloud).** Neue Routine angelegt und auf dieses
> Repo gerichtet:
> - Trigger: `trig_014NqLCik2p2HGgFkzX8WeUm`
>   („Wochen-Routine: Register-Neubau (update-all.mjs) → Draft-PR")
> - Zeitplan: `30 3 * * 1` = **Montag 03:30 UTC**, wöchentlich (nächster Lauf
>   2026-07-20). Jeder Lauf startet eine **frische** Cloud-Session in der
>   Umgebung `env_01Lq86KA4DUq3nhDDThkgFEf`, führt `update-all.mjs` aus (mit
>   `NODE_USE_ENV_PROXY=1` + `NODE_OPTIONS=6144`), prüft `meta.counts` gegen die
>   Referenz unten und legt bei Erfolg einen Draft-PR an. Push-Benachrichtigung
>   an den Betreiber ist aktiv.
> - Verwalten (pausieren/löschen/Zeitplan ändern): über die claude.ai-Routinen-
>   UI oder die `*_trigger`-Werkzeuge des Claude-Code-Remote-Connectors.
>
> Historie: Die alte Routine (im Kassensystem-Repo, Trigger
> `trig_016ZSxgVQHK48zR28MJ3EBRL`) wurde beim Repo-Umzug gelöscht; die neue
> zeigt auf **dieses** Repo. Der Abschnitt unten bleibt als Referenz für den
> Routine-Lauf (und für einen manuellen Neu-Lauf) stehen.

## Was die Routine tun soll

Wöchentlich das Register frisch bauen und die Änderungen als Draft-PR vorlegen:

1. Frische Cloud-Session im Repo `perschkramon-ui/Steuern-und-Gesetze`
   (`git clone` / auf `origin/main`).
2. Ausführen (aus dem Repo-Root):
   ```bash
   NODE_USE_ENV_PROXY=1 NODE_OPTIONS=--max-old-space-size=6144 \
     node crawler/update-all.mjs
   ```
   (`NODE_USE_ENV_PROXY=1` ist in der Cloud Pflicht – node-fetch nutzt den
   Sandbox-Proxy sonst nicht. `--pdfjs` nur nötig, wenn pdfjs-dist nicht unter
   `../node_modules/pdfjs-dist` liegt.)
3. **Erfolgskontrolle (Pflicht):** `meta.counts` dürfen NICHT sinken
   (Referenz nach dem Vollausbau 2026-07-18: gesetzeIndex 6123 · seiten 8908 ·
   pdfs 7424 · korpusChunks 917943 · urteile 83497). Sinkt ein Wert → NICHT
   committen, Ursache klären.
   ```bash
   node -e "console.log(JSON.parse(require('fs').readFileSync('data/register.json','utf8')).meta.counts)"
   ```
4. `data/`-Artefakte committen (Branch + Draft-PR mit den Änderungszahlen aus
   `data/changelog.json`). Der Betreiber merged.

## Zeitplan

**Montag 03:30 UTC**, wöchentlich (wie die alte Routine).

## Kritische Punkte aus dem Vollausbau (2026-07-18) – unbedingt beachten

- **`update-all.mjs` ist der EINZIGE Bau-Weg.** Schritt 0 rekonstruiert
  fehlende Bestands-Caches (bmf/bmjv + **die 7 Handbücher** + Ausbau-Quellen
  bzst/vwv/eu/rii) aus dem committeten `data/`. Ein Hand-Build mit Teil-
  Quellenliste würde das Register STILL ausweiden. Die **Radware-geschützten
  BMF-Handbücher kann die Cloud NICHT crawlen** – sie überleben AUSSCHLIESSLICH
  über diesen Restore. Nie umgehen.
- **Speicher:** Der Korpus hat **~918k Chunks** (83k Urteile + alle Normen).
  Der Register-Bau (`build-register`) lief lokal mit `--max-old-space-size=6144`
  durch; in der Cloud denselben Wert setzen. Falls die Sandbox weniger RAM hat
  und der Bau OOMt: höher setzen oder mit dem Betreiber klären.
- **BMF-Refresh (Schritt 3) kann aus der Cloud an Radware scheitern.** Falls
  `update-all` daran hart abbricht: mit `--skip-bmf true` erneut laufen (BMF-
  Bestand kommt dann aus dem Restore; es fehlen nur brandneue BMF-Schreiben).
- **Handbuch-Erinnerung:** `update-all` warnt am Ende laut, wenn ein
  Handbuch-Crawl älter als 350 Tage ist (`data/handbuch-stand.json`). Diese
  Warnung in den PR-Text übernehmen → der Betreiber stößt dann die LOKALE
  Handbuch-Crawl-Session an (`docs/AUFTRAG-lokale-session.md`).

## Railway (Deploy nach Merge) – bereits eingerichtet, nur zur Info

- Service: Projekt `distinguished-education`, Service **„Steuern und Gesetze"**,
  Domain `steuernundgesetze.up.railway.app`, Quelle = `Steuern-und-Gesetze@main`.
- Gesetzt: `NODE_OPTIONS=--max-old-space-size=6144` **und
  `KI_CORPUS_SCOPE=steuern`** (244k Chunks – der 8-GB-Hobby-Plan kann
  `scope=alles`/918k NICHT booten; der volle Stand bleibt im Repo/Offline-Bundle).
- Jeder Merge nach `main` löst automatisch einen Deploy aus → danach
  `/api/health` prüfen (Boot 2–4 Min).

## Anlegen

Als Cloud-Session per Scheduling-Werkzeug (geplanter Cloud-Agent / Routine)
mit obigem Zeitplan und obiger Aufgabe. Nach dem Anlegen: diese Datei auf
ERLEDIGT setzen und eine `docs/SESSION-LOG.md`-Zeile ergänzen.
