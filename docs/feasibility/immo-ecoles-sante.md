# Faisabilité : immobilier (DVF), écoles, santé, transports

Étude du 24/09/2026. Tous les appels ont été faits avec `curl` (ou Python `urllib`) depuis un poste local, autour de :

- **Paris** : 20 avenue de Ségur 75007, géocodé par `data.geopf.fr/geocodage` → lon 2.308628, lat 48.850699, INSEE `75107` (arrondissement), parcelle `75107000BQ0003` (section `75107000BQ`).
- **Rural** : Saint-Véran 05350, lon 6.861073, lat 44.704139, INSEE `05157`, parcelle `05157000AB1163` (section `05157000AB`).

On a testé le CORS avec `-H "Origin: https://example.github.io"` et on reporte l'en-tête `Access-Control-Allow-Origin` tel que renvoyé. Les temps de réponse (`%{time_total}`) sont ceux mesurés depuis la France, sur une seule requête : ce sont des ordres de grandeur, pas un benchmark. Les échantillons sont dans `samples/` (tous < 50 KB, tronqués quand c'était nécessaire).

---

## 1. Immobilier : DVF (DGFiP / Etalab)

### Conditions communes à toutes les sources DVF

- **Licence** : Licence Ouverte v2.0 (`lov2` sur data.gouv), **avec deux obligations légales** reprises dans la description du jeu DGFiP :
  - pas de ré-identification des personnes (art. R112 A-3 du LPF) ;
  - **les données réutilisées ne doivent pas être indexables par les moteurs de recherche externes.**
  - Conséquence pour un site statique : afficher des **agrégats** (médianes par commune ou section), c'est sans risque. Si on publie des mutations individuelles (adresse + prix + date) dans des JSON servis par GitHub Pages, il faut au minimum un `robots.txt` et `noindex` sur ces fichiers. **À éviter en V1.**
- **Exclusions** : « à l'exception de l'Alsace, de la Moselle et de Mayotte » (texte DGFiP). On le vérifie dans les stats : les départements `57`, `67`, `68` et `976` sont présents, mais toutes leurs valeurs sont vides.
- **Période couverte** : janvier 2021 → décembre 2025 (10 semestres). La date de mutation la plus récente trouvée dans `75107.csv` est le 2025-12-31. Il n'y a pas encore de données 2026. La dernière publication date du 17/07/2026 (fichier unique « DVF janvier 2021 - décembre 2025 »), et le répertoire geo-dvf `latest` date du 18/05/2026.
- **Paris** : les stats n'existent qu'au niveau de l'arrondissement. `75056` (Paris) est vide dans les stats et `75107` est rempli. Attention : l'API Carto cadastre renvoie `code_insee: 75056` pour Paris, mais l'`idu` de parcelle contient bien `75107`. Il faut donc prendre le code de l'arrondissement (le `citycode` du géocodeur est déjà `75107`).

### 1a. Statistiques DVF pré-agrégées (data.gouv) : **la bonne source**

Jeu : https://www.data.gouv.fr/fr/datasets/statistiques-dvf/ (id `64998de5926530ebcecc7b15`, publié par data.gouv.fr, maj 17/07/2026). Il contient le nombre de ventes et la moyenne et la médiane du prix au m², pour les types appartement / maison / appartement+maison / local, à toutes les échelles : nation, département, EPCI, commune et **section cadastrale**. Méthodologie : uniquement les ventes, VEFA et adjudications ; uniquement les mutations mono-bien (dépendances exclues) ; prix/m² = valeur foncière / surface bâtie ; prix/m² > 100 k€ exclu.

| Ressource | URL | Taille |
|---|---|---|
| Stats période entière (5 ans) | `https://data-pipeline-open.s3.sbg.io.cloud.ovh.net/dvf/stats_whole_period.csv` | 30,7 MB, 504 868 lignes (39 162 communes, 464 250 sections) |
| Stats mensuelles | `https://data-pipeline-open.s3.sbg.io.cloud.ovh.net/dvf/stats_dvf.csv` | 276,6 MB |

Le bucket S3 renvoie `Access-Control-Allow-Origin: *`, mais on ne va pas faire télécharger 30 MB au navigateur.

**API tabulaire data.gouv (en direct, CORS OK)** :

