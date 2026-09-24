# Faisabilité — Télécoms (open data Arcep)

Étude du 24/09/2026. Tout ce qui suit a été vérifié par `curl` (en-têtes, listings, lecture partielle via HTTP Range) ou par le téléchargement complet de petits fichiers (Lozère 48, Paris 75, Guadeloupe 971). Ce qui n'a pas pu être vérifié est marqué **non vérifié**. Les extraits réels sont dans `samples/arcep-*`.

## TL;DR

| | V1 recommandée | Pourquoi |
|---|---|---|
| **Fibre / internet fixe** | **Commune** (+ badge « à l'adresse bientôt ») | Les données à l'immeuble existent et sont excellentes, mais une version pré-calculée compacte en JSON pèse **~1,2 Go** (mesuré à ~42 o/immeuble × ~27,8 M d'immeubles), au-dessus de la limite de 1 Go du dépôt *et* de celle de GitHub Pages. À l'adresse, ça reste faisable en V2 avec un format binaire (~300 Mo) publié comme artefact de build. |
| **Mobile** | **À l'adresse (grille 200 m)**, pré-calculée | Mesuré sur la Guadeloupe : 4 couches 4G sur une grille de 200 m tiennent en 29 Ko compressés. En extrapolant à la métropole et aux DOM (19 couches opérateur × techno), on arrive à **~50–120 Mo au total, ~0,5–1,5 Mo par département**. Ça rentre sans problème, mais publier en artefact de build pour ne pas faire gonfler l'historique Git chaque trimestre. |
| **API en direct** | **Aucune** | Ni data.arcep.fr (S3 OVH), ni l'API de monreseaumobile.arcep.fr n'envoient `Access-Control-Allow-Origin`. maconnexioninternet.arcep.fr renvoie actuellement **HTTP 503 (maintenance)**. Les mentions légales de MRM interdisent l'usage commercial des pages du site : il faut passer par l'open data (Licence Ouverte). |

---

## 1. Fibre et internet fixe — « Ma connexion internet » (MCI)

Jeu de données : <https://www.data.gouv.fr/datasets/ma-connexion-internet> (id `5e836644ca07c8558d91a6fc`).
- **Licence** : Licence Ouverte v2.0 (`lov2`).
- **Fréquence** : trimestrielle. **Dernier millésime : T2 2026** (données au 30/06/2026, publiées le 14/09/2026).
- **Hébergement** : `https://data.arcep.fr/fixe/maconnexioninternet/<jeu>/last/...`, qui redirige (302) vers `arcep.s3.rbx.io.cloud.ovh.net/.../2026_T2/...`. `Accept-Ranges: bytes` OK. **Pas de CORS** : preflight OPTIONS en 403, aucun en-tête ACAO (cf. `samples/arcep-cors-data-arcep-et-mci-headers.txt`).
- **Documentation** : PDF scanné de 71 p. (`doc-maconnexioninternet-v2025t4.pdf`, 7,6 Mo, sans texte extractible). Lu en image, p. 14–17.

### 1.1 Base immeuble — `base_imb`
- URL : `https://data.arcep.fr/fixe/maconnexioninternet/base_imb/last/departement/base_imb_<DEP>.csv.gz` (105 fichiers, **1 273 Mo gz au total**, de 0,2 Mo pour le 977 à 47,3 Mo pour le 59). National : `.../national/base_imb.csv.gz` = **1 351 Mo gz**.
- Format : CSV `;`, UTF-8, gzip. Coordonnées `imb_x/imb_y` en **EPSG:3857** (Web Mercator) : vérifié en reprojetant la Lozère.
- Colonnes : `imb_id; imb_x; imb_y; imb_code; imb_code_insee; imb_nbr_logloc; imb_source (fo|fpb|fpban); imb_type (PA|IM); addr_code; imb_num; addr_numero; addr_rep; addr_nom_voie; addr_nom_ld; addr_code_insee; addr_nom_commune; addr_id_fantoir; addr_source (ban|fo|cada)`.
- `addr_code` = **clé d'interopérabilité BAN** quand `addr_source='ban'` (d'après la doc, p. 15). C'est donc joignable directement avec l'`id` renvoyé par le géocodeur BAN/Géoplateforme. Sinon, repli sur l'immeuble le plus proche.
- Volumétrie mesurée : Lozère **59 081** immeubles (2,92 Mo gz), Paris **99 257** (4,75 Mo gz), soit ~48–50 o gz par ligne. **National ≈ 27,8 M immeubles** (extrapolé depuis la taille gz). Cohérent avec le fichier Cartefibre (~25 M lignes, cf. 1.4).
- Échantillon : `samples/arcep-mci-base-imb-48-head.csv`.

### 1.2 Table d'éligibilité — `actuel.csv` (toutes technologies)
- URL : `.../eligibilite/last/departement/actuel_<DEP>.csv.gz` (**1 448 Mo gz** au total). National : `.../national/actuel.csv.gz` = **1 874 Mo gz**.
- Colonnes : `imb_id; addr_code; imb_code; code_operateur; code_techno; classe_debit_montant; classe_debit_descendant; limitation (Go/mois, vide = illimité); saturation (booléen)`.
- Une ligne par triplet immeuble × opérateur × technologie. Lozère : 666 582 lignes (11,3 par immeuble) ; Paris : 1 492 742 (15 par immeuble). **National ≈ 440 M lignes** (extrapolé).
- `code_techno` observés : `FO` (FttH), `CU` (cuivre DSL), `COAX` (câble), `4GF` (4G fixe), `SAT` (satellite). La doc et les stats communales mentionnent aussi `THDR`/`HDR` (THD radio), non vus dans 48/75.
- Classes de débit (doc p. 16) : `INEL` < 0,5 Mbit/s ; `HD05` 0,5–4 ; `HD3` 2–10 ; `BHD8` 6–25 ; `THD30` 20–100 ; `THD100` 100–1000 ; `THD1G` ≥ 1 Gbit/s.
- **Opérateurs commerciaux présents** : oui, par immeuble et par techno (`code_operateur` : FRTE, SFR0, BOUY, FREE, MILK, NORN, STAK = Starlink, NUAT, etc.). Référentiel dans `.../reference/last/operateur/operateur.csv` (5 Ko, `samples/arcep-mci-reference-operateur.csv`).
- Observation : en Lozère, le cuivre n'apparaît que sur 4 929 immeubles sur 59 081, contre 99 253 sur 99 257 à Paris. C'est probablement l'effet de la fermeture du cuivre, **non vérifié**.
- **Dates prévisionnelles de déploiement à l'adresse : absentes de MCI.** (Voir Cartefibre en 1.4 pour le statut de l'immeuble.)
- Profils distincts (ensemble {techno, opérateur, débit} d'un immeuble) : **142 en Lozère, 556 à Paris**. Un dictionnaire de profils par commune écrase donc très bien les données.
- Échantillon : `samples/arcep-mci-eligibilite-actuel-48-head.csv`.

### 1.3 Fermeture du cuivre — `base_imb_fc`
- URL : `.../fermeture_cuivre/last/departement/base_imb_fc_<DEP>.csv.gz` (national 75 Mo gz). Colonnes : `immeuble_id; num_lot_fz; fermeture_technique; fermeture_com_zone; fermeture_com_addr; elig_fo; annee_ft`.
- **Gelé au T3 2025** (la doc dit que la mise à jour a cessé ; il faut désormais aller voir les trajectoires publiées par Orange sur gallery.orange.com, **non vérifié**).

### 1.4 Déploiements FttH — Cartefibre (« Le marché du haut et très haut débit fixe (déploiements) »)
Jeu de données : <https://www.data.gouv.fr/datasets/le-marche-du-haut-et-tres-haut-debit-fixe-deploiements>. Licence Ouverte v1 (`fr-lo`), trimestriel, **dernier millésime T2 2026 (publié le 10/09/2026)**. Hébergé sur `static.data.gouv.fr`, qui **envoie bien du CORS** (`Access-Control-Allow-Origin: *`) et accepte les requêtes Range.
- **Commune** : `2026t2-commune.zip` (32,7 Mo, shapefile EPSG:3857, 34 919 communes / arrondissements). Champs utiles : `INSEE_COM, Locaux, ftth` (locaux raccordables), `couv` (classe de couverture 0/5/10/25/50/80/95 %), `oi` (opérateurs d'infrastructure), `zone` (ZTD/AMII/RIP…). → **C'est le jeu « taux de couverture FttH par commune ».** Échantillon : `samples/arcep-cartefibre-communes-2026T2-dbf-head.csv` (DBF en latin-1 malgré le `.cpg` qui annonce UTF-8).
- **Immeuble** : `2026t2-immeuble.zip` = **835 Mo zip → 4,51 Go CSV** (`carte_fibre_immeubles_2026_T2_20260902.csv`, ~25 M lignes estimées). Colonnes : `x,y` (WGS84), `imb_id, num_voie, type_voie, nom_voie, code_insee, imb_etat (deploye|en cours de deploiement|cible|signe|raccordable demande|abandonne…), pm_ref, pm_etat, pm_date_mad, code_l331, type_imb, date_completude…`. Sur les 110 713 premières lignes, aucune date future : **pas de date prévisionnelle exploitable**. Seul le statut `cible`/`signe`/`en cours` indique que la fibre est prévue. Échantillon : `samples/arcep-cartefibre-immeubles-2026T2-head.csv`.
- Aussi publiés : département (3,8 Mo), ZAPM (78 Mo), tableur `obs-hd-thd-deploiement` (23,6 Mo).

### 1.5 Statistiques communales MCI (autres technologies à la commune)
`.../statistiques/last/commune/` : `commune.csv` (1,5 Mo), `commune_debit*.csv` (~2,3 Mo chacun), `commune_dsl.csv` (1,9 Mo), `commune_meilleure_techno_hd.csv` (2,2 Mo), plus `commune_techno` (non listé en détail). Colonnes, par exemple : `code_insee; nbr (locaux); elig_ftth; elig_coax; elig_cu_30; elig_thdr; elig_cu_8; elig_4gf; elig_hdr; elig_sat; date`. Échantillons : `samples/arcep-mci-statistiques-commune*.csv`.

### 1.6 Estimation (a) — fibre / fixe à l'immeuble pré-calculé par commune
J'ai prototypé un format compact par commune : `{"p": [profils [techno, op, débit↓]], "b": [[addr_code sans préfixe INSEE, lon×1e5, lat×1e5, idx_profil], …]}`. Exemple réel : `samples/arcep-fibre-precalc-exemple-48095.json`.

| Mesure | Lozère | Paris |
|---|---|---|
| Immeubles | 59 081 | 99 257 |
| JSON total | 2,45 Mo (152 communes) | 4,14 Mo (1 fichier, 75056) |
| Octets/immeuble | 41,5 | 41,7 |
| Plus gros fichier | 165 Ko | 4,1 Mo |

- **National ≈ 27,8 M × 42 o ≈ 1,15–1,2 Go** répartis sur ~35 000 fichiers. Aucun fichier ne dépasse 50 Mo (le plus gros, Paris, fait ~4 Mo ; Marseille et Lyon sont **non mesurés** mais devraient être plus petits). En revanche le **total dépasse 1 Go**, soit la limite du dépôt et celle d'un site GitHub Pages publié (1 Go).
- Pistes pour passer sous 1 Go :
  - CSV au lieu de JSON : ~29 o/immeuble, soit ~800 Mo. Limite, déconseillé.
  - Binaire par commune (int16 x/y relatifs + uint16 profil + index trié par clé BAN) : ~10–12 o/immeuble, soit **~300 Mo**. À publier en **artefact de build** (Actions → Pages), pas commité. Rafraîchissement trimestriel.
  - Ne garder que la fibre (FO + opérateurs) : gain faible, car c'est la ligne par immeuble qui coûte, pas les profils.
- **Commune seule** : stats MCI + Cartefibre commune donnent ~300 o × 35 000 ≈ **~10 Mo**. Trivial.

---

## 2. Mobile — « Mon réseau mobile » (MRM)

Jeu de données : <https://www.data.gouv.fr/datasets/mon-reseau-mobile> (id `58c98b1888ee38770950152b`). **Licence Ouverte v1 (`fr-lo`)**. Trimestriel. **Dernier millésime : T1 2026** (données au 31/03/2026, publiées le 18/06/2026). Hébergé sur data.arcep.fr (même S3, pas de CORS).

### 2.1 Cartes de couverture théorique (simulations opérateurs, polygones)
- Doc : `https://data.arcep.fr/mobile/couvertures_theoriques/documentation_couverture.md`.
- Format : **GeoPackage compressé en 7z** (`.gpkg.7z`), MultiPolygon. Métropole en Lambert-93 (EPSG:2154), un fichier national par opérateur × techno. DOM : un fichier par territoire (EPSG 5490, 2972, 2975, 4471).
- Champs (vérifiés sur 971) : `operateur (MCC+MNC), operateur_commercial, operateur_infra, date, techno, usage (voix|data), niveau (TBC|BC|CL), dept`. En pratique, **un polygone par niveau** (3 lignes par fichier en 971).
- Fréquence : 4G trimestrielle ; 2G, 2G/3G et 3G semestrielles (T2/T4). Le dernier jeu complet est donc 2025_T4 pour 2G/3G/5G et 2026_T1 pour la 4G.
- Tailles (7z) :
  - Métropole 2026_T1, 4G data : BOUY 323 Mo, FREE 659 Mo, OF 128 Mo, SFR0 309 Mo.
  - Métropole 2025_T4, toutes technos : 19 fichiers, **~3,8 Go 7z au total**. Couches : 2G voix, 2G3G voix, 3G data, 4G data et **5G data** (37–100 Mo par opérateur). La doc prétend encore que les cartes 5G ne sont pas publiées, mais les fichiers existent. **Pas de 2G Free** depuis 2024_T4.
  - DOM 2026_T1 : 0,4 à 7,7 Mo par territoire.
  - Taille décompressée en métropole **non vérifiée** (971 : ×3 à ×5).
- Niveaux : TBC / BC / CL pour 2G, 2G3G et 4G data (métropole depuis 2025_T1). La 3G data n'a pas de niveau. La doc dit que la 4G outre-mer n'en a pas non plus, **mais le fichier 971 FRCA 2026_T1 en a** (BC/CL/TBC). Niveaux en 5G : **non vérifié**.
- Précision : ce sont des simulations d'opérateurs, pas des mesures. La couverture « à l'adresse » est donc au mieux la précision du modèle.

### 2.2 Mesures de qualité de service Arcep (campagne annuelle, points)
- `https://data.arcep.fr/mobile/mesures_qualite_arcep/last/Metropole/2025_QoS_Metropole_{data,voix}_{habitations,transports}.csv` : 93 / 68 / 246 / 85 Mo. Outre-mer : 25–49 Mo. Plus `2025_QoS_indicateurs_globaux.xlsx`.
- CSV `;`, ~80 colonnes, dont `latitude_start, longitude_start, insee_com, operator, protocol (WEB, VOIX…), result, bitrate_dl, rsrp, rsrq, nom_com, zone (Zones intermédiaires…)`.
- Environ 356 000 lignes data habitations et 224 000 voix habitations (estimé depuis la taille moyenne des lignes). Campagne 2025, **une par an**.
- Granularité : points de mesure, dans quelques milliers de communes seulement. **Utilisable à la commune quand des mesures existent** (« X mesures dans votre commune »), pas à l'adresse.
- Échantillons : `samples/arcep-mrm-qos-2025-metropole-*-head.csv`.

### 2.3 Autres jeux MRM (bonus)
- **Crowdsourcing** : `mesures_crowdsourcing/last/2026_T1_crowd_Ookla.csv` (58 Mo, ~370 000 lignes, coordonnées arrondies à 0,01°), `…_Speedchecker.csv` (15 Mo). Trimestriel.
- **Sites/antennes** : `sites/last/2026_T1_sites_Metropole.csv` (20 Mo, ~124 000 lignes, lat/lon, `insee_com`, `site_2g…site_5g`, bandes 5G). L'API `nb_site` renvoie 127 688. Facile à pré-calculer en « antennes par commune » ou « antenne la plus proche ».
- **4G fixe** : `4G_fixe/last/2026_T1_4GF_Metropole_sites.csv` (0,1 Mo, Lambert-93).

### 2.4 Estimation (b) — mobile pré-calculé sur une grille de 200 m
**Mesure réelle, Guadeloupe (971), 4 opérateurs × 4G data, 2026_T1** : grille de 200 m sur l'emprise, soit 379 × 432 = **163 728 cellules**. Rastérisation avec `shapely.contains_xy` en 0,2–0,3 s par couche. Résultat :
- uint8 brut : 655 Ko ;
- **2 bits/cellule** (0 = pas de couverture, 1 = CL, 2 = BC, 3 = TBC) : 164 Ko ;
- **2 bits + deflate : 29 Ko** pour les 4 couches.

La Guadeloupe fait ~1 630 km² de terres, soit ~40 700 cellules (~25 % de l'emprise), ce qui donne **~0,18 o compressé par cellule terrestre et par couche**.

Extrapolation :
- Métropole ~552 000 km², soit **~13,8 M cellules de 200 m** (~20 M avec l'emprise rectangulaire de chaque département).
- Couches : 4 opérateurs × {2G voix, 2G3G voix, 3G data, 4G data, 5G data} − 2G Free = **19 couches**. DOM : ~2,3 M cellules (Guyane 83 500 km², essentiellement non couverte, donc très compressible), × 3–5 opérateurs × ~2–5 couches.
- 2 bits bruts : 20 M × 19 × 2 bits ≈ **95 Mo** (+ ~5–15 Mo pour les DOM).
- 2 bits + deflate (même ratio que 971) : 13,8 M × 19 × 0,18 o ≈ **~47 Mo**. Avec une marge ×2 pour une couverture plus morcelée : **~50–120 Mo au total, soit ~0,5–1,5 Mo par département (≤ ~5 Mo pour les plus grands)**.
- Variante JSON limitée aux carreaux INSEE 200 m habités (~2,3 M carreaux, **ordre de grandeur non vérifié ici**) à ~60 o/carreau : **~140 Mo**. Ça rentre aussi, mais le binaire est 2 à 3 fois plus petit et couvre aussi les zones inhabitées.
- Lecture côté navigateur : on projette le point BAN en Lambert-93 (proj4js, ou une formule codée en dur), puis on calcule l'index de cellule dans un `Uint8Array` par département. GitHub Pages sert bien les requêtes Range (`206`, `Accept-Ranges: bytes`, CORS `*`, testé sur pages.github.com). Un gros fichier non compressé lu par Range est donc aussi possible.
- **Verdict : ça rentre sous 1 Go et sous 50 Mo par fichier.** Mais chaque trimestre ajouterait ~50–100 Mo de binaires dans l'historique Git (~1 Go en 2–3 ans). → **Générer en CI et publier comme artefact Pages, pas commité.**
- Coût du build : ~3,8 Go de 7z à décompresser puis rastériser. La taille décompressée n'a pas été vérifiée : il faut traiter les fichiers un par un (disque d'un runner Actions ≈ 14 Go). Il vaut mieux `gdal_rasterize` (GDAL) que shapely pour les polygones métropolitains. Temps de build **non vérifié**.
- Limite de précision : le résultat est le niveau au centre de la cellule, à ±100 m près, donc à signaler dans l'UI (« estimation à 200 m près, d'après les simulations des opérateurs »). Une grille de 100 m multiplie le volume par ~4 (~200–450 Mo), ce qui reste faisable en artefact.

---

## 3. API en direct et conditions de réutilisation

| Backend | Constat (24/09/2026) |
|---|---|
| `data.arcep.fr` → `arcep.s3.rbx.io.cloud.ovh.net` | 302 puis 200, **aucun `Access-Control-Allow-Origin`**, OPTIONS → 403. Inutilisable depuis le navigateur. |
| `maconnexioninternet.arcep.fr` | **HTTP 503**, page « en maintenance ». Aucune API découvrable. |
| `monreseaumobile.arcep.fr/api/*` (Django/gunicorn) | Endpoints trouvés dans le JS Next.js : `data_geolocalisation/?coords=lon,lat` (répond : `id` BAN, INSEE…), `stat_couverture/?id&operators&service&entite&x&y` (couverture du point ; mes essais renvoient « Aucune donnée », **paramètres exacts non vérifiés**), `stat_couv_operateur/?insee…`, `site/`, `nb_site/`, `crowd/`, `clusterQos/`… **Aucun en-tête CORS** (`vary: origin`, mais pas d'ACAO) et CSP `connect-src` restreinte. Tuiles vectorielles `…/tileserv/{table}/{z}/{x}/{y}.pbf` (pg_tileserv, schéma `mrm_public`). `tileserv/index.json` → 404 ; CORS des tuiles **non vérifié**. API non documentée, donc aucune garantie de stabilité. |
| `static.data.gouv.fr` | **CORS `*`** et Range OK. Mais les fichiers utiles (zip de 835 Mo, 7z) ne sont pas interrogeables ligne à ligne. |

Conditions :
- Open data MCI, Cartefibre et MRM sous **Licence Ouverte (v1 ou v2)** : réutilisation libre avec mention de la source (« Arcep, Ma connexion internet, T2 2026 ») et de la date.
- Les **mentions légales du site MRM** (mises à jour le 19/03/2024) indiquent que les données du site « ne peuvent être utilisées à des fins commerciales ou publicitaires » et que la reproduction doit respecter l'intégrité des documents. Consommer l'API privée du site n'est donc ni prévu ni sûr : passer par l'open data.

(Preuves : `samples/arcep-mrm-api-data-geolocalisation-headers-body.txt`, `samples/arcep-cors-data-arcep-et-mci-headers.txt`.)

---

## 4. Recommandation V1

1. **Fibre et fixe → commune en V1**, avec un encart clair : « Données à la commune. L'éligibilité exacte de votre logement : voir maconnexioninternet.arcep.fr ». Contenu : % de locaux raccordables FttH et classe `couv` (Cartefibre commune), opérateurs d'infrastructure, et répartition des locaux par meilleure technologie et par classe de débit (stats communales MCI). Pré-calcul : ~10 Mo, commitable.
   - V2 à l'adresse : jointure par `addr_code` = clé BAN (repli sur l'immeuble le plus proche), format binaire par commune (~300 Mo) publié en artefact de build.
2. **Mobile → à l'adresse dès la V1**, via une grille de 200 m par département (~50–120 Mo, artefact de build), avec 4 opérateurs × 2G/3G/4G/5G et les niveaux TBC/BC/CL/aucun. Mention « simulation opérateur, ±100 m ». En complément, à la commune : nombre de sites par techno et mesures QoS Arcep quand il y en a.
3. **Aucune dépendance live à l'Arcep** : pas de CORS, un site en maintenance et une API non documentée.

## 5. Tableau récapitulatif

| Donnée | Source/URL | Format & taille | CORS/API | Clé | Fraîcheur | Précision | Verdict | Taille estimée pré-calcul |
|---|---|---|---|---|---|---|---|---|
| Base immeubles MCI | data.arcep.fr/fixe/maconnexioninternet/base_imb/last/departement/base_imb_XX.csv.gz | CSV gz ; 105 fichiers, 1 273 Mo gz (national 1 351 Mo) ; ~27,8 M lignes | Non (S3 sans ACAO) | Aucune | T2 2026, trimestriel, publié le 14/09/2026 | Immeuble (point EPSG:3857), `addr_code` = clé BAN | pré-calculée | Inclus ci-dessous |
| Éligibilité fixe MCI (FO, CU, COAX, 4GF, SAT, opérateurs, débits) | …/eligibilite/last/departement/actuel_XX.csv.gz | CSV gz ; 1 448 Mo gz (national 1 874 Mo) ; ~440 M lignes | Non | Aucune | T2 2026, trimestriel | Immeuble × opérateur × techno, classes de débit | pré-calculée (commune en V1, immeuble en V2) | Immeuble : JSON ~1,2 Go (trop gros), binaire ~300 Mo (artefact). Commune : ~10 Mo |
| Stats communales MCI | …/statistiques/last/commune/*.csv | CSV, 1,5–2,4 Mo par fichier | Non | Aucune | T2 2026, trimestriel | Commune | pré-calculée | ~5–10 Mo |
| Fermeture cuivre | …/fermeture_cuivre/last/departement/base_imb_fc_XX.csv.gz | CSV gz, national 75 Mo | Non | Aucune | **Gelé au T3 2025** | Immeuble | pré-calculée (optionnel) | ~quelques dizaines de Mo à l'immeuble (non mesuré) ; négligeable à la commune |
| Couverture FttH par commune (Cartefibre) | static.data.gouv.fr/…/2026t2-commune.zip | Shapefile zip 32,7 Mo ; 34 919 communes | CORS * (fichier entier seulement) | Aucune | T2 2026, trimestriel, publié le 10/09/2026 | Commune / arrondissement | pré-calculée | < 3 Mo |
| Déploiement FttH par immeuble (Cartefibre, statut) | static.data.gouv.fr/…/2026t2-immeuble.zip | Zip 835 Mo → CSV 4,5 Go, ~25 M lignes | CORS * (non requêtable) | Aucune | T2 2026, trimestriel | Immeuble (statut cible/signé/en cours/déployé ; pas de date future) | pré-calculée (V2) | Doublon de MCI ; +~1 o/immeuble si fusionné |
| Couverture mobile théorique 2G/3G/4G/5G × 4 opérateurs | data.arcep.fr/mobile/couvertures_theoriques/last/… | GPKG 7z ; métropole ~3,8 Go 7z (19 fichiers), DOM 0,4–8 Mo par territoire | Non (et l'API MRM n'a pas de CORS) | Aucune | 4G T1 2026 (trimestriel) ; 2G/3G/5G T4 2025 (semestriel) | Polygones simulés, niveaux TBC/BC/CL (sauf 3G data ; 5G non vérifié) | pré-calculée (grille 200 m) | **~50–120 Mo** (0,5–1,5 Mo par département), artefact de build |
| QoS Arcep (appels, débits) | data.arcep.fr/mobile/mesures_qualite_arcep/last/{Metropole,Outremer}/2025_QoS_*.csv | CSV ; 68–246 Mo par fichier métropole, ~0,6 M lignes habitations | Non | Aucune | Campagne 2025, annuelle | Point de mesure (quelques milliers de communes) | pré-calculée (commune, si mesures) | ~2–5 Mo (non mesuré) |
| Crowdsourcing (Ookla, Speedchecker) | data.arcep.fr/mobile/mesures_crowdsourcing/last/ | CSV 58 + 15 Mo | Non | Aucune | T1 2026, trimestriel | Point arrondi à 0,01° | pré-calculée (commune) — optionnel | ~2 Mo (non mesuré) |
| Sites/antennes mobiles | data.arcep.fr/mobile/sites/last/2026_T1_sites_Metropole.csv | CSV 20 Mo, ~124 000 sites | Non | Aucune | T1 2026, trimestriel | Point (site) | pré-calculée | ~1–3 Mo par commune ou département (non mesuré) |
| API monreseaumobile.arcep.fr | monreseaumobile.arcep.fr/api/… | JSON | **Pas de CORS**, non documentée, CGU restrictives | Aucune | Live | Point | backend nécessaire (déconseillé) | — |
| Site maconnexioninternet.arcep.fr | maconnexioninternet.arcep.fr | — | **HTTP 503 (maintenance)** | — | — | — | backend nécessaire / indisponible | — |
