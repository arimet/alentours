# Faisabilité : climat futur, délinquance, bruit (2e passe), air annuel

Étude jetable. Tous les appels ont été faits le 24/09/2026 entre 17 h 50 et 18 h 10 (heure de Paris), avec `curl` et l'en-tête `Origin: https://arimet.github.io`.
Points de test :

- **Nancy** : 35 rue Joseph Mougin 54000 (48.703193, 6.16209), INSEE 54395
- **Ségur** : 20 avenue de Ségur 75007 Paris (48.850699, 2.308628), INSEE 75107 (arrondissement) / 75056 (Paris)

Ce document complète `air-bruit.md`, qu'il faut lire d'abord. Les échantillons sont dans `samples/` (préfixes `climat-`, `delinquance-`, `bruit2-`, `air2-`).

---

## 1. Climat futur par commune

### 1a. Climadiag Commune (Météo-France) : fichiers ouverts, sans clé ✅

Aucun jeu « Climadiag » n'est indexé sur data.gouv (la recherche renvoie 0 résultat). Les fichiers sont pourtant publiés dans le bucket S3 public **`meteofrance-drias`** sur `object.files.data.gouv.fr`, qu'on peut lister avec `?list-type=2`. On y trouve le lien donné par le jeu data.gouv « Projections climatiques pour le Hackathon 2025 » (`692722b996c1d42afd70669f`).

```
https://object.files.data.gouv.fr/meteofrance-drias/CLIMADIAG_COMMUNE/
  donnees_climadiag_commune_v411_20260909.tar        281 Mo  (CSV)
  donnees_climadiag_commune_json_v411_20260909.tar   902 Mo  (JSON, ~24 Ko par commune)
  donnees_climadiag_commune_v401_20260721.tar        (version précédente, toujours en ligne)
  description_algorithme_choix_pointDeGrille_commune_Hexagone_20260316-2.pdf
```

- Contenu du tar CSV (v411, 08/09/2026) :
  - `indicateurs_par_commune/{INSEE}.csv` : **34 939 fichiers**, de 6 à 8 Ko chacun
  - `indicateurs_par_epci/{SIREN}.csv` : 1 244 fichiers
  - `metadonnees.csv`, qui décrit chaque commune : population, altitudes, EPCI, liste `risques`, `icu` (îlot de chaleur urbain)
  - `documentation_Indicateurs_ClimadiagCommune.odt`
- Format CSV, 106 lignes par commune : `identifiant_insee,nom,type_entite,indicateur_id,type_ind,horizon,label,ref,low,median,high`.
- **Horizons 2030 / 2050 / 2100 = TRACC.** La page meteofrance.com/climadiag-commune donne la correspondance pour l'Hexagone et la Corse : **+2,0 °C en 2030, +2,7 °C en 2050, +4,0 °C en 2100**. `ref` est la valeur de référence. Sa période n'est pas dans le CSV (non vérifié, mais les fichiers TRACC du 1b indiquent 1976-2005). `low`, `median` et `high` donnent la fourchette de l'ensemble de modèles.
- Indicateurs présents pour l'Hexagone (17 codes) : G1 (température moyenne par saison), G2 (jours de gel), G3 (cumul de pluie), G4 (jours de pluie), R1 (fortes pluies), R2, R4 (**jours à risque de feu**), R5 (**jours avec sol sec**, par saison), **S1 (jours ≥ 35 °C)**, **S2 (nuits > 20 °C)**, **S3 (jours en vague de chaleur)**, S4 (vague de froid), T1 (jours estivaux ≥ 25 °C), AG1 à AG4 (agriculture).
  ⚠️ **Il n'y a pas d'indicateur « jours > 30 °C »** dans Climadiag. Il est dans TRACC (1b).
- Granularité : **une maille SAFRAN de 8 km par commune**, choisie selon l'intersection et l'altitude du chef-lieu (algorithme décrit dans le PDF). Des communes voisines partagent donc souvent la même valeur. **Pas de valeur par arrondissement** : il existe un fichier `75056`, mais pas de `75107`.
- Résultats réels (médiane, avec entre parenthèses la fourchette basse-haute) :