```
GET https://tabular-api.data.gouv.fr/api/resources/851d342f-9c96-41c1-924a-11a7a7aae8a6/data/?code_geo__exact=75107
GET https://tabular-api.data.gouv.fr/api/resources/851d342f-9c96-41c1-924a-11a7a7aae8a6/data/?code_geo__exact=05157000AB   (section)
GET https://tabular-api.data.gouv.fr/api/resources/03fba98d-885b-43c0-8986-d299cabc29da/data/?code_geo__exact=05157&page_size=50  (mensuel)
```

- CORS : `access-control-allow-origin: *`. Pas de clé. Temps de réponse : 0,17–0,49 s. Réponses servies avec `cache-control: public` et `x-cache-status: HIT`. Aucun en-tête de quota n'est renvoyé ; le quota officiel n'a **pas été vérifié**.
- Champs : `nb_ventes_whole_{appartement,maison,apt_maison,local}`, `moy_prix_m2_whole_*`, `med_prix_m2_whole_*`, `code_parent`, `echelle_geo`. Pour le mensuel : `annee_mois`, `nb_ventes_*`, `med_prix_m2_*`.
- Valeurs réelles :
  - **Paris 7e** : 4 611 ventes d'appartements, médiane 14 312 €/m² ; 18 maisons, médiane 25 438 €/m².
  - **Saint-Véran** : 26 appartements à 2 700 €/m² ; 11 maisons à 3 745 €/m².
  - Section `05157000AB` : 20 appartements à 2 700 €/m².
  - Section `75107000BQ` (celle de l'adresse Ségur) : **vide**. Beaucoup de sections sont trop petites : seules 255 886 sections sur 464 250 ont au moins une valeur.
- Limite : **pas de médiane par année**. On a seulement la période entière ou des médianes mensuelles, et une médiane annuelle ne se déduit pas de médianes mensuelles. Pour une série annuelle exacte, il faut recalculer à partir des données brutes (§1c).

### 1b. `dvf-api.data.gouv.fr` (backend de explore.data.gouv.fr/immobilier)

On a trouvé ces URLs dans le bundle JS de https://explore.data.gouv.fr/fr/immobilier. **Ce n'est pas une API documentée** : elle peut changer sans préavis.

| Endpoint | Code | Temps | Contenu |
|---|---|---|---|
| `https://dvf-api.data.gouv.fr/commune/75107` | 200 | 0,17 s | 60 mois (2021-01 → 2025-12), clés courtes `a`/`m_a` (appartements : nb, médiane), `m`/`m_m` (maisons), `am`, `l` |
| `https://dvf-api.data.gouv.fr/section/05157000AB` | 200 | 0,09 s | idem, pour une section |
| `https://dvf-api.data.gouv.fr/commune/05157/sections` | 200 | – | stats de toutes les sections de la commune, sur la période entière |
| `https://dvf-api.data.gouv.fr/mutations/05157/000AB` | 200 | 0,21 s | mutations individuelles de la section (165 KB) |
| `https://dvf-api.data.gouv.fr/distribution/05157` | 200 | 0,12 s | histogramme des prix (vide ici) |
| `https://dvf-api.data.gouv.fr/dvf?commune=05157` | **502** | – | en panne au moment du test |

CORS : `access-control-allow-origin: *`. Pas de clé. Quota non vérifié.

### 1c. geo-dvf brut (données géolocalisées Etalab)

- Index : https://files.data.gouv.fr/geo-dvf/latest/csv/ → années `2021` à `2025`. Chaque année contient `full.csv.gz`, `departements/<dep>.csv.gz` et `communes/<dep>/<insee>.csv`.
- Tailles : `2025/full.csv.gz` = 98,3 MB, `2021/full.csv.gz` = 122,3 MB. Le fichier unique 2021-2025 (`static.data.gouv.fr/.../dvf.csv.gz`) fait 523 MB. Par département (2025) : de 0,36 MB (04) à environ 2,3 MB (13). `communes/75/75107.csv` (2025) = 622 KB, 3 260 lignes. Saint-Véran : de 35 à 105 lignes par an.
- Colonnes : `id_mutation, date_mutation, nature_mutation, valeur_fonciere, adresse_*, code_commune, id_parcelle, lot1_surface_carrez…, type_local, surface_reelle_bati, nombre_pieces_principales, surface_terrain, longitude, latitude`.
- **CORS : aucun.** `files.data.gouv.fr` répond `302` vers `geo-dvf.s3.sbg.io.cloud.ovh.net`, qui ne renvoie aucun en-tête `Access-Control-*` (le preflight `OPTIONS` donne `403`). Ces fichiers sont donc inutilisables depuis le navigateur : ils servent uniquement au script Node de pré-calcul.

### 1d. APIs historiques

- `https://app.dvf.etalab.gouv.fr/api/mutations3/05157/000AB` : **fonctionne encore** (200, 0,17 s, `access-control-allow-origin: *`). Le JSON est servi avec `content-type: text/html` et contient les mutations 2021-2025 (147 pour cette section). C'est l'ancienne application, remplacée par explore.data.gouv.fr. **Il ne faut pas s'appuyer dessus.** Échantillon tronqué : `samples/dvf_app_mutations3_05157_000AB.json`.
- `https://api.cquest.org/dvf?...` : **502 Bad Gateway**, deux essais (3,2 s et 2,3 s). L'API est considérée comme morte.

### Verdict DVF

- **V1, en direct** : médianes 5 ans par commune et par section via l'API tabulaire. Source stable (ressource data.gouv officielle), CORS `*`, moins de 0,5 s.
- **Si on veut une série annuelle** : pré-calcul Node à partir de `geo-dvf/latest/csv/<année>/departements/*.csv.gz` (environ 500 MB téléchargés au build, rien de versionné), en reprenant la méthodologie Etalab. Estimation mesurée : un JSON minifié « période entière » contenant uniquement nb et médiane appartement/maison fait 3,1 MB pour 33 238 communes et 22,8 MB pour 255 886 sections. Par année, on estime ×4 à ×5, donc **environ 12–15 MB (communes) et environ 80–100 MB (sections)**, découpés par département.

---

## 2. Écoles : annuaire de l'éducation (Opendatasoft)

- Jeu : `fr-en-annuaire-education` sur data.education.gouv.fr. Licence Ouverte v2.0 (Etalab), éditeur DNE - Ministère de l'Éducation nationale.
- Fraîcheur : `modified` et `data_processed` = **2026-09-24T05:01**, donc mis à jour chaque jour. 68 572 enregistrements : 68 570 `OUVERT` et 2 `A FERMER`, ce qui veut dire que les établissements fermés ne sont pas dans ce jeu.
- Répartition des `type_etablissement` : Ecole 48 352, Collège 9 182, Lycée 5 644, EREA, Médico-social, etc.

Requête qui fonctionne (Explore v2.1, ODSQL) :

```
GET https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-annuaire-education/records
  ?select=identifiant_de_l_etablissement,nom_etablissement,type_etablissement,statut_public_prive,libelle_nature,adresse_1,code_postal,nom_commune,latitude,longitude,distance(position, geom'POINT(2.308628 48.850699)') as dist
  &where=type_etablissement='Collège' AND within_distance(position, geom'POINT(2.308628 48.850699)', 60km)
  &order_by=dist&limit=3
```

- CORS : `access-control-allow-origin: *`. Pas de clé.
- Quota anonyme observé : `x-ratelimit-limit: 50000` par jour, remise à zéro à minuit UTC. On ne sait pas si ce compteur est par IP ou global au domaine (**non vérifié**).
- Temps de réponse : 0,13–0,21 s.
- Pièges :
  - `distance()` est interdit dans `order_by` avec `group_by`.
  - Un `where … etat='OUVERT'` placé dans la même requête que la géo a renvoyé 400. Ce filtre est de toute façon inutile, puisque tout le jeu est ouvert.
  - Les « Section d'enseignement général et professionnel adapté » (SEGPA) et les « Section d'enseignement professionnel » sont comptées comme Collège ou Lycée. Il faut les filtrer avec `libelle_nature NOT LIKE 'SECTION%'`.
- Résultats :
  - **Ségur** : école privée Jean-Paul II à 227 m ; école publique Duquesne à 344 m ; collège Victor Duruy (public) à 489 m ; lycée Victor Duruy (public) à 489 m ; Sainte-Jeanne-Élisabeth (privé) à 575 m.
  - **Saint-Véran** : école élémentaire publique de Saint-Véran à 697 m ; collège des Hautes Vallées (Guillestre) à 17,0 km ; lycée polyvalent d'altitude (Briançon) à 27,9 km.
- Champs utiles : `statut_public_prive` (Public/Privé), `type_contrat_prive`, `ecole_maternelle`, `ecole_elementaire`, `restauration`, `appartenance_education_prioritaire`, `precision_localisation`.

**Verdict : en direct.**

---

## 3. Santé

### 3a. Pharmacies et urgences : FINESS (t-finess) via l'API tabulaire

- Jeu : « Référentiel Finess (t_finess) » publié par Atlasanté (https://www.data.gouv.fr/fr/datasets/referentiel-finess-t-finess/). Ressource `t-finess.csv` : 244 MB, dernière maj le 2026-05-19, `date_extract_finess` le 2026-05-04. Licence `fr-lo`, fréquence déclarée bimensuelle.
- La ressource est indexée dans l'API tabulaire (222 340 lignes, dont 157 147 `ACTUEL`), avec `geoloc_4326_lat` et `geoloc_4326_long`, `categ_code` / `categ_lib`, `san_urg` (booléen), `geoloc_precision`, `com_code`.
- L'API tabulaire ne fait pas de requête géographique, mais elle accepte des bornes numériques. On fait donc un **filtre bbox** et on trie par distance côté client :

```
GET https://tabular-api.data.gouv.fr/api/resources/796dfff7-cf54-493a-a0a7-ba3c2024c6f3/data/
  ?etat__exact=ACTUEL&type__exact=ET&categ_code__exact=620        (620 = Pharmacie d'Officine ; ou san_urg__exact=true)
  &geoloc_4326_lat__greater=48.8447&geoloc_4326_lat__less=48.8567
  &geoloc_4326_long__greater=2.2996&geoloc_4326_long__less=2.3176
  &columns=finess,rs,categ_lib,adresse_num_voie,adresse_type_voie,adresse_nom_voie,adresse_code_postal,com_code,geoloc_4326_lat,geoloc_4326_long&page_size=50
```

- CORS : `access-control-allow-origin: *`. Pas de clé. Temps de réponse : 0,23–0,35 s.
- Volumétrie au niveau national : 20 003 pharmacies `ACTUEL`, 674 établissements `san_urg=true`.
- Résultats :
  - **Ségur** : pharmacie Mesnard à 212 m ; urgences les plus proches : Necker à 694 m (**pédiatrique**), Saint-Joseph à 2,3 km, Cochin à 2,7 km, HEGP à 2,8 km.
  - **Saint-Véran** : pharmacie d'Aiguilles à 8,7 km ; urgences : CH de Briançon à 28,8 km, CH d'Embrun à 33,2 km, puis « ANTENNE SMUR MODANE ».
- Pièges :
  - `san_urg` inclut les SMUR et les urgences pédiatriques. Ce n'est pas la même chose qu'« accueil des urgences adultes ». Il faudrait croiser avec le jeu **FINESS - Activités** de l'ANS (quotidien, JSON.gz de 58 MB), ce qui n'a **pas été vérifié**.
  - La fraîcheur réelle de t-finess est d'environ 4 mois. Le mot « bimensuel » dans les métadonnées n'est pas confirmé par les dates.

On a aussi trouvé :

- l'extraction FINESS géolocalisée du Ministère (`etalab-cs1100507`, 47,9 MB, au 04/05/2026, `fr-lo`) : non indexée dans l'API tabulaire, donc utilisable seulement en pré-calcul ;
- le miroir Opendatasoft `healthref-france-finess` sur public.opendatasoft.com (champ géo `coord`, **mais maj 2025-12-10**, donc périmé).

**Verdict : en direct** (bbox dans l'API tabulaire). En repli, un pré-calcul est très léger : 20 k pharmacies + environ 700 urgences, soit **environ 3 MB** pour toute la France.

### 3b. Médecins généralistes

**Option A : miroir Opendatasoft de l'annuaire santé Ameli (géolocalisé), en direct**

- `https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/annuaire-des-professionnels-de-sante/records`
- Source déclarée : Caisse nationale de l'Assurance Maladie. Licence Open License v1.0. `modified` = 2026-06-25. 1 506 287 enregistrements, dont 509 042 lignes « Médecin généraliste ». Il y a **une ligne par créneau horaire ou jour**, il faut donc dédupliquer côté client sur (`nom`, `adresse`).
- CORS : `access-control-allow-origin: *`. Pas de clé. Quota observé : `x-ratelimit-limit: 10000000` par jour (probablement global au domaine, **non vérifié**). Temps de réponse : 0,26–0,30 s.
- Requête : `where=libelle_profession='Médecin généraliste' AND within_distance(coordonnees, geom'POINT(lon lat)', 1km)&order_by=distance(coordonnees, geom'POINT(lon lat)')&limit=40`.
- Résultats :
  - **Ségur** : 332 lignes à moins de 1 km ; le plus proche est à 49 m (47 av. de Ségur, « Secteur 2 »).
  - **Saint-Véran** : cabinet médical du Queyras à Aiguilles, à 8,5 km.
- Champs : `nom`, `adresse`, `code_commune`, `convention` (secteur 1/2, non conventionné), `nature_exercice`, `coordonnees`.
- Risque : c'est un **miroir tiers** (Opendatasoft), pas la CNAM. Sa pérennité n'est pas garantie, et sa fraîcheur (environ 3 mois) dépend d'Opendatasoft.

**Option B : RPPS (Annuaire Santé, ANS) via l'API tabulaire, sans coordonnées géographiques**

- Jeu `69025e6c73d1f9b79ca3c365`, ressource `ps-libreacces-personne-activite.txt` : 821 MB, maj le **2026-09-23** (quotidien), `lov2`. L'API tabulaire l'a réindexé le même jour (2 291 290 lignes).
- `GET https://tabular-api.data.gouv.fr/api/resources/fffda7e9-0ea2-4c35-bba0-4496f3af935d/data/?Code postal (coord. structure)__exact=75007&Code profession__exact=10&Code savoir-faire__in=SM53,SM54` → 77 lignes en 0,86 s. Les généralistes correspondent à SM53 (« Spécialiste en Médecine Générale ») **et** SM54. Le `__groupby` est refusé (400) sur cette ressource.
- **Aucune latitude ni longitude** : on a seulement l'adresse et le code commune. Le code commune des libéraux parisiens vaut `75056` (et non l'arrondissement). Pour Saint-Véran (05350), il n'y a aucun généraliste.
- Volumétrie : 88 869 activités GENR01 (activité standard de soin) avec SM53/54, dont 54 546 libérales.
- Utilisation : **pré-calcul** avec géocodage par lot via BAN (`/search/csv`). Estimation : environ 55–90 k lignes × environ 150 B, soit **environ 8–14 MB** pour toute la France, découpés par département.

**Verdict généralistes : en direct via le miroir ODS pour la V1.** En production, ou si le miroir disparaît, on bascule vers un pré-calcul RPPS + BAN d'environ 10 MB.

---

## 4. Transports : transport.data.gouv.fr (vérification légère)

- **API** `GET https://transport.data.gouv.fr/api/gtfs-stops?south=…&north=…&west=…&east=…` (paramètres lus dans `/api/openapi`). Elle renvoie un GeoJSON FeatureCollection avec `stop_name`, `stop_id`, `location_type`, `dataset_title` et `dataset_id`.
  - CORS : `access-control-allow-origin: *`. Pas de clé. Quota non vérifié.
  - **Ségur** (bbox d'environ 600 m) : 7 arrêts IDFM, le plus proche étant Breteuil à 186 m ; 0,15 s.
  - **Saint-Véran** (bbox d'environ 22 × 22 km) : 231 arrêts, 80 KB, 0,17 s. Le plus proche est « La Madeleine » à 38 m, mais il appartient au **réseau scolaire ZOU !** et aux **navettes saisonnières**.
  - Une bbox de la taille de Paris renvoie 9 284 arrêts (3,5 MB, 0,49 s) : il faut garder des bbox petites.
  - L'API ne donne **ni les lignes, ni les fréquences, ni la saisonnalité**. La présence d'un arrêt ne veut pas dire qu'il y a un service utile.
- Export national : jeu « Arrêts de transport en France » (`651d2ece3af956b8dd0d7648`), `gtfs_stops_france_export_2026-01-13.csv`, 437 MB, `lov2`, publication « expérimentale » et ponctuelle (dernière le 13/01/2026).

**Verdict : en direct** pour afficher « arrêts à proximité ». Si on veut les lignes et les fréquences, il faut un pré-calcul à partir des GTFS eux-mêmes, hors périmètre.

---

## Tableau récapitulatif

| Donnée | Endpoint/URL | CORS | Clé | Quota | Fraîcheur | Précision | Verdict | Taille estimée si pré-calculée |
|---|---|---|---|---|---|---|---|---|
| DVF médiane €/m² + nb ventes, 5 ans cumulés | `tabular-api.data.gouv.fr/api/resources/851d342f-9c96-41c1-924a-11a7a7aae8a6/data/?code_geo__exact=<insee\|section>` | `*` | non | non vérifié (pas d'en-tête) | 2021-01 → 2025-12, publié le 17/07/2026 (semestriel) | commune (arrondissement à Paris) et section ; hors 57/67/68/976 | **en direct** | 3,1 MB (communes) + 22,8 MB (sections), mesuré |
| DVF série mensuelle | `dvf-api.data.gouv.fr/commune/<insee>` ou `/section/<code>` (non documentée) ; ou tabulaire `03fba98d-…` | `*` | non | non vérifié | idem | commune / section, par mois | **en direct** (API non documentée, fragile) | – |
| DVF médiane **par année** | `files.data.gouv.fr/geo-dvf/latest/csv/<année>/departements/<dep>.csv.gz` | **aucun** (302 vers S3 sans ACAO) | non | – | idem | mutation géolocalisée | **pré-calculée** | environ 12–15 MB communes, environ 80–100 MB avec sections (estimation) |
| DVF mutations individuelles | `dvf-api.data.gouv.fr/mutations/<insee>/<section>` ; `app.dvf.etalab.gouv.fr/api/mutations3/…` (ancienne) | `*` | non | non vérifié | idem | parcelle | déconseillé (obligation de non-indexation) | – |
| api.cquest.org/dvf | `api.cquest.org/dvf` | – | – | – | **502, morte** | – | abandon | – |
| Écoles / collèges / lycées + public/privé | `data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-annuaire-education/records` + `within_distance` | `*` | non | 50 000/jour (observé) | quotidienne (24/09/2026) | point géolocalisé (`precision_localisation`) | **en direct** | – |
| Pharmacies | tabulaire `796dfff7-cf54-493a-a0a7-ba3c2024c6f3` avec `categ_code__exact=620` + bbox lat/lon | `*` | non | non vérifié | extraction du 04/05/2026 (environ 4 mois) | adresse géocodée BAN | **en direct** | environ 2–3 MB (20 k lignes) |
| Urgences | même ressource, `san_urg__exact=true` + bbox | `*` | non | non vérifié | idem | établissement ; inclut SMUR et pédiatrie | **en direct** (filtrage à affiner) | environ 0,1 MB (674 lignes) |
| Médecins généralistes (géolocalisés) | `public.opendatasoft.com/.../annuaire-des-professionnels-de-sante/records` + `within_distance` | `*` | non | 10 M/jour (observé, domaine) | 25/06/2026 (miroir tiers) | adresse du cabinet géolocalisée | **en direct** (miroir tiers, risque) | – |
| Médecins généralistes (RPPS officiel) | tabulaire `fffda7e9-0ea2-4c35-bba0-4496f3af935d` (`Code savoir-faire__in=SM53,SM54`) | `*` | non | non vérifié | quotidienne (23/09/2026) | adresse seule, **pas de coordonnées** | **pré-calculée** (géocodage BAN) | environ 8–14 MB |
| Arrêts de transport | `transport.data.gouv.fr/api/gtfs-stops?south=&north=&west=&east=` | `*` | non | non vérifié | selon les GTFS (non vérifié) | point d'arrêt GTFS, sans lignes ni fréquences | **en direct** | export national 437 MB brut ; environ 30–60 MB en JSON par département (non vérifié) |
