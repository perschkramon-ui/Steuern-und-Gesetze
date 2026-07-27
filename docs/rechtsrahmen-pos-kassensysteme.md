# Rechtsrahmen POS-/Kassensysteme (Deutschland + EU)

Kuratierte Landkarte aller **offiziellen** Gesetze, Verordnungen und amtlichen
Konkretisierungen, die für elektronische Kassen-/POS-Systeme gelten. Recherche
2026-07-23 (gegen das eigene Register + amtliche Quellen verprobt). Kein
Rechtsrat – Quellenauskunft; im Zweifel StB/Fachanwalt.

Spalte **Register**: ✓ = im durchsuchbaren Register vorhanden (Volltext),
❌ = bewusst nicht ingestiert (s. Fußnoten).

## A. Kern – Kassenführung & Manipulationsschutz (AO + Verordnungen)

| Norm | Inhalt für POS | Register |
|---|---|---|
| **Kassengesetz 2016** – Gesetz zum Schutz vor Manipulationen an digitalen Grundaufzeichnungen (22.12.2016, BGBl. I S. 3152) | Artikelgesetz, führte § 146a AO ein | Kontext (AEAO) |
| **§ 146 AO** | Einzelaufzeichnungspflicht, Kassensturzfähigkeit, tägliche Kassenberichte | ✓ |
| **§ 146a AO** | Pflicht zur **zertifizierten technischen Sicherheitseinrichtung (TSE)**, Belegausgabepflicht, Mitteilungspflicht (Abs. 4) | ✓ |
| **§ 146b AO** | **Kassen-Nachschau** (unangekündigt, außerhalb Außenprüfung) | ✓ |
| **§ 147 AO** | Aufbewahrung 10 Jahre, Datenzugriff Z1/Z2/Z3 | ✓ |
| **§ 379 AO** | Bußgeld (Steuergefährdung) bei Verstößen gegen § 146a – bis 25.000 € | ✓ |
| **§§ 145, 143, 144 AO** | Allgemeine Anforderungen an Buchführung; Aufzeichnung Warenein-/-ausgang | ✓ |
| **KassenSichV** (Kassensicherungsverordnung) | Konkretisiert § 146a: betroffene Systeme (§ 1), Anforderungen an die TSE mit Verweis auf die BSI-TR (§ 5), **Belegpflichtangaben (§ 6)**, DSFinV-K-Verweis (§ 4), Taxameter/Wegstreckenzähler (§ 8/§ 10) | ✓ |

## B. Amtliche Konkretisierung (untergesetzlich / technisch)

| Quelle | Inhalt | Register |
|---|---|---|
| **AEAO zu § 146a** (BMF-Anwendungserlass zur AO) | Verbindliche Verwaltungsauslegung: Belegausgabe, TSE-Ausfall-Dokumentation, Befreiungen | ✓ (AO-Handbuch + BZSt) |
| **DSFinV-K** – Digitale Schnittstelle der Finanzverwaltung für Kassensysteme (BZSt), aktuell **Version 2.5** (2026) | Einheitliches Datensatz-/Exportformat für Kassen-Nachschau/Außenprüfung (Z3). Rechtsgrundlage § 4 KassenSichV i.V.m. § 146a Abs. 1 S. 4 AO | ✓ (BZSt, Stand v2.4 – **v2.5-Update ausstehend**) |
| **DSFinV-TW** – analog für Taxameter/Wegstreckenzähler (BZSt) | Datensatzbeschreibung Taxameter | ✓ (BZSt) |
| **GoBD** (BMF-Schreiben) – Grundsätze zur ordnungsmäßigen Führung/Aufbewahrung von Büchern in elektronischer Form sowie zum Datenzugriff | Ordnungsmäßigkeit der DV-Buchführung, Unveränderbarkeit, Verfahrensdokumentation | ✓ (BMF-Schreiben-Korpus) |
| **BSI TR-03153** (+ **TR-03151** Secure-Element-API, **TR-03116-5** Krypto) | Die konkreten **technischen Anforderungen an die TSE** (auf die § 5 KassenSichV verweist) | ❌ ¹ |

## C. Beleg & Umsatzsteuer

| Norm | Inhalt | Register |
|---|---|---|
| **§ 6 KassenSichV** | Pflichtangaben auf dem (Kassen-)Beleg | ✓ |
| **§ 14 UStG** / **§ 33 UStDV** | Rechnung / Kleinbetragsrechnung | ✓ |
| **§ 14b UStG** | Aufbewahrung von Rechnungen | ✓ |
| **§ 22 UStG** | Aufzeichnungspflichten für die Umsatzsteuer | ✓ |

## D. Handelsrecht & angrenzende Pflichten