| Commune | Indicateur | Réf. | 2030 (+2 °C) | 2050 (+2,7 °C) | 2100 (+4 °C) |
|---|---|---|---|---|---|
| Nancy 54395 | S1 jours ≥ 35 °C | 1 | 2 (1-4) | 4 (2-6) | 8 (4-12) |
| Nancy | S2 nuits > 20 °C | 2 | 6 (4-10) | 12 (7-15) | 22 (17-27) |
| Nancy | S3 jours de vague de chaleur | 2 | 8 (5-12) | 15 (10-18) | 22 (16-31) |
| Nancy | R5 jours de sol sec (été) | 30 | 36 | 41 | 50 |
| Nancy | G2 jours de gel | 64 | 47 | 40 | 28 |
| Paris 75056 | S1 | 1 | 2 | 4 | 8 |
| Paris | S2 | 8 | 17 (12-22) | 26 (20-31) | 43 (33-50) |
| Paris | S3 | 2 | 7 | 11 | 19 |

- CORS : **`Access-Control-Allow-Origin: https://arimet.github.io`** (l'origine est renvoyée telle quelle). `Accept-Ranges: bytes` est présent et `Content-Range` est exposé. La préflight OPTIONS avec `range` renvoie 204 et autorise l'en-tête `range`.
- **Accès direct testé** : `Range: bytes=148768256-148774231` sur le tar CSV renvoie exactement `54395.csv` en HTTP 206. Un index pré-calculé INSEE → (offset, taille) suffirait donc (~35 000 entrées, environ 500 Ko estimés, ou environ 5 Ko par département).
- Clé : aucune. Quota : non vérifié. Licence : **non vérifiée**. Le bucket n'affiche aucune licence. Les autres jeux Météo-France sur data.gouv sont en `lov2`, sauf DRIAS, en `fr-lo` (Licence Ouverte v1).
- Fraîcheur : v401 en juillet 2026, v411 en septembre 2026. **Le nom du fichier change à chaque version**, ce qui casse un index d'offsets.
- Pré-calcul : si on garde S1, S2, S3, T1, G2, R4 et R5 été × 3 horizons × (low, median, high), le département 54 (591 communes) pèse **363 Ko de JSON** (valeurs en chaînes, sans optimisation). Environ 21 Mo pour toute la France (estimation), à lire une seule fois au build dans le tar de 281 Mo.
- **Verdict : pré-calculée** (~360 Ko par département). L'option « en direct » via Range et un index d'offsets marche aussi, mais elle est fragile à chaque nouvelle version.

### 1b. TRACC-2023 / Explore2 sur grille de 8 km : fichiers ouverts ✅

Même bucket, préfixe `TRACC-2023/` (86 fichiers). Liste complète : `listes_url_fichiers/TRACC-2023.txt`.

- Le plus utile : `CSV_wk_032025/Indicateurs-Absolue_Centiles-Explore2-Climat_Moyenne-20ans_{RWL20|RWL27|RWL40|historical}_csv.tar`, qui fait **109, 108, 106 et 47 Mo**. Chaque tar contient 159 CSV : un par indicateur × (valeur absolue, écart) × (`ENSmin`, `ENSq50`, `ENSmax`).
- Il existe aussi des séries temporelles par modèle, de 7 à 13 Go par tar : inutiles ici.
- Indicateurs présents : **TX30D (jours avec Tmax ≥ 30 °C)**, **TX35D**, **TR (nuits tropicales, Tmin > 20 °C)**, TXx1D, TMm, TXm_JJA, FD (gel), RR, RRq99, Rx1D, **IFM40D (feu)**, **SWI04D (jours avec SWI < 0,4, donc sécheresse du sol)**, ETP, CWB, vent.
  ⚠️ Pas d'indicateur « vague de chaleur » : il est dans Climadiag (S3).
- Format : un en-tête `#` d'environ 17 lignes, puis `Point;Latitude;Longitude;RWL;Value`, soit **19 164 points** (grille SAFRAN d'environ 8 km, 0,072° en latitude, avec des `nan` hors de France). Environ 790 Ko par fichier.
- ⚠️ **Piège 1** : la colonne `Value` des indicateurs en jours est une **chaîne Timedelta pandas**, par exemple `11 days 22:47:59.983520504`. Il faut la parser : jours + heures / 24.
- ⚠️ **Piège 2** : **SWI04D ne contient que des `nan`** dans les CSV Centiles (seulement 3 lignes non vides sur 19 164 dans RWL27). Il faudrait vérifier les NetCDF.
- ⚠️ **Piège 3** : l'en-tête des fichiers `ENSq50` indique « MAX de l'ensemble », visiblement par copier-coller. Il faut se fier au nom du fichier.
- Résultats réels (médiane `ENSq50`, point de grille le plus proche) :

