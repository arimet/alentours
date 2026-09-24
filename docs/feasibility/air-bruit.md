# Faisabilité — Qualité de l'air et bruit

Étude jetable, appels réels faits le 24/09/2026 (vers 11 h, heure de Paris) avec `curl`, avec l'en-tête `Origin: https://example.github.io`.
Points de test :

- **Ségur** : 20 avenue de Ségur 75007 Paris (48.8507, 2.3095), INSEE 75107 (arrondissement) / 75056 (Paris)
- **Goussainville** 95190 (49.03, 2.47), INSEE 95280, près de Roissy-CDG
- **Saint-Véran** 05350 (44.70, 6.87), INSEE 05157, commune rurale de montagne

Les échantillons sont dans `samples/` (préfixes `air-` et `bruit-`).

---

## 1. Qualité de l'air

### 1a. API Atmo Data (admindata.atmo-france.org) — à éviter

- Il faut un compte, validé à la main : la doc OpenAPI (`/api/doc`) indique que « l'accès aux données requiert l'autorisation d'un administrateur », avec une inscription sur `/inscription-api`.
- Authentification : `POST /api/login` avec `{"username","password"}`, qui renvoie un JWT Bearer. Sans jeton, `GET /api/v2/data/indices/atmo` et `/api/feeds` renvoient `401 {"message":"JWT Token not found"}`. Un login bidon renvoie `401 "Identifiants invalides."`.
- **CORS : liste blanche.** La préflight OPTIONS ne renvoie **aucun** `Access-Control-Allow-Origin` pour `https://example.github.io`. Elle renvoie bien l'origine pour `https://www.atmo-france.org`, `https://admindata.atmo-france.org` et `http://localhost:3000`, donc ça marcherait en dev et pas en prod.
- **Clé exposable dans le front ? Non.** Ce n'est pas une clé d'API mais un identifiant et un mot de passe de compte. Les mettre dans un site statique revient à les publier.
- Quota : non vérifié (la FAQ PDF n'a pas été lue).
- Verdict : **inutile**, car le flux WFS du 1b donne les mêmes données sans compte.

### 1b. Indice ATMO quotidien par commune : WFS national sans clé ✅

Jeu data.gouv « Indice de la qualité de l'air quotidien par commune - indice ATMO », publié par Atmo France (id `6149925a2ff0ab6cebdd6fe8`), licence **ODbL**, mis à jour tous les jours. La prévision du jour et du lendemain est publiée vers 14 h.

- Endpoint : `https://data.atmo-france.org/geoserver/ind/ows` (GeoServer)
- Couche : **`ind:ind_atmo_2021`**. Il existe aussi `ind:ind_atmo`, `ind:ind_atmo_partition_week`, `ind:ind_atmo_tile`, `ind:ind_atmo_tile_2`, plus `alrt:alrt3j` (épisodes de pollution) et `emissions:emissions_{dpt,epci,regions}` sur `/geoserver/ows`. Leur contenu n'a pas été vérifié.
- Requête qui marche (paramètres encodés en URL) :

```
https://data.atmo-france.org/geoserver/ind/ows?service=WFS&version=2.0.0&request=GetFeature
  &typeNames=ind:ind_atmo_2021&outputFormat=application/json
  &CQL_FILTER=code_zone='75107' AND date_ech>='2026-09-23'
  &propertyName=code_zone,lib_zone,date_ech,date_maj,code_qual,lib_qual,coul_qual,code_no2,code_o3,code_pm10,code_pm25,code_so2,source
```

  ⚠️ Il faut encoder les quotes et `>` (`encodeURIComponent`). Sinon Tomcat renvoie une erreur 400 (« Invalid character found in the request target »).
- CORS : **`Access-Control-Allow-Origin: https://example.github.io`**. L'origine est renvoyée telle quelle, avec `allow-credentials: true`.
- Clé : aucune. Quota : non vérifié. Temps de réponse : **~0,14 s**, environ 600 o par commune.
- Champs utiles : `code_qual` (1 à 6), `lib_qual` (Bon / Moyen / Dégradé / Mauvais / Très mauvais / Extrêmement mauvais), `coul_qual` (couleur hexadécimale), les sous-indices `code_no2`, `code_o3`, `code_pm10`, `code_pm25`, `code_so2`, `date_ech` (jour concerné), `date_maj`, `source` (l'AASQA : Airparif, AtmoSud…), `type_zone=commune`.
- Résultats réels :
  - Paris 7e (75107) : 24/09 **2 « Moyen »**, source Airparif. Le code 75056 (Paris entier) existe aussi.
  - Goussainville (95280) : 24/09 **2 « Moyen »**, source Airparif.
  - Saint-Véran (05157) : 24/09 et 25/09 **3 « Dégradé »** (O3), source AtmoSud. La commune rurale est bien couverte.
- Couverture : `numberMatched=29138` communes pour le 24/09. La France compte environ 34 900 communes, donc certaines manquent. Lesquelles : non vérifié (le jeu exclut la Réunion et la Nouvelle-Calédonie).
- Historique : dans `ind_atmo_2021`, une requête sans filtre de date sur 75107 ne renvoie que le jour courant. Les « 365 derniers jours » annoncés sont dans le CSV complet (plusieurs millions de lignes, URL : même WFS avec `outputformat=csv`). Historique par WFS : non vérifié.
- Granularité réelle : **la commune**, pas l'adresse. Il y a une valeur par arrondissement à Paris.
- **Verdict : en direct.**

### 1b bis. Portails régionaux des AASQA

Ils existent (Airparif ArcGIS Hub, Atmo AURA, Clermont, Nantes… sur data.gouv), mais ils sont **tous redondants** avec le flux national 1b pour l'indice quotidien. Il n'y a aucune raison de brancher 18 sources. Pas creusé davantage.

### 1c. Moyennes annuelles NO2 / PM2.5 / PM10 / O3

**API Géod'air (LCSQA)** : `https://www.geodair.fr/api-ext`. Elle demande une inscription préalable avec un formulaire d'usage. Quota affiché sur data.gouv : **15 requêtes par heure**. Les moyennes annuelles par station sont disponibles. C'est inutilisable depuis un front : **backend ou pré-calcul uniquement**, et même en pré-calcul le quota est très bas. Les endpoints exacts n'ont pas été vérifiés (compte nécessaire).

**Fichiers « temps réel » E2 (LCSQA, data.gouv `5b98b648634f415309d52a50`, licence `lov2`)**, sans clé :

- `https://files.data.gouv.fr/ineris/lcsqa/concentrations-de-polluants-atmospheriques-reglementes/temps-reel/{AAAA}/FR_E2_{AAAA-MM-JJ}.csv`. Cette URL renvoie une 302 vers `ineris.s3.rbx.io.cloud.ovh.net`. Les années disponibles vont de 2021 à 2026.
- CORS : **aucun `Access-Control-Allow-Origin`** sur la 302 comme sur la réponse S3. Il faut donc passer par un pré-calcul.
- Fichier du 23/09/2026 : 12,6 Mo, 48 030 lignes de moyennes horaires brutes (non validées) pour 489 sites. Répartition : NO2 8 395 lignes, PM10 7 817, O3 6 692, PM2.5 6 139…
- Colonnes : `Date de début;Date de fin;Organisme;code zas;Zas;code site;nom site;type d'implantation;Polluant;type d'influence;…;valeur;valeur brute;unité de mesure;…;validité`. **Il n'y a pas de coordonnées.** Elles sont dans le « Dataset D » (métadonnées des stations) : xls de 8 Mo ou xml de 41 Mo, du 25/08/2026.
- Pré-calcul possible : télécharger 365 fichiers (environ 4,5 Go en streaming, sans rien stocker), faire la moyenne par site et par polluant, puis joindre les coordonnées du Dataset D. On obtient environ 500 sites × 4 polluants, soit **~100 Ko de JSON national** (estimation). Côté front, on affiche la station la plus proche avec sa distance et son type (urbaine / trafic / rurale).
- ⚠️ Ce sont des données **brutes non validées**. Ce n'est pas la moyenne annuelle réglementaire, qu'il faut indiquer comme telle. La validation (flux E1) n'a pas été trouvée en accès libre (non vérifié).

**Estimation modélisée « exposition » par commune, à l'échelle nationale : rien de prêt trouvé.**

- SDES / DiDo (API ouverte, `Access-Control-Allow-Origin: *`) : jeu `62792fb27ca0d5368edf67a4` « Qualité de l'air extérieur : indicateurs territoriaux », licence fr-lo. Il ne descend qu'à l'**agglomération**, sous forme de dépassements de normes, et s'arrête en 2023. Pas de données par commune.
- Airparif : modélisation annuelle NO2 / PM10 sur l'Île-de-France (ArcGIS Hub `data-airparif-asso.opendata.arcgis.com`, FeatureServer `exp_idf_idf_2017_no2_moyennne_annuelle`…). C'est **régional et ancien (2017)** dans ce qu'on a trouvé.
- Paris Data propose des concentrations moyennes à partir de 2015. **Non vérifié** : `opendata.paris.fr` n'était pas résolu en DNS depuis la machine de test.
- LCSQA / INERIS publient des cartes nationales de fond chaque année (bilan annuel). Un fichier téléchargeable par commune n'a pas été trouvé (non vérifié).
- Verdict : **V2**. On pourrait échantillonner une grille nationale si on en trouve une en accès libre.

---

## 2. Bruit

### 2a. Cartes de bruit stratégiques (CBS) : **absentes de la Géoplateforme**

- Recherche dans les GetCapabilities de `data.geopf.fr/wfs/ows` (5,2 Mo), `wms-v` et `wms-r` : **aucune couche CBS / Lden** (recherche sur bruit, lden, sonore, noise). Le WMTS a renvoyé une erreur 500 après 98 s.
- Les CBS sont **éclatées par département** sur **Géo-IDE** (serveurs MapServer du ministère), avec **un service par lot et par DDT**. On compte 425 jeux « carte de bruit stratégique » sur data.gouv, moissonnés depuis `catalogue.geo-ide.developpement-durable.gouv.fr`. Licence `lov2`.
- Format d'URL :
  `https://ogc.geo-ide.developpement-durable.gouv.fr/wxs?map=/opt/data/stack/mapfiles/1.4/org_{ORG}/{UUID}.internet.map&SERVICE=WMS|WFS`
- CORS : **`Access-Control-Allow-Origin: https://example.github.io`**, avec l'origine renvoyée telle quelle.
- Clé : aucune. Quota : non vérifié.
- Interrogation d'un point : un **WMS GetFeatureInfo** en `INFO_FORMAT=text/plain` fonctionne (`application/json` n'est pas supporté par ce MapServer ; GML non testé). Il faut parser un texte `clé = 'valeur'`. Le WFS avec BBOX marche aussi (en WFS 1.1.0 avec `urn:ogc:def:crs:EPSG::4326`, dans l'ordre lat,lon), mais il renvoie toute la géométrie : **248 Ko pour un seul polygone**. Le GFI est donc préférable.
- Schéma COVADIS : `legende` (borne basse de la classe en dB, par exemple 55 pour 55-60 et 65 pour 65-70), `indicetype` (LD = Lden, LN = Lnight), `typesource` (R = route, F = fer), `cbstype` (A = situation de référence, C = dépassement de valeur limite), `codinfra`, `annee`, `validedeb`, `validefin`.
- Résultats réels :
  - **Ségur (Paris)** : lot DRIEAT « CBS pour Paris » (`org_3954051/fr-120066022-orphan-63989501-…`), couches `N_BRUIT_ZBR_INFRA_R_A_LD_S_075` et `…_LN_S_075`. Résultat : **route, Lden classe 65 (65-70 dB), Lnight classe 55**, CBS 2022 valable jusqu'au 30/06/2027. Réponse en 0,8 s, 1 Ko.
  - **Goussainville** : lot DDT 95 « CBS 4ème échéance » (`org_38124/fr-120066022-orphan-ae67265e-…`, 19 couches interrogeables). Le seul résultat est `N_BRUIT_ZBR_INFRA_F_SNCF_B_95` (secteur affecté fer, type B), qui ne renvoie qu'un attribut `FID`. Aucune zone Lden route ou fer au point testé. Réponse en 4 s. Le bruit aérien est traité par le PEB (2b).
  - **Calvados (A29)**, pour valider le schéma : `ms:N_BRUIT_ZBR_R_A_LD_4EME_ECH_S_014` renvoie `legende=55`, `codinfra=A29`. GFI en 2 s, 456 o.
  - **Saint-Véran** : aucun jeu CBS n'est publié par la DDT 05 sur data.gouv (0 résultat). C'est attendu : les CBS ne couvrent que les **grandes infrastructures** (routes de plus de 3 M véhicules par an, voies ferrées de plus de 30 000 trains par an) et les **agglomérations de plus de 100 000 habitants**.
- **Couverture limitée : l'absence de résultat ne veut pas dire « calme »** mais « non cartographié ». Il faut le dire à l'utilisateur.
- Autre limite : les zones cartographiées sont au niveau du point géocodé, qui tombe souvent sur la chaussée, pas en façade. Il faut formuler par exemple « l'adresse est dans la zone 65-70 dB Lden ».
- Les CBS des agglomérations (Bruitparif, Métropole du Grand Paris, Toulouse…) sont diffusées à part, parfois en TIFF. Non intégrées ici.
- Données AEE (`noise.discomap.eea.europa.eu`, ImageServer `Noise/mosaic_roads_day`…, CORS OK) : `NoData` à Paris et à Goussainville, et une valeur incohérente de 12 à Saint-Véran. **Inexploitable.**
- **Verdict : en direct** via GFI sur Géo-IDE, mais avec un **index pré-calculé** département → URL du service et couches, tiré de l'API data.gouv (organisation DDT, `q=bruit`). Sans cet index, il n'y a aucun point d'entrée national. Le schéma varie selon la génération : casse des champs (`LEGENDE` / `legende`), noms de couches et 3e / 4e échéance mélangées. Il faut donc filtrer sur la 4e échéance. Il reste du travail d'inventaire pour les ~100 départements, d'où un statut **« en direct + index », qui peut basculer en V2 si l'inventaire est trop sale**.

### 2b. Plans d'exposition au bruit (PEB) des aéroports : Géoplateforme ✅

- WFS `data.geopf.fr/wfs/ows` : la seule couche est **`dgac_peb_arrete_wfs:dgac_peb_arrete_wfs`**. Ce sont **des points (un par aérodrome, 224 au total)** avec `nom`, `oaci` et `arrete_peb` (URL du PDF de l'arrêté). Ce ne sont **pas les zones**. Réponse en 0,24 s, 66 Ko pour l'ensemble.
- Les zones sont sur le **WMS vecteur** `https://data.geopf.fr/wms-v/ows`, couche **`dgac_peb_plan_wmsv`**. Il y a aussi `dgac_pgs_plan_wmsv` (plans de gêne sonore), `dgac_psa_plan_wmsv` et les `*_arrete_wmsv`. Métadonnées CSW `DGAC_Plan_d_Exposition_au_Bruit_PEB`, mises à jour le 16/12/2025. Licence non vérifiée.
- Test point dans polygone avec **GetFeatureInfo** :

```
https://data.geopf.fr/wms-v/ows?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo
  &LAYERS=dgac_peb_plan_wmsv&QUERY_LAYERS=dgac_peb_plan_wmsv&STYLES=&CRS=EPSG:4326
  &BBOX={lat-0.05},{lon-0.05},{lat+0.05},{lon+0.05}&WIDTH=1001&HEIGHT=1001&I=500&J=500
  &INFO_FORMAT=application/json&FEATURE_COUNT=5
```

  ⚠️ **Piège** : avec une BBOX minuscule (±0,001°), la réponse est **toujours vide**, même sur la piste de CDG (probablement une limite d'échelle sur le style). Avec ±0,05° et 1001 px (environ 10 m par pixel), ça marche.
- CORS : **`Access-Control-Allow-Origin: *`**. Clé : aucune. Quota Géoplateforme : non vérifié. Temps de réponse : 0,16 à 1,5 s.
- Réponse : du GeoJSON avec la géométrie du polygone (environ 7,8 Ko). Champs : `zone` (A / B / C / D), `indldenext` et `indldenint` (bornes Lden de la zone), `code_oaci`, `nom`, `date_arret`, `producteur`, `ref_doc` (PDF).
- Résultats réels :
  - **Goussainville** : PEB de **CDG, zone C (Lden 56-65)**, arrêté du 03/04/2007. Également dans le PGS de CDG (`dgac_pgs_plan_wmsv`), **zone 3 (Lden 55-65)**, arrêté du 11/12/2013.
  - **Ségur** et **Saint-Véran** : `features: []` (hors PEB, comme attendu).
- **Verdict : en direct.**

---

## Tableau récapitulatif

| Donnée | Endpoint | CORS | Clé | Quota | Fraîcheur | Précision | Verdict | Taille estimée si pré-calculée |
|---|---|---|---|---|---|---|---|---|
| Indice ATMO du jour + J+1 (API Atmo Data) | `admindata.atmo-france.org/api/v2/data/indices/atmo` | Liste blanche (github.io refusé ; localhost accepté) | **Compte + mot de passe (JWT)**, validés par un admin | non vérifié | quotidienne | commune | backend nécessaire (inutile, voir ligne suivante) | — |
| Indice ATMO du jour + J+1 (WFS national) | `data.atmo-france.org/geoserver/ind/ows`, couche `ind:ind_atmo_2021`, `CQL_FILTER=code_zone='{INSEE}'` | ✅ origine renvoyée (`https://example.github.io`) | non | non vérifié | quotidienne (publication ~14 h, J et J+1) | commune (29 138 communes le 24/09) | **en direct** | — (CSV complet : plusieurs millions de lignes, inutile) |
| Moyennes annuelles NO2 / PM2.5 / PM10 / O3 par station (API Géod'air) | `geodair.fr/api-ext` | non vérifié | **inscription** | **15 requêtes/h** | horaire → annuelle | station | backend nécessaire | — |
| Moyennes annuelles par station (fichiers E2 bruts) | `files.data.gouv.fr/ineris/lcsqa/…/temps-reel/{AAAA}/FR_E2_{date}.csv` + Dataset D (coordonnées) | ❌ aucun ACAO | non | aucun constaté | quotidienne, horaire, **non validée** | station (~489 sites), la plus proche | **pré-calculée** | ~100 Ko JSON national (estimation) ; 4,5 Go à lire au build |
| Exposition modélisée par commune (annuelle) | aucune source nationale trouvée (DiDo = agglomération ; Airparif 2017 = IDF seule) | DiDo : `*` | non | non vérifié | annuelle, dernier millésime 2023 (DiDo) | agglomération | **V2** | non vérifié |
| Bruit route / fer, CBS Lden / Ln | Géo-IDE `ogc.geo-ide.developpement-durable.gouv.fr/wxs?map=…/org_{ORG}/{UUID}.internet.map`, WMS GFI `text/plain`, couches `N_BRUIT_ZBR_INFRA_R_A_LD_S_{dep}`… (**absentes de la Géoplateforme**) | ✅ origine renvoyée | non | non vérifié | CBS 4e échéance (2022-2023), valables jusqu'à 2027 | classe de 5 dB ; **grandes infrastructures et agglomérations de plus de 100 000 habitants seulement** | **en direct + index pré-calculé** (V2 si l'inventaire des ~100 départements est trop hétérogène) | index département → services : ~50-100 Ko (estimation) |
| Bruit aérien, PEB zones A / B / C / D | `data.geopf.fr/wms-v/ows`, couche `dgac_peb_plan_wmsv`, GetFeatureInfo JSON (BBOX ±0,05°) | ✅ `*` | non | non vérifié | métadonnées au 16/12/2025 ; arrêtés d'âges variables (CDG : 2007) | polygone de zone (point dans polygone) | **en direct** | — |
| Bruit aérien, PGS (plans de gêne sonore) | `data.geopf.fr/wms-v/ows`, couche `dgac_pgs_plan_wmsv` | ✅ `*` | non | non vérifié | CDG : 2013 (mise à jour 2018) | polygone de zone | **en direct** | — |
| Liste des arrêtés PEB (points d'aérodromes) | `data.geopf.fr/wfs/ows`, `dgac_peb_arrete_wfs:dgac_peb_arrete_wfs` | non vérifié (Géoplateforme : `*` sur le WMS) | non | non vérifié | — | point par aérodrome (224) | en direct (secondaire) | 66 Ko au total |
| Bruit (AEE) | `noise.discomap.eea.europa.eu/…/Noise/mosaic_roads_day/ImageServer/identify` | ✅ | non | non vérifié | ancienne | grille 10 m | écarté (NoData à Paris) | — |
