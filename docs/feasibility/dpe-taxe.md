# Faisabilité : DPE (ADEME) et taux de taxe foncière (DGFiP)

Étude menée le 24/09/2026 avec de vrais appels `curl` (environ 30 appels réseau). Adresses de test :

- **35 rue Joseph Mougin, 54000 Nancy** : le géocodeur IGN (`data.geopf.fr/geocodage/search`) renvoie l'id BAN **`54395_2905_00035`**. L'id `54395_4910_00035` proposé dans la consigne est **faux**. Coordonnées : 48.703193, 6.16209. INSEE : 54395.
- **20 avenue de Ségur, 75007 Paris** : id BAN `75107_8909_00020`, coordonnées 48.850699, 2.308628, INSEE 75107 (arrondissement).

Les échantillons sont dans `docs/feasibility/samples/` (`dpe-*` et `taxe-*`, tous < 8 Ko).

---

## 1. DPE logements existants (depuis juillet 2021), ADEME

### Jeu de données

- Page : https://data.ademe.fr/datasets/dpe03existant
- API data-fair : `https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/…` (slug `dpe03existant`, id interne `meg-83tjwtg8dyz4vv7h1dqe`)
- **15 653 655 lignes** (1 ligne = 1 DPE), 230 colonnes.
- Licence : **Licence Ouverte / Open Licence v2.0** (Etalab).
- Fraîcheur : `dataUpdatedAt` = **2026-09-23T19:14Z**. Le DPE le plus récent a été établi le **2026-09-21** (tri `-date_etablissement_dpe`). Le jeu est donc à J-3, mais la fréquence de mise à jour n'est pas écrite dans les métadonnées : non vérifié (probablement hebdomadaire).
- Volumes : dép. 54 = 181 044 DPE ; dép. 75 = 846 835 ; commune de Nancy = 53 742.

### Champs utiles (vérifiés dans le schéma et les réponses)

| Champ | Contenu |
|---|---|
| `numero_dpe` | identifiant du DPE |
| `date_etablissement_dpe` | `AAAA-MM-JJ` |
| `etiquette_dpe`, `etiquette_ges` | A à G |
| `type_batiment` | `appartement` / `maison` / `immeuble` |
| `surface_habitable_logement` (et `surface_habitable_immeuble`) | m² |
| `periode_construction` | ex. `1978-1982` |
| `identifiant_ban` | id BAN « clé d'interopérabilité » (`54395_2905_00035`), pas l'UUID `banId` |
| `adresse_ban`, `nom_rue_ban`, `code_insee_ban`, `code_postal_ban`, `code_departement_ban` | adresse normalisée BAN |
| `score_ban`, `statut_geocodage` | qualité du géocodage |
| `_geopoint` | `"lat,lon"` (WGS84) |
| `numero_dpe_remplace`, `numero_dpe_immeuble_associe` | chaînage des DPE remplacés / DPE d'immeuble |
| `adresse_brut` | adresse saisie par le diagnostiqueur |

### Requêtes testées (toutes en HTTP 200, 110–140 ms)

**Par id BAN** (sample `dpe-ban-id-nancy-mougin.json`) :
```
GET /data-fair/api/v1/datasets/dpe03existant/lines?qs=identifiant_ban:"54395_2905_00035"&select=numero_dpe,date_etablissement_dpe,etiquette_dpe,etiquette_ges,type_batiment,surface_habitable_logement,adresse_ban,identifiant_ban&size=20&sort=-date_etablissement_dpe
```
Résultat : 2 DPE. Un DPE `immeuble` du 2026-04-30 (D/B) et un DPE `appartement` de 84,4 m² du 2025-10-10 (D/B). Paris, 20 av. de Ségur : **0 résultat** (`dpe-ban-id-paris-segur.json`).

