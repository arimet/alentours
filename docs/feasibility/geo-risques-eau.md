# Faisabilité : géocodage, Géorisques, eau potable

Étude du 24/09/2026. Tous les appels ont été faits avec `curl` depuis un poste en France, avec les adresses test « 20 avenue de Ségur 75007 Paris » et « Saint-Véran 05350 ». Les réponses d'exemple sont dans `samples/`. Si une information n'a pas pu être vérifiée, c'est écrit « non vérifié ».

---

## 1. Géocodage : Géoplateforme IGN (ex API Adresse / BAN)

### Migration : `api-adresse.data.gouv.fr` est officiellement arrêtée

- `https://api-adresse.data.gouv.fr/search/` et `/reverse/` **répondent encore en 200**. Les en-têtes contiennent toutefois :
  - `deprecation: Sat, 31 Jan 2026 22:59:59 GMT`
  - `sunset: Sat, 31 Jan 2026 22:59:59 GMT`
  - `location: https://data.geopf.fr/geocodage/search/?…`
- La date de fin est déjà passée et l'ancien domaine peut couper à tout moment. **Il faut utiliser `https://data.geopf.fr/geocodage/` dès le départ.** Le format de réponse est le même (GeoJSON, propriétés BAN).

### Endpoints qui fonctionnent

| Usage | URL |
|---|---|
| Recherche | `https://data.geopf.fr/geocodage/search?q=20+avenue+de+S%C3%A9gur+75007+Paris&limit=5` |
| Autocomplétion | `…/search?q=20+avenue+de+segur+pa&autocomplete=1&limit=5` |
| Filtres | `postcode`, `citycode` (INSEE), `depcode`, `city`, `type=housenumber\|street\|locality\|municipality`, `lat`/`lon` (priorité géographique) |
| Inverse | `https://data.geopf.fr/geocodage/reverse?lon=2.308628&lat=48.850699&limit=1` |
| Parcelle cadastrale | `…/reverse?lon=…&lat=…&index=parcel` renvoie `id: "75107000BQ0003"`, `section`, `number` |
| POI | `index=poi` (non testé) |
| Description du service | `https://data.geopf.fr/geocodage/getCapabilities` |

Champs utiles de la réponse (`features[].properties`) : `label`, `score`, `type` (`housenumber` / `street` / `municipality`…), `housenumber`, `street`, `postcode`, `citycode`, `city`, `district`, `context`, `id` (clé BAN `75107_8909_00020`), `banId` (UUID), `x`/`y` (Lambert 93). La géométrie est un Point `[lon, lat]`.

### Mesures

- **CORS** : `access-control-allow-origin: *`. La requête préliminaire (preflight) `OPTIONS` renvoie `HTTP/2 204` avec `*`. Les mêmes en-têtes sont présents sur l'ancien domaine.
- **Clé** : aucune.
- **Quota** : les en-têtes renvoient `ratelimit-limit: 50` et `x-ratelimit-limit-second: 1`, ce qui correspond à 50 requêtes/s par IP. Le lien avec la doc officielle est non vérifié. Aucun `ratelimit-remaining` n'est renvoyé.
- **Temps de réponse** : de 0,14 à 0,25 s en général. Pics observés à 0,93 s et 1,2 s. L'autocomplétion est utilisable avec un délai d'attente (debounce) de 200 à 300 ms.
- **Licence** : jeu « Base Adresse Nationale » sur data.gouv.fr = `lov2` (Licence Ouverte 2.0). Mise à jour du jeu : 24/09/2026 (quotidienne).
- **Précision** : point adresse (numéro de voie). Selon la saisie, on peut aussi obtenir la rue ou la commune. À Saint-Véran, « Saint-Véran 05350 » renvoie `type: municipality` (centre de la commune). Les rues existent (« Rue du Raux 05350 Saint-Véran ») mais les numéros peuvent manquer : il faut vérifier `type` avant de présenter un résultat comme précis.

### Pièges