| Norm | Inhalt | Register |
|---|---|---|
| **§§ 238, 239, 257 HGB** | Buchführungs- und Aufbewahrungspflicht der Kaufleute | ✓ |
| **PAngV** (Preisangabenverordnung) | Preisauszeichnung (Verkaufs-/Grundpreis) | ✓ |
| **DSGVO** (VO (EU) 2016/679) / **BDSG** | Kundenkartei/Stammgäste, Auftragsverarbeitung, Betroffenenrechte | DSGVO ✓ ² · BDSG ✓ |
| **ZAG** (Zahlungsdiensteaufsichtsgesetz) | Nur falls eigener Zahlungsdienst – bei durchgeleiteter Kartenzahlung (Geld → Betriebskonto) i.d.R. NICHT einschlägig | ✓ |
| **MessEG / MessEV** (Eichrecht) | Nur bei Waagen an der Kasse | ✓ |

## E. Verfahren: Mitteilungspflicht § 146a Abs. 4 AO

Seit **01.01.2025** sind elektronische Aufzeichnungssysteme (Kassen) dem
Finanzamt **über ELSTER** zu melden (Anschaffung/Außerbetriebnahme):
- Bestandssysteme (vor 01.07.2025 angeschafft): Meldung bis **31.07.2025**.
- Ab 01.07.2025 angeschaffte/außer Betrieb genommene Systeme: **binnen 1 Monat**.
- Anzugeben u. a.: Art des Systems, Anzahl je Betriebsstätte, **Seriennummer**,
  Art der TSE, Anschaffungs-/Außerbetriebnahmedatum.

## F. EU-Ebene (mittelbar relevant)

| Rechtsakt | Bezug | Register |
|---|---|---|
| **MwStSystRL 2006/112/EG** + MwSt-DVO 282/2011 | EU-Grundlage der Umsatzsteuer | ✓ |
| **E-Rechnungs-RL 2014/55/EU** (Norm EN 16931) | Grundlage strukturierter E-Rechnung | Norm referenziert ³ |
| **DSGVO, ePrivacy, Verbraucherrechte-RL, Preisangaben-RL, UGP-RL, GPSR, PSD2, AI Act** | Datenschutz/Verbraucher/Zahlung/KI rund um die Kasse | ✓ ² |

---

### Fußnoten / Lücken & Stand

**¹ BSI TR-03153 / TR-03151 / TR-03116-5 – bewusst NICHT ingestiert (nur
verlinkt).** Die BSI-Nutzungsbedingungen erlauben die freie Nutzung nur für
**nicht-kommerzielle** Zwecke; eine **kommerzielle** Verwendung bedarf einer
Lizenzvereinbarung mit dem BSI, und die Inhalte dürfen **nur unverändert**
verwendet werden (ein Volltext-/Chunk-Index wäre eine Bearbeitung). Nach
Repo-Regel 3 (im Zweifel nicht übernehmen, nur verlinken – Präzedenz
smartsteuer) wird der BSI-TR-Volltext daher **nicht** ins Register
aufgenommen. Amtliche Fundstelle:
<https://www.bsi.bund.de/DE/Themen/Unternehmen-und-Organisationen/Standards-und-Zertifizierung/Technische-Richtlinien/TR-nach-Thema-sortiert/tr03153/tr03153_node.html>
(robots.txt des BSI erlaubt den Abruf; der Blocker ist die kommerzielle
Lizenzlage, nicht robots). Eine Volltext-Aufnahme wäre nur mit BSI-Lizenz
zulässig.

**² DSGVO & weitere EU-Rechtsakte:** per `crawler/fetch-eu-recht.mjs`
ergänzt (2026-07-23); live im Register nach dem nächsten Voll-Rebuild.

**³ E-Rechnungs-RL 2014/55/EU:** über EUR-Lex/CELLAR nur ohne abrufbare
konsolidierte Fassung (404) – daher (noch) nicht als Volltext ingestiert; die
maßgebliche Norm EN 16931 ist ohnehin eine (kostenpflichtige) DIN/CEN-Norm
außerhalb des amtlichen Korpus.

**Aktualität:** § 146a/§ 146b/§ 147 AO Stand 10.02.2026; KassenSichV Stand
14.01.2026; DSFinV-K amtlich v2.5 (Register: v2.4 – Update ausstehend).

### Quellen (amtlich)
- § 146a AO – https://www.gesetze-im-internet.de/ao_1977/__146a.html
- § 146b AO – https://www.gesetze-im-internet.de/ao_1977/__146b.html
- § 147 AO – https://www.gesetze-im-internet.de/ao_1977/__147.html
- KassenSichV – https://www.gesetze-im-internet.de/kassensichv/
- DSFinV-K (BZSt) – https://www.bzst.de/DE/Unternehmen/Aussenpruefungen/DigitaleSchnittstelleFinV/digitaleschnittstellefinv_node.html
- BSI TR-03153 – https://www.bsi.bund.de/DE/Themen/Unternehmen-und-Organisationen/Standards-und-Zertifizierung/Technische-Richtlinien/TR-nach-Thema-sortiert/tr03153/tr03153_node.html
- Mitteilungspflicht § 146a Abs. 4 AO (ELSTER) – https://www.elster.de/eportal/formulare-leistungen/alleformulare/aufzeichnung146a