| Point | Maille (distance) | Indicateur | Historique 1976-2005 | +2 °C | +2,7 °C | +4 °C |
|---|---|---|---|---|---|---|
| Nancy | 14403 (2,8 km) | TX30D (jours ≥ 30 °C) | 6,1 | 11,9 | 17,6 | 28,0 |
| Nancy | | TR (nuits > 20 °C) | 1,9 | 6,3 | 11,7 | 22,3 |
| Nancy | | TX35D | 0,5 | 1,8 | 3,9 | 7,5 |
| Ségur | 14510 (3,6 km) | TX30D | 8,9 | 14,1 | 20,9 | 32,1 |
| Ségur | | TR | 7,8 | 16,8 | 25,6 | 42,8 |
| Ségur | | TX35D | 0,7 | 2,1 | 4,0 | 7,6 |

  Les valeurs TR sont cohérentes avec S2 de Climadiag (Nancy : 12 nuits à +2,7 °C d'un côté, 11,7 de l'autre).
- CORS : même bucket, donc même comportement (origine renvoyée). Testé sur le tar Climadiag seulement. Clé : aucune. Licence : non vérifiée. Fraîcheur : fichiers de mai à novembre 2025, données figées (TRACC 2023).
- Pré-calcul : 4 indicateurs × 4 niveaux × environ 9 600 points utiles ≈ **~1 Mo de JSON national** (estimation). Un seul fichier suffit, avec une recherche du point le plus proche côté client.
- **Verdict : pré-calculée** (~1 Mo national, ou découpée par département).

### 1c. DRIAS, « Mon climat demain », meteo.data.gouv.fr

- data.gouv `5dfb22926f44413ada2c54b4` « DRIAS » (licence `fr-lo`, mise à jour en 2024) : ce n'est qu'un lien vers `drias-climat.fr`. L'Espace Données du portail n'a pas été testé (inscription nécessaire ? **non vérifié**).
- En revanche, le bucket `meteofrance-drias` expose en clair `DRIAS2020_NEW/`, `EXPLORE2-Atmos_NEW/`, `EXPLORE2-Atmos_CDFt/`, `EXPLORE2-Hydro/` et d'autres (listes d'URL dans `listes_url_fichiers/*.txt`). Ce sont des NetCDF bruts, et 1a et 1b suffisent pour Alentours.
- `meteo.data.gouv.fr` renvoie une page de 574 octets (une SPA). Rien d'exploitable n'a été trouvé sans JavaScript (non vérifié au-delà).
- « Mon climat demain » : **non vérifié** (pas cherché, faute de budget).
- API Météo-France (`portail-api.meteofrance.fr`) : elle demande une clé. Écartée.

---

## 2. Délinquance enregistrée (SSMSI)

Jeu data.gouv `621df2954fa5a3b5a023e23c`, publié par le Ministère de l'Intérieur (SSMSI). Licence **`lov2`**. Publication du 09/07/2026, avec une édition en janvier et une en juillet.

- Ressources : COM en csv.gz (**39,9 Mo**) et en parquet (**16,1 Mo**), fichier complémentaire COM COMPL en xlsx (3,8 Mo), DEP en csv (2,0 Mo), REG en csv (346 Ko), PDF de documentation.
- Base communale : **5 238 000 lignes**, **34 920 communes** (géographie au 01/01/2026), **années 2016 à 2025**, **15 indicateurs** par commune :
  cambriolages de logement (taux pour mille **logements**), destructions et dégradations volontaires, escroqueries et fraudes aux moyens de paiement, trafic de stupéfiants, usage de stupéfiants, usage de stupéfiants (AFD), violences physiques hors cadre familial, violences physiques intrafamiliales, violences sexuelles, vols avec armes, vols d'accessoires sur véhicules, vols dans les véhicules, vols de véhicules, vols sans violence contre des personnes, vols violents sans arme.
  Le fichier départemental en a plus (18 indicateurs, dont les homicides).