**Par distance** (`geo_distance=lon,lat,rayon`, **longitude en premier**) (samples `dpe-geo50m-*.json`) :
```
GET …/lines?geo_distance=6.16209,48.703193,50m&select=…&size=50&sort=-date_etablissement_dpe
```
Nancy : 18 DPE à moins de 50 m (n° 35, 37, 39ter, 54, 56). Paris : 15 DPE (n° 43, 45, 47… mais voir l'écueil n° 1).

**Par bbox** : `…/lines?bbox=6.1615,48.7029,6.1627,48.7035&size=0` renvoie `{"total":11}`. Ça fonctionne.

**Par commune ou par rue, répartition des étiquettes** (agrégation côté serveur, sans rien télécharger) :
```
GET …/values_agg?field=etiquette_dpe&qs=code_insee_ban:"54395"&size=0
→ C 21136, D 17475, E 9465, F 2728, B 1775, G 1083, A 80  (total 53 742)
GET …/values_agg?field=etiquette_dpe&qs=code_insee_ban:"54395" AND nom_rue_ban:"Rue Joseph Mougin"&size=0
→ D 42, E 19, C 5, F 5, G 2, A 1  (total 74)
```
Il existe aussi `geo_agg?bbox=…`, qui agrège par cellule geohash (testé, OK) et peut servir pour une carte de chaleur.

### CORS, clé, quota

- `curl -sI -H "Origin: https://arimet.github.io" …/lines?size=1` renvoie **`access-control-allow-origin: *`**. Le préflight `OPTIONS` répond 204 avec `access-control-allow-origin: *`.
- **Pas de clé** : tout ce qui précède a été fait en anonyme. Les permissions publiques incluent `readLines`, `getValuesAgg`, `getGeoAgg`, etc.
- Quota : **aucun en-tête `X-RateLimit` et aucun quota documenté** dans les métadonnées. Une rafale de 30 requêtes (15 en parallèle) n'a renvoyé que des 200. Limite réelle : non vérifiée.
- Cache : `cache-control: public, max-age=300` et `etag`.

### Écueils

1. **Géocodage « à la rue » qui pollue la recherche par distance.** À Paris, plusieurs DPE du 51A et du 42 av. de Ségur ont `identifiant_ban = 75107_8909` (id de voie seul). Ils sont placés au point de la voie, qui tombe à moins de 50 m du n° 20. Il faut filtrer sur un `identifiant_ban` qui a un numéro (3 segments ou plus) ou sur `score_ban`. On voit aussi `statut_geocodage = "adresse non géocodée ban car aucune correspondance trouvée"` alors que `identifiant_ban` est rempli : il ne faut pas se fier à ce champ seul.
2. **Absence à l'adresse exacte** (cas du 20 av. de Ségur) : repli sur 50 m, puis sur la rue (`nom_rue_ban` + `code_insee_ban`), puis sur la commune.
3. **Plusieurs DPE par adresse** : appartements différents, DPE d'immeuble, DPE remplacés (`numero_dpe_remplace`). Il faut dédoublonner en écartant les DPE remplacés et afficher un DPE par logement ou le DPE `immeuble` s'il existe.
4. L'id BAN du jeu est la clé `INSEE_voie_numéro`, et non l'UUID `banId`. Le géocodeur IGN renvoie les deux (`id` et `banId`) : prendre `id`.
5. Ce jeu ne couvre que les DPE postérieurs à juillet 2021 (DPE « 3CL 2021 »). Les anciens DPE sont dans d'autres jeux, à écarter car la méthode n'est pas comparable.
6. Syntaxe `qs` de type Lucene : il faut guillemeter les valeurs (`identifiant_ban:"…"`) et encoder l'URL. `nom_rue_ban` demande une correspondance exacte, casse comprise (non testé en variante).
7. Il faut toujours passer `select=` : sans lui, chaque ligne remonte 230 colonnes.

### Verdict DPE : **en direct**

CORS `*`, pas de clé, réponses en ~120 ms, filtres par id BAN, distance, bbox et commune, agrégations côté serveur : pas de pré-calcul nécessaire. On pourrait pré-calculer la répartition par commune (≈ 35 000 communes × 7 valeurs, soit < 1 Mo au national) pour se protéger d'une panne de l'API, mais ce n'est pas indispensable.

---

## 2. Taux de taxe foncière bâtie par commune (DGFiP)

### Source retenue : « Fiscalité locale des particuliers » (data.economie.gouv.fr, Opendatasoft)

- Page : https://data.economie.gouv.fr/explore/dataset/fiscalite-locale-des-particuliers/
- Producteur : DGFiP, à partir du REI. Licence **Licence Ouverte v2.0 (Etalab)**. Modifié le 2026-05-21.
- 174 668 lignes : 1 ligne par commune et par exercice, **exercices 2021 à 2025** (34 874 communes en 2025). **Dernier millésime : 2025**. Les taux 2026 ne sont pas encore publiés dans ce jeu.
- Il existe aussi une variante `fiscalite-locale-des-particuliers-geo`, avec la géométrie (non testée).

**Endpoint testé** (sample `taxe-ofp-fiscalite-particuliers-nancy-54395.json`, HTTP 200, 190 ms) :
```
GET https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/fiscalite-locale-des-particuliers/records?where=insee_com="54395"&order_by=exercice desc&limit=3
```

**Champs TFPB (préfixe `e`)**, avec le détail de Nancy en 2025 :

| Champ | Sens | Nancy 2025 | Paris 2025 |
|---|---|---|---|
| `e12vote` | taux communal voté | 33,98 | 20,5 |
| `e32vote` | taux intercommunal voté | 9,65 (Métropole du Grand Nancy) | 0 |
| `e52`, `e52a` | syndicats / taxes spéciales (TSE) : libellé exact **non vérifié** | 0,111 / 0 | 0,221 / 0,156 |
| `e52tasa` | TASA Île-de-France | 0 | 0,189 |
| `e52ggemapi` | GEMAPI | 0,206 | 0,143 |
| `e22` | **non vérifié** (0 dans les deux cas) | 0 | 0 |
| `taux_global_tfb` | somme des lignes ci-dessus (vérifiée à 0,01 près sur les deux villes) | **43,95** | **21,21** |
| `taux_plein_teom` | TEOM (taux « plein », hors zonage) | 6,71 | 6,21 |

Autres champs : `libcom`, `sirepci` (SIREN de l'EPCI), `q03` (nom de l'EPCI), `optepci` (FPU/FA), `mpoid`, et les mêmes familles pour le TFNB (`b…`) et la TH résidences secondaires (`h…`). Historique de Nancy : TFPB global de 38,77 (2023), 43,92 (2024), 43,95 (2025).

### CORS, clé, quota

- `curl -sI -H "Origin: https://arimet.github.io" …/records?…` renvoie **`access-control-allow-origin: *`** (méthodes `POST, GET, OPTIONS`).
- **Pas de clé.**
- Quota : les en-têtes renvoient **`x-ratelimit-limit: 50000`** par jour et par IP, remis à zéro à 00:00 UTC.
- Export complet 2025 (12 colonnes) : `…/exports/csv?where=exercice="2025"&select=…` pèse **3,3 Mo** et se télécharge en 2,2 s.

### Écueils

1. **Paris, Lyon et Marseille** : le jeu utilise le code de la commune entière (`75056`, `69123`, `13055`), pas celui de l'arrondissement. `insee_com="75107"` renvoie 0 résultat (`taxe-ofp-paris-75107-vs-75056.json`). Il faut une table de correspondance arrondissement → commune.
2. Il faut filtrer sur `exercice` : sinon on reçoit 5 lignes par commune.
3. Le taux de la plateforme peut différer de celui de l'avis d'imposition pendant la convergence d'une commune nouvelle ou d'une fusion d'EPCI (c'est écrit dans la description du jeu). La TEOM peut varier selon des zones infra-communales, et la part incitative n'y figure pas.
4. Il y a un taux, mais pas de montant : pour estimer la taxe d'un logement, il faudrait sa valeur locative cadastrale, qui n'est pas en open data par local. Le jeu « Tarifs des locaux d'habitation 2024 » (`descriptif-tarifs-des-locaux-d-habitation_2024`, 506 284 lignes) existe mais n'a pas été étudié : non vérifié.