1. **Paris, Lyon, Marseille** : `citycode` vaut le code de l'**arrondissement** (`75107`), pas celui de la commune (`75056`). Hub'Eau ne connaît que `75056` et renvoie `count: 0` pour `75107`. Il faut une table arrondissement → commune (75101-75120 → 75056, 69381-69389 → 69123, 13201-13216 → 13055). **Inversement, Géorisques radon ne fonctionne qu'à l'arrondissement** pour ces trois villes (d'après sa doc).
2. L'autocomplétion avec abréviation (« 20 av de seg ») renvoie une liste vide, et « 20 avenue de seg » propose d'abord une autre ville. Il faut un filtre `lat/lon` ou `postcode`, ou un texte plus long.
3. Ordre des coordonnées : `lon` et `lat` sont des paramètres nommés, le GeoJSON est en `[lon, lat]`.

Exemples enregistrés : `geocodage-search-segur-paris.json`, `geocodage-search-saint-veran.json`, `geocodage-autocomplete-segur.json`, `geocodage-reverse-segur-paris.json`.

---

## 2. Géorisques

### ⚠️ API indisponible pendant l'étude

Le 24/09/2026 entre 11:19 et 11:42 (heure de Paris, une vingtaine de tentatives espacées de ~45 s), **tous les appels `https://www.georisques.gouv.fr/api/*` ont renvoyé `503 Service Temporarily Unavailable`**, parfois `500`. Cela concerne aussi `georisques.gouv.fr` sans `www` et la spec OpenAPI `/api/v3/api-docs/georisques-api-v1`. Le site web (`/`, `/doc-api`) répondait en 200. L'en-tête `x-kong-upstream-latency: 2` montre que c'est le serveur derrière la passerelle Kong qui refuse les requêtes.

**Aucun appel n'a abouti.** Ce qui suit vient de sources secondaires, indiquées à chaque fois :
- la spec OpenAPI v1 **archivée par Wayback le 2026-07-17** (version 1.12.2), dont un extrait est dans `samples/georisques-v1-openapi-extrait-archive-wayback-2026-07-17.json` ;
- des réponses JSON réelles **archivées par Wayback le 2026-09-05** pour Saint-Malo, 35288 (`samples/georisques-v1-*-archive-wayback-2026-09-05.json`) ;
- les pages `georisques.gouv.fr/doc-api`, `/inscription` et la fiche data.gouv « API Géorisques ».

Wayback contient des réponses 200 jusqu'au 2026-09-19. La panne semble donc récente et temporaire, mais **elle montre qu'il faut prévoir un mode dégradé** : afficher le reste de la fiche et un message « Géorisques indisponible ».

### CORS

Vérifié même sur les réponses 503, car ce sont les en-têtes de la passerelle Kong : `access-control-allow-origin: *`, `access-control-allow-methods: GET, PUT, POST, DELETE, PATCH, OPTIONS`, `access-control-allow-headers: …,Authorization`. Non vérifié sur une réponse 200 d'aujourd'hui.

### v1 et v2

- **v1** (`/api/v1/…`) : **sans jeton**. La page `/inscription` dit : « Les APIs en version v1 restent accessibles sans utilisation de jeton. »
- **v2** (`/api/v2/…`) : ajoute des filtres par thème et de nouveaux critères géographiques. **Elle exige un jeton** obtenu via un compte Cerbère ou FranceConnect, valable 1 an, à passer dans un en-tête HTTP. Le nom exact de l'en-tête est non vérifié. La spec v2 n'était pas accessible (503) et n'est pas archivée : les endpoints v2 sont non vérifiés. Un jeton personnel ne peut pas être mis dans un site statique, donc **v2 = backend nécessaire**.
- **Quotas v1** (texte de la spec archivée) : 1 appel/s pour `resultats_rapport_risque`, 1 appel/s pour `rapport_pdf`, 5 appels/s pour le reste de `api/v1/**`. La fiche data.gouv indique « 1000 requêtes/min par IP ». Les en-têtes de quota réels sont non vérifiés.
- **Licence** : la fiche data.gouv indique Licence Ouverte 2.0. Le pied de page du site dit « licence etalab-2.0 ».
- **Date de fin de la v1** : aucune annoncée trouvée (non vérifié).

### Endpoints v1 utiles (d'après la spec archivée)

Format des coordonnées : `latlon=LON,LAT`. **Malgré le nom du paramètre, la longitude vient en premier**, par exemple `latlon=2.308628,48.850699`. `rayon` est en mètres, maximum 10 000. La pagination se fait avec `page` et `page_size`. Les réponses paginées ont la forme `{results, page, total_pages, data[], next, previous}`.

| Donnée | Endpoint | Paramètres | Précision |
|---|---|---|---|
| Synthèse « risques près de chez moi » | `/api/v1/resultats_rapport_risque` | `latlon` \| `code_insee` \| `adresse` | point/commune. Délai de réponse ≈ 10 s selon une source tierce (DREAL PdL, non mesuré) ; quota 1/s |
| Rapport PDF | `/api/v1/rapport_pdf` | idem | PDF de 1,2 à 1,6 Mo (tailles Wayback) ; quota 1/s |
| Liste des risques de la commune (GASPAR) | `/api/v1/gaspar/risques` | `latlon`+`rayon` \| `code_insee` | commune |
| Inondation : AZI | `/api/v1/gaspar/azi` | idem | commune (présence d'un atlas, pas un zonage à la parcelle) |
| Inondation : TRI | `/api/v1/gaspar/tri` (commune) et `/api/v1/tri_zonage` (`latlon` obligatoire) | | `tri_zonage` = à l'adresse selon la doc |
| PPR naturels (dont PPRI), miniers, technologiques | `/api/v1/gaspar/pprn`, `/pprm`, `/pprt` (+ `/{idGaspar}`) | **`codeInsee`, `longitude`, `latitude`** (noms différents des autres endpoints) | procédure communale |
| Arrêtés CatNat | `/api/v1/gaspar/catnat` | `code_insee`… | commune |
| Argiles (RGA) | `/api/v1/rga` | `latlon` seulement | **point** ; archive : `{"codeExposition":"2","exposition":"Exposition moyenne"}` |
| Zone sismique | `/api/v1/zonage_sismique` | `code_insee` \| `latlon` | commune ; archive : `zone_sismicite: "2 - FAIBLE"` |
| Radon | `/api/v1/radon` | `code_insee` (obligatoire) | commune (**arrondissement** pour PLM) ; archive : `classe_potentiel: "1"` |
| Cavités | `/api/v1/cavites` | `latlon`+`rayon` \| `code_insee`, `type` | objets ponctuels |
| Mouvements de terrain | `/api/v1/mvt` | idem | objets ponctuels |
| Sites et sols pollués | `/api/v1/ssp` (tout), `/ssp/casias`, `/ssp/conclusions_sis`, `/ssp/conclusions_sup`, `/ssp/instructions` (ex-BASOL) | `latlon`+`rayon` \| `code_insee`, `date_maj` | site/polygone |
| ICPE | `/api/v1/installations_classees` | `latlon`+`rayon` \| `code_insee`, `statutSeveso`, `regime`… | établissement |
| Nucléaire (PPI) | `/api/v1/installations_nucleaires` | `longitude`, `latitude` \| `code_insee` | zone PPI |
| Débroussaillement (OLD) | `/api/v1/old` | `latlon` \| `code_insee` | |

Fraîcheur : non vérifiée en direct. Les réponses archivées ne contiennent aucune date de mise à jour. `ssp` et `installations_classees` acceptent un filtre `date_maj` / `dateMaj`.

### Pièges Géorisques

1. **Disponibilité** : panne complète constatée pendant l'étude. Il faut un délai d'expiration côté client et un mode dégradé.
2. `latlon` = `lon,lat`. Les endpoints PPR utilisent `longitude`/`latitude`/`codeInsee` au lieu de `latlon`/`code_insee`.
3. `resultats_rapport_risque` est lent (≈ 10 s selon une source tierce) et limité à 1/s par IP. Un client navigateur passe probablement sous ce quota, mais le délai est pénible. Mieux vaut appeler les endpoints ciblés en parallèle, sans dépasser 5/s.
4. Radon à Paris, Lyon et Marseille : il faut utiliser le code d'arrondissement (l'inverse de Hub'Eau).
5. Données communales (sismicité, radon, GASPAR) : elles sont stables et peu nombreuses (~35 000 communes). On peut les **pré-calculer** en JSON par commune, ce qui protège aussi des pannes. Le téléchargement en masse n'a pas été vérifié ; on peut aussi passer par l'API, commune par commune, à 5/s.

---

## 3. Hub'Eau : qualité de l'eau potable

Base : `https://hubeau.eaufrance.fr/api/v1/qualite_eau_potable`

### Endpoints qui fonctionnent

| Usage | URL |
|---|---|
| Réseaux (UDI) desservant une commune | `/communes_udi?code_commune=05157&annee=2026` |
| Derniers résultats d'une commune | `/resultats_dis?code_commune=75056&sort=desc&size=50` |
| Nitrates | `/resultats_dis?code_commune=75056&code_parametre=1340&sort=desc&size=3` |
| PFAS (somme de 20 / somme de 4) | `/resultats_dis?code_commune=75056&code_parametre=8847,9268&sort=desc&size=4` |
| Total pesticides | `/resultats_dis?code_commune=75056&code_parametre_se=PESTOT&sort=desc&size=2` (code 6276) |
| Filtrer par réseau | `code_reseau=075000221` |
| Réduire la réponse | `fields=libelle_parametre,resultat_alphanumerique,…` |
| Plage de dates | `date_min_prelevement=2026-01-01` |

Champs utiles : `code_parametre`, `code_parametre_se`, `libelle_parametre`, `resultat_numerique`, **`resultat_alphanumerique`**, `libelle_unite`, `limite_qualite_parametre` (ex. `"<=50 mg/L"`), `reference_qualite_parametre`, `date_prelevement`, `code_prelevement`, `conclusion_conformite_prelevement` (texte), `conformite_limites_bact_prelevement` / `_pc_` / `references_*` (`C` = conforme), `nom_distributeur`, `reseaux[{code, nom, debit}]`.

**PFAS disponibles** : sur Paris en 2026, on trouve 20 PFAS individuels (PFOA 5347, PFOS 6561, PFHxS 6830…), la **somme de 20 PFAS (8847 `SPFAS`, limite `<=0,1 µg/L`)** et la **somme de 4 PFAS (9268 `S4PFAS`)**. Saint-Véran a 3 mesures `SPFAS`, la dernière le 2026-05-06. Pesticides individuels vus : glyphosate 1506, AMPA 1907, atrazine et métabolites, chlorothalonil et métabolites (R417888, R471811), chloridazone desphényl.

### Mesures

- **CORS** : `Access-Control-Allow-Origin: *`.
- **Clé** : aucune.
- **Quota** : aucun en-tête de limite de débit. Limites documentées : taille de page max 20 000, **profondeur max 20 000 enregistrements** (numéro de page × taille), URL de 2 083 caractères max.
- **Licence** : jeu source « Résultats du contrôle sanitaire de l'eau distribuée commune par commune » (ministère de la Santé) = `lov2`, mis à jour sur data.gouv le 01/09/2026. Les conditions propres à Hub'Eau sont non vérifiées.
- **Fraîcheur** : doc Hub'Eau = mise à jour mensuelle, « Dernière alimentation : 15/09/2026 - Dernier prélèvement : 31/07/2026 ». Constaté : dernier prélèvement à Saint-Véran le 2026-06-19, dernier à Paris le **2026-04-30** (sur les 19 018 résultats 2026). Le retard dépend de la commune, entre 2 et 5 mois.
- **Temps de réponse** : de 0,09 à 0,12 s pour une petite requête. **17 s** pour `size=20000` sur Paris (19 018 lignes).
- **Précision** : **commune et UDI (réseau)**, pas l'adresse. Paris compte 44 lignes UDI par année (CENTRE, NORD OUEST, SUD OUEST, EST…) avec un `nom_quartier` en texte libre (« du 1° au 13°, 15° et 16° arrondissement »). **Aucune correspondance adresse → UDI n'est disponible.** Si une commune a plusieurs UDI, il faut afficher les résultats par réseau ou choisir le pire cas.

### Pièges Hub'Eau

1. **HTTP 206** quand il y a d'autres pages (`count` > `size`). `fetch` le traite comme `ok` (2xx), donc aucun problème, mais il ne faut pas tester `status === 200`.
2. **Valeurs sous le seuil de détection** : `resultat_alphanumerique: "<0,029"` donne `resultat_numerique: 0.0`. Il faut afficher la valeur alphanumérique (virgule décimale) pour ne pas écrire « 0 PFAS ».
3. `sort=desc` trie par date de prélèvement, mais une ligne = **un paramètre**. Pour « le dernier prélèvement », il faut regrouper par `code_prelevement`.
4. Les codes arrondissement ne fonctionnent pas : utiliser `75056`, `69123`, `13055`.
5. `communes_udi` sans `annee` renvoie une ligne par année depuis 2016 environ. Il faut filtrer sur l'année courante.
6. Volumes : 649 137 résultats pour Paris, 5 778 pour Saint-Véran. Il faut toujours filtrer par `code_parametre` et `size` réduit.

Exemples enregistrés : `hubeau-communes-udi-saint-veran.json`, `hubeau-resultats-nitrates-paris.json`, `hubeau-resultats-pfas-paris.json`, `hubeau-resultats-pesticides-total-paris.json`.

---

## 4. Synthèse

| Donnée | Endpoint | CORS | Clé | Quota | Fraîcheur | Précision | Verdict |
|---|---|---|---|---|---|---|---|
| Géocodage / autocomplétion | `data.geopf.fr/geocodage/search` | `*` (vérifié) | non | 50/s par IP (en-têtes) | BAN quotidienne (MAJ jeu 24/09/2026) | point adresse (sinon rue/commune, voir `type`) | **en direct** |
| Géocodage inverse (+ parcelle) | `data.geopf.fr/geocodage/reverse` (`index=parcel`) | `*` (vérifié) | non | idem | idem | point adresse / parcelle | **en direct** |
| Ancien domaine API Adresse | `api-adresse.data.gouv.fr/search` | `*` | non | idem | — | — | **à ne pas utiliser** (fin annoncée au 31/01/2026) |
| Synthèse risques Géorisques | `georisques.gouv.fr/api/v1/resultats_rapport_risque` | `*` (en-têtes passerelle, sur 503) | non (v1) | 1/s (spec archivée) | non vérifié | point/commune | en direct **non vérifié** (API en 503 ; ≈10 s selon source tierce) |
| Argiles (RGA) | `/api/v1/rga?latlon=lon,lat` | `*` (passerelle) | non | 5/s (spec) | non vérifié | point | **en direct** si l'API tient (non vérifié aujourd'hui) |
| Zone sismique | `/api/v1/zonage_sismique?code_insee=` | `*` (passerelle) | non | 5/s | zonage réglementaire stable (date non vérifiée) | commune | **pré-calculée** |
| Radon | `/api/v1/radon?code_insee=` | `*` (passerelle) | non | 5/s | non vérifié | commune (arrondissement pour PLM) | **pré-calculée** |
| Risques GASPAR / AZI / TRI / PPR / CatNat | `/api/v1/gaspar/*`, `/api/v1/tri_zonage` | `*` (passerelle) | non | 5/s | non vérifié | commune (TRI : point) | **pré-calculée** (TRI zonage : en direct, non vérifié) |
| Cavités / mouvements de terrain | `/api/v1/cavites`, `/api/v1/mvt` (`latlon`+`rayon`) | `*` (passerelle) | non | 5/s | non vérifié | objets ponctuels | en direct **non vérifié** |
| Sites et sols pollués (SIS/CASIAS/ex-BASOL) | `/api/v1/ssp*` (`latlon`+`rayon`) | `*` (passerelle) | non | 5/s | filtre `date_maj` dispo, valeur non vérifiée | site | en direct **non vérifié** |
| ICPE à proximité | `/api/v1/installations_classees` (`latlon`+`rayon`) | `*` (passerelle) | non | 5/s | non vérifié | établissement | en direct **non vérifié** |
| Géorisques v2 | `/api/v2/*` | non vérifié | **oui** (jeton Cerbère/FranceConnect, 1 an) | non vérifié | non vérifié | non vérifié | **backend nécessaire** |
| Réseaux d'eau (UDI) | `hubeau…/qualite_eau_potable/communes_udi` | `*` (vérifié) | non | pas de limite de débit affichée ; profondeur 20 000 | annuelle (2026 présent) | commune → UDI (quartier en texte libre) | **en direct** |
| Conformité eau / nitrates / pesticides / PFAS | `hubeau…/qualite_eau_potable/resultats_dis` | `*` (vérifié) | non | idem | mensuelle ; dernier prélèvement 30/04/2026 (Paris) à 19/06/2026 (Saint-Véran) | commune / UDI, **pas l'adresse** | **en direct** (petites requêtes filtrées) |