- Colonnes : `CODGEO_2026, annee, indicateur, unite_de_compte, nombre, taux_pour_mille, est_diffuse, insee_pop, insee_pop_millesime, insee_log, insee_log_millesime, complement_info_nombre, complement_info_taux`.
- **Secret statistique** (PDF de documentation) : une donnée n'est diffusée que si la commune a enregistré **plus de 5 faits pendant 3 années successives**. Dans ce cas, `est_diffuse` vaut `diff`, et `nombre` et `taux_pour_mille` sont remplis. Sinon, il vaut `ndiff` et ces deux champs sont vides. `complement_info_*` donne alors la **moyenne des communes non diffusées du département** : ce n'est **pas** la valeur de la commune. L'absence de faits sur 3 ans est diffusée (0).
  - En 2025, **251 145 lignes non diffusées sur 523 800 (48 %)**.
  - À Paris, Lyon et Marseille, certains arrondissements sont masqués **par différence**. Exemple réel : 75107 a « Vols avec armes » en `ndiff`.
- Résultats réels 2025 :
  - **Nancy 54395** (population 103 671) : les 15 indicateurs sont diffusés. Par exemple, cambriolages 339 (4,66 ‰ logements), vols sans violence 2 248 (21,7 ‰), violences physiques hors cadre familial 707 (6,8 ‰), destructions et dégradations 1 235 (11,9 ‰). Série des cambriolages de 2016 à 2025 : 256, 222, 149, 206, 157, 156, 185, 252, 275, 339.
  - **Paris 7e 75107** (population 48 015) : 14 indicateurs sur 15 diffusés. Vols sans violence 2 226 (46,4 ‰), escroqueries 688 (14,3 ‰), cambriolages 260 (6,6 ‰). Paris 75056 est aussi présent.
- **En direct, c'est possible** grâce à l'API tabulaire de data.gouv, qui indexe le csv.gz :
  `https://tabular-api.data.gouv.fr/api/resources/44ef4323-1097-48d5-8719-3c544b55d294/data/?CODGEO_2026__exact=75107&annee__exact=2025&page_size=50`
  - Réponse : 15 lignes, 5,8 Ko, **0,68 s**. Toutes les années pour Nancy : 150 lignes, 55 Ko, 0,61 s.
  - CORS **`*`**. Clé : aucune. Quota : non vérifié.
  - Les fichiers statiques (`static.data.gouv.fr`) sont aussi en `Access-Control-Allow-Origin: *`.
- ⚠️ Pièges de l'accès direct :
  1. **L'id de ressource change à chaque publication.** L'API tabulaire répond déjà « permanently deleted on 2026-08-02 » pour l'id du parquet listé.
  2. **Le nom de colonne change chaque année** : `CODGEO_2026` aujourd'hui, `CODGEO_2025` dans la doc de 2025.
  3. Le fichier DEP n'a pas de `CODGEO_*` mais `Code_departement`.
