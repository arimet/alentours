# Faisabilité : transports en commun (arrêts + lignes + fréquence) et profil de quartier (Filosofi)

Étude du 24/09/2026, faite avec des appels `curl` réels (et Python/DuckDB en local pour les calculs). Adresses de test :

- **Nancy** : 35 rue Joseph Mougin 54000, lat 48.703193, lon 6.16209
- **Paris** : 20 avenue de Ségur 75007, lat 48.850699, lon 2.308628
- **Saint-Véran** (05), lat 44.704139, lon 6.861073

Pour le CORS, on a envoyé `-H "Origin: https://arimet.github.io"`. Les échantillons sont dans `samples/` (préfixes `transit-` et `filosofi-`, tous < 30 KB). On reprend la section transports de `immo-ecoles-sante.md` et on la complète.

---

## 1. Transports en commun

### 1.1 `transport.data.gouv.fr/api/gtfs-stops` : les arrêts, en direct

- `GET https://transport.data.gouv.fr/api/gtfs-stops?south=&north=&west=&east=`. L'OpenAPI (`/api/openapi`) la marque « experimental ».
- CORS : `access-control-allow-origin: *`. Pas de clé. Aucun en-tête de quota renvoyé, donc quota **non vérifié**.
- Chaque feature a les champs `stop_name`, `stop_id`, `location_type`, `dataset_id` (id interne numérique), `dataset_title`, `resource_id` et `resource_title`. **Pas de ligne, pas de mode, pas d'opérateur.**
- **Nancy** (bbox d'environ 900 × 900 m) : 37 features, 14 KB, 0,20 s. Le plus proche est « Nancy College Jean Lamour » à 100 m. Chaque arrêt apparaît **deux fois** : une fois via le GTFS « Réseau urbain Stan » (`stop_id` `NYSOL0`) et une fois via l'« Agrégat des réseaux urbains et interurbains du Grand Est » (`STAN:NYSOL0`). Il faut dédoublonner par nom et position. → `samples/transit-gtfs-stops-bbox-nancy-mougin.json`
- **Saint-Véran** (bbox d'environ 4 × 4 km) : 34 features, 12 KB. Les deux sources sont le **réseau scolaire ZOU !** et les **navettes saisonnières CC Guillestrois-Queyras**. Le GTFS des navettes ne couvre que l'hiver 2025-26 (`calendar.txt` du 20/12/2025 au 22/03/2026), il est donc **périmé**, mais ses arrêts sont toujours renvoyés. → `samples/transit-gtfs-stops-bbox-saint-veran-2km.json`
- Ségur : déjà testé dans `immo-ecoles-sante.md` (7 arrêts IDFM, Breteuil à 186 m).

### 1.2 Métadonnées des jeux : `GET /api/datasets` (CORS `*`, 2,55 MB, sans clé)

- On obtient 800 jeux, dont 490 de type `public-transit`, et **564 ressources GTFS** (547 avec des stats de validation). Chaque ressource a `metadata.modes`, `networks`, `start_date`/`end_date` et `stats.routes_count`/`stop_points_count`/`trips_count`. On sait donc quels modes un réseau exploite, mais **pas quelle ligne passe à quel arrêt**.
- Total déclaré : environ 520 800 `stop_points` et 43 190 routes (avec les doublons des 7 agrégats régionaux). 51 ressources GTFS ont une `end_date` déjà passée.
- Licences des jeux `public-transit` : `lov2` 309, `odc-odbl` 164 (notamment SNCF), `notspecified` 12, `mobility-licence` 2 (IDFM), `fr-lo` 3. Attention : l'**ODbL impose le partage à l'identique de la base dérivée**, ce qui s'applique aussi à un pré-calcul publié dans `public/data`.
- `/api/datasets/{id}/geojson` renvoie la **zone couverte** (2,7 KB pour Stan), pas les arrêts. Il n'existe **pas** d'endpoint du type « stops_by_bbox avec lignes », ni de conversion GTFS→GeoJSON des lignes exposée par l'API (non trouvé dans l'OpenAPI).

### 1.3 Données « arrêt → lignes » prêtes à l'emploi : seulement par réseau

| Source | Test | Résultat |
|---|---|---|
| **IDFM `arrets-lignes`** (ODS) `data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/arrets-lignes/records?where=within_distance(pointgeo,geom'POINT(lon lat)',400m)` | Ségur 400 m | 15 couples arrêt-ligne en 1 appel : métro **10** (Ségur), bus **28, 82, 86, 92** (RATP). Champs `route_long_name`, `shortname`, `mode` (Metro/Bus/…), `operatorname`, `stop_name`, `pointgeo`, `code_insee`. CORS `*`, sans clé, en-têtes `x-ratelimit-limit: 1000000` par jour. Licence **ODbL**, 74 038 lignes, modifié le 23/09/2026. **Pas de fréquence.** Île-de-France uniquement. → `samples/transit-idfm-arrets-lignes-segur-400m.json` |
| **SNCF `gares-de-voyageurs`** (ODS) `ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/gares-de-voyageurs/records?where=within_distance(position_geographique,…,3km)` | Nancy 3 km | 1 gare (Nancy, UIC 87141002, à environ 1,7 km). CORS `*`, sans clé, `x-ratelimit-limit: 10000`. ODbL, 2 782 gares, mis à jour le 24/09/2026. **Pas de lignes ni de fréquence**, seulement la gare. → `samples/transit-sncf-gares-voyageurs-nancy-3km.json` |
| Export national « Arrêts de transport en France » (`651d2ece3af956b8dd0d7648`) | lu par Range | CSV de 437 MB du 13/01/2026 (pas mis à jour depuis). Colonnes : `dataset_*`, `resource_*`, `stop_id`, `stop_name`, `stop_lat/lon`, `location_type`, `agency_id`, `agency_name`. **Aucune ligne.** Seul intérêt : l'opérateur. |

Les API Navitia et PRIM (IDFM) donneraient les lignes et les horaires, mais elles exigent une clé (d'après leur documentation publique, **non testé ici**). Elles sont donc exclues pour un site statique.

### 1.4 Lignes et fréquences : il faut un pré-calcul depuis les GTFS

On ne peut pas télécharger les GTFS depuis le navigateur. Sur Stan, le premier saut (`transport.data.gouv.fr/resources/83710/download`, 302) **n'a pas d'en-tête ACAO**, alors que la chaîne de redirections suivante en a un. De toute façon, un zip de 8,7 MB (83 MB décompressés, dont 78 MB de `stop_times.txt`) ne se charge pas à chaque visite.

Preuve de concept : `samples/transit-precalc-gtfs-lignes-par-arret.py.txt`, environ 40 lignes de Python stdlib. Le script lit `calendar`/`calendar_dates` pour un jour de semaine de référence, puis `routes` (le `route_type` donne bus/tram/métro/train), `agency` et `stop_times`, et compte les départs par arrêt et par ligne.

- **Nancy**, Stan, mardi 29/09/2026, rayon de 400 m : « Nancy College Jean Lamour » (100 m) est desservi par la ligne **T2 avec 123 départs/jour** et la ligne **32 avec 9 départs/jour** ; « Alix Le Clerc » (183 m) par T2 (123). Le calcul prend 3,9 s. → `samples/transit-precalc-stan-lignes-departs-nancy-mougin.json`
- **Gare de Nancy**, GTFS SNCF (5,1 MB, ODbL) : on obtient des dizaines de lignes TER/cars avec leur nombre de départs (C40+ : 62, C44 : 39, K31 : 22…). La gare est éclatée en plusieurs `stop_points` (un par mode). Les `route_short_name` sont des codes internes (C40+, K31, 805A, « INCONNU »), il faudra afficher « TER » ou « TGV » à partir de l'agency ou du `route_long_name`.
- **Saint-Véran** : le ZOU scolaire (13,2 MB) donne les lignes 5706/5708 avec **1 à 2 départs/jour** en période scolaire et **0** le 12/01/2027, car le GTFS s'arrête au 18/12/2026. Les navettes CCGQ donnent 0 départ (GTFS périmé). L'affichage honnête serait donc « transport scolaire uniquement ».

**Taille et effort pour la France (estimations, non mesurées de bout en bout)** :
- Téléchargement : 564 ressources GTFS. La somme des `filesize` connus (219 ressources) fait 291 MB, auxquels s'ajoutent IDFM (136 MB, mesuré) et SNCF (5 MB), soit environ **0,5 à 1 GB de zips** au total (non vérifié : `filesize` est absent pour plus de la moitié). C'est faisable dans une GitHub Action, mais c'est long (IDFM seul décompresse probablement plus de 1 GB de `stop_times`, non vérifié).
- Sortie : environ 520 000 stop_points bruts (moins une fois dédoublonnés entre agrégats et réseaux locaux). À environ 150 octets par arrêt en JSON compact (nom, lat/lon, [ligne, mode, opérateur, départs]), on arrive à **environ 50–80 MB pour la France**, **< 1 MB pour un département moyen**, et plusieurs MB pour Paris et la petite couronne. C'est compatible avec la limite de 50 MB par fichier (estimation).
- Effort : 1 à 2 jours pour le script (dédoublonnage, jour de référence, flux en erreur, formats variables) et un cron mensuel.

**Pièges** : les doublons agrégat/réseau local ; les flux périmés toujours exposés ; le `route_type` n'est pas toujours le mode commercial (le T2 de Nancy est déclaré `3` = bus) ; les codes de ligne SNCF sont cryptiques ; le transport scolaire et les navettes saisonnières gonflent la desserte rurale (il faut les signaler) ; le jour de référence doit tomber dans la période de validité de chaque flux (les calendriers vont de septembre à décembre pour ZOU) ; l'ODbL impose le partage à l'identique.

---

## 2. Profil de quartier : INSEE Filosofi

### 2.1 Carreaux de 200 m, millésime 2021 (le plus récent)

- Page INSEE « Revenus, pauvreté et niveau de vie en 2021 - Données carroyées » (`insee.fr/fr/statistiques/8735162`), publiée le **12/02/2026**. Couverture : Métropole, Martinique et La Réunion. Formats : shp (240 Mo), gpkg (294 Mo), **CSV zip (87 Mo)**, tailles lues sur la page.
- Le téléchargement direct depuis insee.fr répond **403 à curl**, même avec un User-Agent navigateur et une Range (protection anti-robot). CORS **non vérifié**. En pratique, insee.fr n'est pas utilisable depuis un navigateur tiers ni depuis un script simple.
- Miroir **data.gouv** (jeu `66fd2924ca43b044d55a7b74`, publié par un compte personnel, `francois-semecurbe-1`, et non par l'organisation INSEE, ce qui pose une question de pérennité) : `carreaux-200m-met-3035-2021.parquet` pèse **94,9 MB** (Métropole seulement, EPSG:3035), avec `access-control-allow-origin: *`, `accept-ranges: bytes` et la licence `lov2`. Un millésime 2019 existe aussi (162 MB).
  - Le fichier compte **2 298 582 carreaux**, en 23 row groups de 100 000 lignes, avec des statistiques de `bbox` par row group et un tri spatial approximatif. Une requête HTTP Range (DuckDB-WASM ou hyparquet) pourrait lire un seul row group (environ 4 MB) plus le footer. C'est techniquement possible **en direct**, mais lourd (le WASM de DuckDB fait des dizaines de MB). On déconseille.
  - Colonnes : `idcar_200m`, `ind`, `men`, `men_pauv`, `men_1ind`, `men_5ind`, `men_prop`, `men_fmp`, `ind_snv`, `men_surf`, `men_coll`, `men_mais`, `log_av45`, `log_45_70`, `log_70_90`, `log_ap90`, `log_inc`, `log_soc`, `ind_0_3` … `ind_80p`, `ind_inc`, `bbox`, `geometry`.
  - **Absents du parquet** par rapport à la documentation INSEE : `i_est_200` (l'indicateur d'imputation), `i_est_1km`, `lcog_geo` (le code commune) et `idcar_nat`. Pour savoir si un carreau est imputé ou pour le rattacher à sa commune, il faut le CSV INSEE (bloqué pour curl) ou une jointure spatiale.
- **Ce qu'on peut afficher** : population (`ind`), ménages (`men`), **part de ménages pauvres** = `men_pauv/men` (tronquée à 80 %), **propriétaires** = `men_prop/men` (les locataires ou autres occupants s'en déduisent par `men - men_prop`, sans distinguer le locatif social : `log_soc` compte des logements sociaux), tranches d'âge, maison ou collectif, âge du bâti.
- **Pas de médiane du niveau de vie** au carreau : on n'a que `ind_snv`, la **somme des niveaux de vie winsorisés** (bornés aux 5e et 95e centiles départementaux, soit entre 7 000–11 900 € et 39 300–97 700 € selon le département). On peut seulement calculer une **moyenne winsorisée** `ind_snv/ind`, qui n'est pas une médiane. Il faut le dire dans l'interface.
- **Secret statistique** (documentation INSEE 2021) : aucune diffusion pour un ensemble de 1 à 10 ménages fiscaux. **79 % des carreaux habités de 200 m (20 % de la population)** ont moins de 11 ménages. Ils ne sont **ni masqués ni fusionnés dans le fichier 200 m**. Leurs valeurs sont **imputées** : l'INSEE regroupe les carreaux voisins jusqu'à au moins 11 ménages, en partant du « niveau naturel » (des carreaux emboîtés de 200 m à 64 km, qui forment le fichier séparé « niveau naturel », non imputé), puis répartit les valeurs du groupe entre les carreaux. Les valeurs imputées ont des décimales.
- **Résultats aux 3 adresses** (→ `samples/filosofi-2021-carreau-200m-3-adresses.json`) :
  - Nancy `N2850600E4038400` : 85,5 individus, 42 ménages, 5 pauvres (12 %), 32 propriétaires (76 %), moyenne winsorisée d'environ 28 400 €.
  - Ségur `N2889000E3757400` : 466 individus, 239 ménages, 19 pauvres (8 %), 128 propriétaires (54 %), environ 53 900 €.
  - Saint-Véran `N2404400E4071800` : 2 individus, **1 ménage**, `men_pauv` = 0,2, `men_prop` = 0,7. C'est clairement **imputé** : il ne faut **pas** afficher ces chiffres comme ceux du carreau. Il faut soit agréger dans un rayon (par exemple 1 km : 16 carreaux et 142 habitants), soit afficher « données lissées ».
  - Piège : les demi-individus (85,5) ne signalent pas une imputation (ils viennent d'une pondération fiscale, non vérifié). Faute de `i_est_200`, `men < 11` reste le seul proxy fiable côté parquet.
- **Pré-calcul mesuré** (jointure spatiale DuckDB sur les contours communaux de `geo.api.gouv.fr`, JSON compact en colonnes, avec x/y en EPSG:3035 à la place de la géométrie) :

| Département | Carreaux | Population | Carreaux avec men < 11 | JSON brut | gzip |
|---|---|---|---|---|---|
| 54 Meurthe-et-Moselle | 13 871 | 674 422 | 7 290 | 1,53 MB | 0,46 MB |
| 75 Paris | 2 033 | 1 973 600 | 100 | 0,25 MB | 0,10 MB |
| 05 Hautes-Alpes | 8 170 | 132 916 | 6 746 | 0,95 MB | 0,22 MB |

  En extrapolant (environ 110 octets par carreau), on obtient **environ 250 MB bruts pour la Métropole** (environ 70 MB en gzip), soit **0,2 à 5 MB par département** (estimation). Les DOM (Martinique, Réunion) ne sont pas dans le parquet : il faut le CSV INSEE.

### 2.2 IRIS : la médiane et le taux de pauvreté officiels

- « Revenus, pauvreté et niveau de vie en 2021 (Iris) » (`insee.fr/fr/statistiques/8229323`), publié le 31/07/2024. Il couvre **uniquement les IRIS des communes de plus de 5 000 habitants**, Saint-Véran est donc exclu. Deux CSV (déclaré 835 KB, disponible 892 KB, tailles lues sur la page) contiennent quartiles et déciles par UC (dont la **médiane**), le Gini, le **taux de pauvreté à 60 %** et la structure des revenus. Téléchargement direct **non vérifié** (insee.fr renvoie 403 à curl). Aucun miroir data.gouv trouvé.
- Il faut ensuite rattacher l'adresse à un IRIS (contours IRIS IGN, non testé ici). Pré-calcul minuscule (< 1 MB pour la France).

### 2.3 API INSEE « Données locales »

- `api.insee.fr/donnees-locales/…` : nos appels anonymes renvoient **404** (identifiants de cube probablement faux) avec `access-control-allow-origin` qui renvoie l'origine. Il n'a donc **pas été vérifié** qu'un appel sans clé est refusé. D'après le portail `portail-api.insee.fr`, il faut une souscription et un jeton (**non vérifié en direct**). Une clé ne peut pas vivre dans un site statique, donc on l'écarte.

---

## Tableau récapitulatif

| Donnée | Endpoint | CORS | Clé | Quota | Fraîcheur | Précision | Verdict |
|---|---|---|---|---|---|---|---|
| Arrêts proches (toute la France) | `transport.data.gouv.fr/api/gtfs-stops?south=&north=&west=&east=` | `*` | non | non vérifié | selon chaque GTFS (flux périmés inclus) | point d'arrêt, doublons agrégat/local, sans lignes | **en direct** |
| Métadonnées réseaux (modes, validité) | `transport.data.gouv.fr/api/datasets` | `*` | non | non vérifié | quotidienne (non vérifié) | réseau, pas arrêt | en direct (ou à mettre en cache) |
| Lignes par arrêt, Île-de-France | `data.iledefrance-mobilites.fr/…/arrets-lignes/records` + `within_distance` | `*` | non | 1 000 000/jour (en-tête) | 23/09/2026 | arrêt × ligne, mode, opérateur ; pas de fréquence ; ODbL | **en direct** (IDF seulement) |
| Gares SNCF | `ressources.data.sncf.com/…/gares-de-voyageurs/records` | `*` | non | 10 000 (en-tête `x-ratelimit-limit`) | 24/09/2026 | gare (point), sans lignes ; ODbL | **en direct** |
| Lignes + mode + opérateur + départs/jour en semaine (France) | 564 GTFS via `transport.data.gouv.fr/resources/<id>/download` | non (1er 302 sans ACAO) | non | – | mise à jour par réseau, validité 3 mois à 2 ans | arrêt × ligne × jour de référence | **pré-calculée** (environ 50–80 MB France, < 1 MB par département moyen, estimation ; ODbL pour une partie) |
| Export national des arrêts | `static.data.gouv.fr/…/gtfs-stops-france-export-2026-01-13.csv` | non vérifié | non | – | 13/01/2026, ponctuel | arrêt + agency, sans lignes | à écarter (l'API bbox suffit) |
| Navitia / PRIM | – | non testé | oui (d'après la doc) | – | – | – | backend nécessaire |
| Filosofi 2021, carreaux 200 m (population, ménages, pauvres, propriétaires, âges, bâti, moyenne winsorisée) | `static.data.gouv.fr/…/carreaux-200m-met-3035-2021.parquet` (miroir) ; INSEE `…/8735162/Filosofi2021_carreaux_200m_csv.zip` | `*` + Range (miroir) ; INSEE 403 à curl | non | – | revenus 2021, publié le 12/02/2026 | 200 m, mais 79 % des carreaux imputés (< 11 ménages) ; pas de médiane | **pré-calculée** (0,2–1,5 MB par département mesuré, environ 250 MB Métropole) |
| Filosofi 2021 IRIS (médiane, taux de pauvreté) | `insee.fr/fr/statistiques/8229323` (CSV de 892 KB) | non vérifié (403 à curl) | non | – | revenus 2021, publié le 31/07/2024 | IRIS, communes de plus de 5 000 habitants seulement | **pré-calculée** (< 1 MB France) ; téléchargement à faire à la main |
| API INSEE Données locales | `api.insee.fr/donnees-locales/…` | reflète l'origine (sur un 404) | oui (d'après le portail, non vérifié) | non vérifié | – | commune / IRIS | **backend nécessaire** / à écarter |

Sources consultées : [INSEE, carreaux 200 m 2021](https://www.insee.fr/fr/statistiques/8735162?sommaire=8735243) · [documentation Filosofi 2021 carroyée (PDF)](https://www.insee.fr/fr/statistiques/fichier/8735106/documentation_donnees-carroyees_filosofi2021.pdf) · [INSEE, Filosofi 2021 IRIS](https://www.insee.fr/fr/statistiques/8229323)
