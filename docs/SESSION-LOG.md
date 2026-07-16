# SESSION-LOG (steuern-und-gesetze)

Eine Zeile je Session (Datum · cloud/lokal · was getan · PR). Neueste oben.

---

- 2026-07-16 · cloud · REPO-UMZUG (Betreiber: „das müssen wir besser trennen … hier die Gesetze-Session"): aus perschkramon-ui/Kassensystem (Ordner steuerberater-ki/, Stand 9353449) herausgelöst, bewusst OHNE Git-Historie (alte Daten-Revisionen = hunderte MB Ballast; Historie bleibt im Kassen-Repo). Neues CLAUDE.md mit Trennungs-Regeln, railway.json auf Root-Start umgestellt (node server/server.mjs), Auftrags-MD → docs/AUFTRAG-lokale-session.md (Pfade angepasst). OFFEN nach dem Umzug: (1) Railway-Service steuernundgesetze auf dieses Repo umhängen (Settings→Source; Config-Pfad railway.json), (2) Wochen-Routine auf dieses Repo umziehen, (3) Kassen-Repo-Aufräum-PR (steuerberater-ki/ raus), (4) lokale Session klont dieses Repo und führt docs/AUFTRAG-lokale-session.md aus.