- Pré-calcul : par département, 10 ans × 15 indicateurs = **926 Ko** pour le 54 (2025 seule : 99 Ko). Environ 55 Mo pour la France entière (estimation), à découper par département. Exemple : `samples/delinquance-precalc-exemple-54395.json`.
- **Risques de neutralité** (à traiter dans l'interface) :
  - Ce sont des faits **enregistrés** par la police et la gendarmerie, pas la délinquance réelle. Le taux de plainte varie selon les faits : une note SSMSI citée dans la doc parle de 12 % sur 2011-2018 pour un type de fait.
  - Les faits sont localisés **au lieu de commission**. Une gare, une zone commerciale ou un centre-ville touristique gonflent le taux pour mille habitants : Paris 7e affiche 46 ‰ de vols sans violence à cause des touristes.
  - Les petites communes ont des taux très volatils. `ndiff` ne veut pas dire « zéro ». Il ne faut jamais afficher `complement_info` comme la valeur de la commune.
  - Risque de stigmatisation, de classement ou de « score sécurité », à éviter. Mieux vaut comparer au département et à la France (fichiers DEP et REG), sans classement ni couleur rouge ou verte.
  - L'échelle est la commune, pas le quartier ou l'adresse. Il faut le dire.
- **Verdict : pré-calculée** (~1 Mo par département toutes années, ou 100 Ko pour la dernière année). L'API tabulaire en direct marche, mais son URL casse à chaque publication semestrielle.

---

## 3. Bruit route et fer (cartes de bruit stratégiques), 2e passe

### 3a. Toujours rien sur la Géoplateforme

Revérifié aujourd'hui : les GetCapabilities `wfs` (5,2 Mo), `wms-v` et `wms-r` ne contiennent **que les couches DGAC PEB et PGS** (bruit aérien, voir `air-bruit.md`). Aucune couche CBS ou Lden route/fer.

### 3b. Nouveau : jeu national Cerema, par département ✅ (avec des limites)

Jeu data.gouv **`67ed4eea6f9ca69ddb4ed961`** « Cartes de bruit stratégiques des réseaux routiers et ferroviaires non concédés », publié par le Cerema. Licence **`lov2`**, fréquence quinquennale, mis en ligne le 09/04/2025.

- **97 zips, un par département** (métropole et DROM), plus le standard COVADIS en PDF. Total **550 Mo zippés**, de 0,5 à 25,6 Mo par zip (54 : 8,2 Mo ; 59 : 25,6 Mo).
- URL : `https://static.data.gouv.fr/resources/cartes-de-bruit-strategiques-des-reseaux-routiers-et-ferroviaires-non-concedes-directive-europeenne-2002-49-ce/20250409-135252/cbs2022-departement-054.zip`. CORS **`*`**.
- Contenu : shapefiles en **Lambert 93**, types A et C × Lden et Ln × route et fer (`N_BRUIT_ZBR_INFRA_{R|F}_{A|C}_{LD|LN}_S_{dep}`), une table `N_BRUIT_CBS_INFRA_{dep}.xlsx` et des métadonnées en docx. Le 54 fait **55,9 Mo décompressé**, dont 17,9 Mo pour le seul shp route A Lden.
- Champs COVADIS homogènes, en majuscules : `IDZONBRUIT, IDCBS, UUEID, ANNEE, CODEDEPT, TYPETERR, PRODUCTEUR, CODINFRA, TYPESOURCE, CBSTYPE, ZONEDEF, LEGENDE, INDICETYPE, VALIDEDEB, VALIDEFIN`. Millésime 2022 (4e échéance).
- ⚠️ **Périmètre partiel** : seulement les réseaux **« non concédés »**, c'est-à-dire l'État et le ferroviaire. **Sans les autoroutes concédées**, **sans les agglomérations de plus de 100 000 habitants** (voirie communale) et **sans la Métropole du Grand Paris**, donc sans Paris : pour Ségur, il faut toujours passer par Géo-IDE DRIEAT, qui marchait dans `air-bruit.md`.
- ⚠️ `CODINFRA = '000'` et `VALIDEFIN` est vide : on ne connaît pas le nom de la route.
- Résultat réel à **Nancy, rue Joseph Mougin** (test point dans polygone avec shapely) : **dans aucune zone**. Zones route A Lden les plus proches : **55 dB à 25 m**, 60 dB à 43 m, 65 dB à 62 m, 70 dB à 74 m. Route Ln : 50 dB à 39 m. Fer A Lden : à 105 m. Une petite erreur de géocodage suffit donc à changer la classe.
- Pré-calcul testé : GeoJSON des zones A Lden (route + fer) du 54, simplifié à 5 m, coordonnées à 5 décimales : **15 Mo** (3,2 Mo en gzip) **par département**. Par extrapolation, **~1,2 à 1,5 Go pour la France entière**, ce qui **dépasse le budget du dépôt**. Il faudrait des tuiles (PMTiles ou FlatGeobuf avec lecture par Range) ou ne garder que les zones à partir de 65 dB (non testé).

### 3c. Géo-IDE (services DDT) : l'index automatique est construisible, mais peu fiable

- data.gouv, recherche « carte de bruit strategique » : **425 jeux** (426 avec les autres requêtes), de **53 organisations** (DDT et DDTM surtout, plus DRIEAT, Cerema, MTE, DREAL Pays de la Loire, Clermont Auvergne Métropole). Ils pointent vers **768 mapfiles Géo-IDE distincts** (`org_{ORG}/{UUID}.internet.map`). On peut en tirer l'index automatiquement (le script de l'étude le fait en environ 5 appels à l'API data.gouv).
- Pas de GetCapabilities global Géo-IDE testé : il y a **un GetCapabilities par mapfile**.
- ⚠️ **Services morts** : pour le 54, le lot DDT de 2018 (3e échéance, `org_38050/2f4b7bcb-…`, couche `N_BRUIT_ZBR_R_A_LD_S_054`) répond **HTTP 500 au GetFeatureInfo** (WMS 1.3.0 et 1.1.1), et le WFS renvoie `msOGRFileOpen(): … File not found`. La donnée a été retirée alors que le catalogue existe toujours. Un index construit automatiquement pointera donc vers des services cassés. Il faut un **test de santé au build**.
- La plateforme nationale bruit du Cerema n'a pas été trouvée (0 résultat sur data.gouv). Rien pour « Grand Nancy » non plus (0 résultat).
- **Verdict bruit route/fer :**
  - hors grandes agglomérations : **pré-calculée par tuiles depuis le jeu Cerema** (trop lourd en GeoJSON brut) ;
  - Paris / MGP : **en direct via Géo-IDE DRIEAT** (déjà validé) ;
  - agglomérations de plus de 100 000 habitants comme Nancy : **pas de source nationale**. Ailleurs, c'est l'index Géo-IDE avec un test de santé.

---

## 4. Moyennes annuelles de qualité de l'air

- **LCSQA sur data.gouv** : l'organisation n'a **qu'un seul jeu**, le flux E2 temps réel (`5b98b648634f415309d52a50`, déjà décrit dans `air-bruit.md`). Le bucket `ineris-prod/lcsqa/` ne contient que `concentrations-…/temps-reel/`, `…/old/` (XML E2 de 2017-2018 avec les suffixes `-t` et `-v`, plus les datasets B et D) et `Population/` (MAJIC 2020). **Pas de fichier de statistiques annuelles validées (E1a).**
- **Géod'air** : l'API demande toujours une inscription (voir `air-bruit.md`). Un appel sans clé sur un endpoint deviné renvoie **504**, et `/api-ext/v3/api-docs` renvoie **404**. Rien d'utilisable.
- **Atmo France** : le GeoServer national (`data.atmo-france.org/geoserver/ows`, WFS et WMS listés) ne propose que `ind_atmo*`, `ind_pol*` (pollen), `alrt*` et `emissions_{dpt,epci,regions}`. **Aucune couche de modélisation annuelle.** Atmo Data annonce 6 flux, sans modélisation annuelle.
- **Atmo Grand Est** (régional, ODbL) : des cartes de moyenne annuelle NO2, PM10 et PM2.5 existent **par agglomération** (Nancy 2017-2020, en WMTS raster `portailsig.atmo-grandest.eu/…/mod_nancy_2020_no2_moyan`). C'est du **raster tuilé, sans interrogation de valeur** (non testé plus loin), et le dernier millésime vu est 2020. Leur jeu « Concentrations moyennes annuelles … réseau permanent » pointe vers un WFS ArcGIS qui répond **404**.
- **Solution restante, déjà décrite dans `air-bruit.md`** : moyenne annuelle **brute, non validée**, calculée au build à partir des fichiers E2 quotidiens, puis station la plus proche. Vérifié aujourd'hui sur le fichier du 23/09/2026 (12,6 Mo) :
  - Nancy : sites **FR30034 Nancy-Charles III** (urbain, fond : NO2, PM10, PM2.5, O3, SO2) et **FR30036 Nancy-Libération** (trafic : NO2, PM2.5). Moyennes du 23/09 : NO2 20,2 et 18,4 µg/m³, PM2.5 8,1 et 7,5 µg/m³.
  - Paris : **FR04060 « PARIS 7eme »** (fond) existe.
  - Échantillon : `samples/air2-lcsqa-e2-2026-09-23-stations-nancy.csv`.
- EEA (statistiques annuelles européennes) : `discomap.eea.europa.eu/arcgis/rest/services` renvoie **404**. Non vérifié au-delà.
- **Verdict : il n'existe pas de fichier annuel prêt et sans clé.** Soit un **pré-calcul E2** (~100 Ko national, données brutes, à signaler comme telles), soit la **modélisation annuelle par commune, à écarter** (aucune source nationale).

---

## Tableau récapitulatif

| Donnée | Endpoint | CORS | Clé | Quota | Fraîcheur | Précision | Verdict |
|---|---|---|---|---|---|---|---|
| Climat futur : Climadiag Commune (S1 ≥ 35 °C, S2 nuits > 20 °C, S3 vagues de chaleur, R5 sol sec, R4 feu, T1, G2…) | `object.files.data.gouv.fr/meteofrance-drias/CLIMADIAG_COMMUNE/donnees_climadiag_commune_v411_20260909.tar` (CSV par INSEE) | ✅ origine renvoyée, Range autorisé | non | non vérifié | v411 du 08/09/2026 ; horizons 2030/2050/2100 = +2/+2,7/+4 °C | commune, via une maille de 8 km (pas d'arrondissement) | **pré-calculée** (~360 Ko par département, ~21 Mo national) ; en direct possible via Range et un index d'offsets (fragile) |
| Climat futur : TRACC Explore2 (TX30D jours ≥ 30 °C, TR, TX35D, IFM40D) | `…/meteofrance-drias/TRACC-2023/CSV_wk_032025/Indicateurs-Absolue_Centiles-Explore2-Climat_Moyenne-20ans_{RWL20,RWL27,RWL40,historical}_csv.tar` | ✅ (même bucket) | non | non vérifié | 2025, données figées TRACC 2023 | maille de 8 km (19 164 points) | **pré-calculée** (~1 Mo national, estimation) |
| Sécheresse du sol TRACC (SWI04D) | idem | ✅ | non | — | — | — | **à écarter** (que des `nan` dans les CSV) ; utiliser R5 de Climadiag |
| DRIAS (portail) / Mon climat demain | `drias-climat.fr` | non vérifié | non vérifié | non vérifié | — | — | non vérifié (inutile vu les deux lignes précédentes) |
| Délinquance enregistrée par commune (15 indicateurs, 2016-2025) | `tabular-api.data.gouv.fr/api/resources/44ef4323-…/data/?CODGEO_2026__exact={INSEE}` ou csv.gz / parquet sur `static.data.gouv.fr` | ✅ `*` | non | non vérifié | semestrielle (09/07/2026, année 2025) | commune et arrondissement ; ~48 % des lignes sous secret | **pré-calculée** (~1 Mo par département, 100 Ko en dernière année seule) ; en direct possible mais l'URL change à chaque publication |
| Bruit route/fer, réseau non concédé (Cerema, national) | `static.data.gouv.fr/…/cbs2022-departement-{dep}.zip` (shapefile L93) | ✅ `*` | non | aucun constaté | CBS 2022 (4e échéance), publiée le 09/04/2025 | zones de 5 dB ; **sans autoroutes concédées, agglomérations > 100 000 hab. ni MGP** | **pré-calculée** en tuiles (GeoJSON = 15 Mo par département, ~1,2-1,5 Go national, hors budget) |
| Bruit route/fer, services Géo-IDE des DDT | `ogc.geo-ide.developpement-durable.gouv.fr/wxs?map=…/org_{ORG}/{UUID}.internet.map` (768 mapfiles, 425 jeux) | ✅ origine renvoyée | non | non vérifié | 2017-2023 selon le département | zones de 5 dB | **en direct + index pré-calculé** avec test de santé (service 54 mort : HTTP 500) ; seul accès pour Paris |
| Bruit route/fer (Géoplateforme) | `data.geopf.fr/{wfs,wms-v,wms-r}` | ✅ `*` | non | — | — | aucune couche CBS | **à écarter** (inexistant) |
| Air : moyennes annuelles validées par station (LCSQA / Géod'air) | `geodair.fr/api-ext` | non vérifié | **inscription** | 15 req/h | annuelle | station | **backend nécessaire** |
| Air : moyenne annuelle brute calculée depuis E2 | `files.data.gouv.fr/ineris/lcsqa/…/temps-reel/{AAAA}/FR_E2_{date}.csv` | ❌ (voir `air-bruit.md`) | non | aucun constaté | quotidienne, non validée | station la plus proche (Nancy-Charles III, PARIS 7eme…) | **pré-calculée** (~100 Ko national, estimation) |
| Air : modélisation annuelle par commune (Atmo) | aucune au niveau national ; Atmo Grand Est = WMTS raster par agglomération (Nancy 2020) | non vérifié | non | non vérifié | 2020 au plus récent (Grand Est) | agglomération, raster | **à écarter** |