### Source brute : REI (pour mémoire)

- Jeu `impots-locaux-fichier-de-recensement-des-elements-dimposition-a-la-fiscalite-dir` sur data.economie.gouv.fr : 0 enregistrement requêtable, 44 pièces jointes zip de 1982 à **2025** (`REI-2025-fichier-notice-trace.zip`, **18,5 Mo**, `content-type: application/zip`, **aucun en-tête `Access-Control-Allow-Origin`**). Le contenu du zip n'a pas été ouvert : format interne et colonnes non vérifiés.
- Ce fichier est inutile pour Alentours : le jeu « Fiscalité locale des particuliers » en extrait déjà les taux TFPB utiles.

### Verdict taxe foncière : **en direct** (API Opendatasoft), ou **pré-calculée** à faible coût

- En direct : 1 requête par commune, CORS `*`, 50 000 requêtes par jour et par IP, amplement suffisant.
- Pré-calculé : un seul `public/data/taxe/2025.json` (≈ 35 000 communes × 6 taux) ferait **≈ 1,5–2 Mo** brut au national (estimation d'après l'export CSV de 3,3 Mo à 12 colonnes). Par département : **≈ 20–60 Ko**. Recommandé, car les données ne changent qu'une fois par an et on s'affranchit du quota. Il faut embarquer la correspondance PLM (Paris-Lyon-Marseille) dans le script.

---

## 3. Tableau récapitulatif

| Donnée | Endpoint | CORS | Clé | Quota | Fraîcheur | Précision | Verdict |
|---|---|---|---|---|---|---|---|
| DPE à l'adresse | `data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines?qs=identifiant_ban:"<id>"&select=…` | `*` | Non | Non documenté (30 req. en rafale OK) | DPE jusqu'au 2026-09-21, MAJ 2026-09-23 | Adresse BAN (logement / immeuble) | **en direct** |
| DPE à ≤ 50 m | `…/lines?geo_distance=<lon>,<lat>,50m` (ou `bbox=`) | `*` | Non | idem | idem | Point BAN, pollué par les DPE géocodés à la rue (à filtrer) | **en direct** |
| Répartition DPE rue / commune | `…/values_agg?field=etiquette_dpe&qs=code_insee_ban:"<insee>"[ AND nom_rue_ban:"<rue>"]` | `*` | Non | idem | idem | Rue / commune | **en direct** (option pré-calculée < 1 Mo national) |
| Taux TFPB par commune (commune + EPCI + syndicats + GEMAPI + TSE/TASA) + TEOM | `data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/fiscalite-locale-des-particuliers/records?where=insee_com="<insee>" and exercice="2025"` | `*` | Non | 50 000 req/jour/IP | Exercice 2025 (jeu MAJ 2026-05-21) | Commune (Paris, Lyon, Marseille : commune entière seulement) | **pré-calculée** (≈ 1,5–2 Mo national, 20–60 Ko/dép.) ; en direct possible |
| REI brut DGFiP | `…/impots-locaux-fichier-de-recensement-…/attachments/rei_2025_fichier_notice_tracezip` | Aucun ACAO | Non | non vérifié | 2025 | Commune × collectivité | **à écarter** (redondant ; zip 18,5 Mo, contenu non vérifié) |
