# Faisabilité — Urbanisme (GPU) et bornes de recharge (IRVE)

Étude jetable, sans code produit. Appels `curl` réels du 24/09/2026 autour de :

- **Nancy** — 35 rue Joseph Mougin (48.703193, 6.16209)
- **Paris** — 20 avenue de Ségur (48.850699, 2.308628)
- **Saint-Véran** (44.704139, 6.861073)
- Cas limites ajoutés : Alleyrat (23003, commune au RNU), Altier (48004, carte communale), place Stanislas à Nancy (secteur PSMV).

Échantillons (géométries retirées, < 30 Ko) : `samples/gpu-*.json`, `samples/irve-*.json`.

---

## 1. Urbanisme — API Carto, module GPU (IGN)

### Endpoints testés

Base : `https://apicarto.ign.fr/api/gpu/<couche>?geom=<GeoJSON URL-encodé>` (GET ou POST, EPSG:4326). On peut aussi passer `partition=DU_<insee|siren>` à la place de `geom`. Spécification OpenAPI : `https://apicarto.ign.fr/api/doc/gpu.yml` (v2.10.4).

| Couche | Rôle | Nancy | Paris | Saint-Véran |
|---|---|---|---|---|
| `municipality` | commune + `is_rnu` | 1 (NANCY, rnu=false) | **2** (75107 arrondissement + 75056 PARIS) | 1 |
| `document` | document d'urbanisme | PLUi `245400676_PLUi_20260709` | PLU `75056_PLU_20260616` | PLU `05157_PLU_20250915` |
| `zone-urba` | zone PLU/PLUi | 1 : `U` « Zone urbaine » | 1 : `UG` « Zone urbaine générale » | 1 : `Ua` « centres anciens et quartiers historiques » |
| `secteur-cc` | secteur de carte communale | 0 | 0 | 0 |
| `prescription-surf` | prescriptions (OAP, mixité, hauteurs…) | 13 | 7 | 1 (OAP) |
| `prescription-lin` / `-pct` | prescriptions linéaires/ponctuelles | 0 / 0 | 0 / 0 | 0 / 0 |
| `info-surf` | informations (bruit, DPU, archéo…) | 18 | 2 | 3 |
| `info-lin` / `-pct` | | 0 / 0 | 0 / 0 | 0 / 0 |
| `assiette-sup-s` | **servitudes d'utilité publique** (emprise) | 2 (AC1 abords Maisons de Jean Prouvé, Croix de chemin) | 10 (AC1 Invalides, École militaire…) | 2 (AC1 ferme, **AC4 SPR de Saint-Véran**) |
| `assiette-sup-l` / `-p` | | 0 / 0 | 0 / 0 | 0 / 0 |
| `acte-sup` | actes juridiques des SUP | voir piège n°1 | | |

Cadastre : `https://apicarto.ign.fr/api/cadastre/parcelle?geom=<point>` → 1 parcelle par point :

| Lieu | `idu` | section / numéro | contenance |
|---|---|---|---|
| Nancy | `54395000AE0404` | AE 0404 | 5 124 m² |
| Paris | `75107000BQ0003` | BQ 0003 | 8 215 m² |
| Saint-Véran | `05157000AB1163` | AB 1163 | 75 m² |

Champs utiles `parcelle` : `idu`, `section`, `numero`, `contenance`, `nom_com`, `code_insee`, `code_arr`. Fraîcheur de la source cadastrale : non vérifié.

### Champs utiles

- **`document`** : `du_type` (PLU, PLUi, CC, PSMV…), `name` (`<grid>_<type>_<AAAAMMJJ>` : la date en suffixe est celle de la dernière procédure), `grid_title`, `gpu_doc_id`, `partition`, `gpu_timestamp` (date de mise en ligne sur le GPU).
- **`zone-urba`** : `libelle` (UG, Ua…), `libelong`, `typezone` (U, AUc, AUs, A, N), `datvalid` (date d'approbation, AAAAMMJJ), `nomfic`, `urlfic` (souvent vide), `idurba`, et côté Nancy `destoui` / `destcdt` / `destnon` (destinations autorisées / sous conditions / interdites, en codes).
- **`prescription-surf`** et **`info-surf`** : `libelle`, `typepsc` ou `typeinf` + sous-type (nomenclature CNIG), `txt`, `nomfic`, `urlfic`.
- **`assiette-sup-s`** : `suptype` (ac1 = abords de monument historique, ac4 = SPR…), `nomsuplitt` (nom du monument), `typeass`, `paramcalc` (500 = tampon de 500 m), `fichier` (PDF de l'acte).
- **`municipality`** : `insee`, `name`, `is_rnu`, `is_coastline` (loi Littoral).

### Lien vers le document officiel (vérifié)

- Fiche document : `https://www.geoportail-urbanisme.gouv.fr/document/by-id/<gpu_doc_id>` → 200 (HTML).
- Détails JSON, **CORS `*`** : `https://www.geoportail-urbanisme.gouv.fr/api/document/<gpu_doc_id>/details` → `type`, `title` (« Plan Local d'Urbanisme intercommunal (PLUi) DU GRAND NANCY »), `legalStatus` (APPROVED), `effectiveStatus` (EN_VIGUEUR), `typeproc_title` (« Modification Simplifiée n°1 »), `producer`, `publicationDate`, `archiveUrl` (ZIP), `writingMaterials` (URL de chaque PDF). Échantillon : `gpu-document-details-grand-nancy.json`.
- Liste des pièces : `…/api/document/<id>/files` (CORS `*`).
- PDF d'une pièce : `…/api/document/<id>/files/<nomfic>` → 302 vers `https://data.geopf.fr/annexes/gpu/documents/DU_75056/<id>/75056_reglement_20260616.pdf`. Permet de construire un lien même quand `urlfic` est vide (Paris, Saint-Véran). L'ancre `#page=31` de `nomfic` à Nancy pointe directement sur la page du règlement de la zone.
- Lien carte `https://www.geoportail-urbanisme.gouv.fr/map/?lon=…&lat=…&zoom=18` : répond 200 ; la prise en compte des paramètres n'est pas vérifiée.

### CORS, clé, quotas, temps de réponse

- CORS (`curl -sI -H "Origin: https://arimet.github.io" …/api/gpu/zone-urba?geom=…`) :
  `access-control-allow-origin: https://arimet.github.io` + `access-control-allow-credentials: true`. Pré-vol `OPTIONS` → 204, `access-control-allow-origin: *`. Même comportement sur `/api/cadastre/parcelle`.
- Clé : aucune.
- Quota : aucun en-tête de limite. 15 requêtes parallèles → 15 × 200 en 0,2–0,37 s. Aucun quota n'est documenté sur la page d'accueil d'API Carto (non vérifié ailleurs).
- `cache-control: private, no-cache, no-store` : le navigateur ne met rien en cache.
- Temps : `municipality` / `document` / `zone-urba` 0,13–0,6 s ; `prescription-surf` **1,7–3,4 s** en ville ; `info-surf` 0,4–1,8 s ; `assiette-sup-s` 0,2–1,3 s ; `parcelle` 0,14–0,34 s. Les 8 appels lancés en parallèle se terminent en ~3,5 s au pire (Nancy).
- Licence : API Carto « conserve la licence des sources de données » (page d'accueil). Pour les données GPU elles-mêmes : non vérifié.
- Fraîcheur : flux WFS du GPU, en direct. On voit `gpu_timestamp` 2026-09-24T02:51 sur les SUP de Nancy, soit les mises en ligne du jour.

### Pièges constatés

1. **`acte-sup` n'accepte pas `geom`** : le paramètre est ignoré, et la réponse (2,6 Mo, 5 000 actes sur 89 593, 2,4–5 s) n'a rien à voir avec le point. Il faut lire `partition` dans `assiette-sup-s`, puis appeler `acte-sup?partition=172014607_SUP_54_AC1`. Ça renvoie 526 actes (291 Ko) pour tout le département, qu'il faut ensuite filtrer côté client par `idgen` / `fichier`. Pour l'affichage, `assiette-sup-s` suffit (nom, type, PDF).
2. **Pas moyen d'exclure les géométries** : `prescription-surf` pèse 943 Ko à Nancy et 1,15 Mo à Paris, `info-surf` 910 Ko à Nancy, pour une dizaine d'attributs. Ça reste acceptable en direct, mais c'est lourd sur mobile.
3. **Commune au RNU** (Alleyrat 23003) : `municipality.is_rnu = true`, et `document`, `zone-urba`, `secteur-cc` et `assiette-sup-s` sont vides (147 octets). Afficher « Règlement national d'urbanisme, pas de document local ».
4. **`is_rnu = false` sans document sur le GPU** (Ajain 23002, Arrènes 23006, avec `document?partition=DU_<insee>` vide) : ce peut être un document non versé ou un PLUi porté par un SIREN. Non vérifié par `geom`. Afficher « document non disponible sur le GPU ».
5. **Carte communale** (Altier 48004, `du_type=CC`) : la zone vient de `secteur-cc` (`libelle` ZC / ZCa / ZNC, `typesect`), pas de `zone-urba`. Il faut appeler les deux.
6. **Paris** : `municipality` renvoie 2 entités (arrondissement et commune). Le document est rattaché à 75056, pas à 75107.
7. **Zone générique** : le PLUi du Grand Nancy classe tout en `U` « Zone urbaine », sans sous-zone. L'info utile est dans `prescription-surf` (implantation secteur n°3, stationnement couronne 1, mixité…).
8. **PSMV** (place Stanislas) : `zone-urba` renvoie une zone du PLUi libellée `PSMV` « Plan de Sauvegarde et de Mise en Valeur » (`typezone` U). Le PSMV lui-même n'est pas renvoyé par `document`. Il faut expliquer que le règlement applicable est ailleurs.
9. **Chevauchements** : 1 seule zone par point dans les 4 cas testés. En revanche, on a jusqu'à 18 `info-surf`, 13 `prescription-surf` et 10 SUP qui se superposent, dont des doublons thématiques (OAP thématiques, annexes sanitaires). Il faut trier et filtrer par `typepsc` / `typeinf`. Un point en limite de zone n'a pas été testé.
10. **Encodage cassé dans les SUP de Paris** : `nomsuplitt` = « HÃ´tel des Invalides » (UTF-8 lu en Latin-1). Réparable côté client avec `decodeURIComponent(escape(s))`. Les SUP de Nancy et de Saint-Véran sont propres.
11. `urlfic` est rempli à Nancy mais vide à Paris et Saint-Véran. Il faut construire le lien via `/api/document/<id>/files/<nomfic>`.
12. Deux dates différentes : `datvalid` (20251106 à Nancy) et la date du `name` (20260709, dernière procédure). Afficher « approuvé le … / dernière modification … ».

---

## 2. Bornes de recharge — Base nationale IRVE (data.gouv.fr)

### Source

- Jeu de données `5448d3e0c751df01f85d0572`, « Base nationale des IRVE… données statiques ». Licence **`fr-lo`** (Licence Ouverte), fréquence **quotidienne**, `last_update` 2026-09-24T03:42.
- Ressource CSV « Consolidation de la dernière version à date du schéma (v2.3.1) » : **`eb76d20a-8501-400e-b336-d85724de5435`**, 156 Mo, **221 754 lignes**, une ligne par point de charge. Elle est indexée dans l'API tabulaire.
- Une autre ressource CSV listée sur la page du jeu de données (`2729b192-…`) répond **410** dans l'API tabulaire (« permanently deleted »). Seule `eb76d20a` fonctionne.
- Export GeoJSON (`7eee8f09-…`) : **565 Mo**, inutilisable dans le navigateur.

### Endpoint (même logique que FINESS)

```
https://tabular-api.data.gouv.fr/api/resources/eb76d20a-8501-400e-b336-d85724de5435/data/
  ?consolidated_latitude__greater=<lat-d>&consolidated_latitude__less=<lat+d>
  &consolidated_longitude__greater=<lon-d>&consolidated_longitude__less=<lon+d>
  &page_size=200
```

`page_size=200` est accepté. Le filtre `code_insee_commune__exact=05157` marche aussi (2 lignes).

| Lieu | bbox | lignes | temps | taille |
|---|---|---|---|---|
| Nancy | ±1 km | 16 (7 PDC réels, 2 stations, la plus proche à 649 m) | 0,64 s | 30 Ko |
| Paris | ±1 km | **352** → 197 PDC distincts → **33 stations** (la plus proche à 134 m, 10 av. de Saxe) | 0,49 s (p. 1) | 93 Ko / 50 lignes |
| Saint-Véran | ±10 km | 25 → 13 PDC → 7 stations (Parking Beauregard à 657 m) | 0,34 s | 49 Ko |

### Champs

`nom_station`, `adresse_station`, `implantation_station` (Voirie, Parking privé à usage public…), `nom_operateur`, `nom_enseigne`, `nbre_pdc` (points de la station), `id_station_itinerance`, `id_pdc_itinerance`, `puissance_nominale` (kW, float : 3, 4, 7, 7.4, 22, 50, 100, 200 observés), `prise_type_2` / `_combo_ccs` / `_chademo` / `_ef`, `gratuit` (bool), `paiement_cb`, `tarification`, `condition_acces` (« Accès libre » / « Accès réservé »), `horaires` (« 24/7 », « Mo-Su 00:00-23:57 », format OSM), `accessibilite_pmr`, `reservation`, `date_mise_en_service`, `date_maj`, `consolidated_latitude` / `_longitude`, `consolidated_is_lon_lat_correct`.

### CORS, clé, quotas, fraîcheur

- CORS : `access-control-allow-origin: *`, `access-control-allow-methods: GET, OPTIONS`, `cache-control: public`.
- Clé : aucune. Quota de l'API tabulaire : non vérifié, aucun en-tête de limite vu.
- Fraîcheur : consolidation quotidienne. `date_maj` va jusqu'au 2026-09-23 dans les réponses du jour, donc la base tabulaire suit le fichier du jour. Mais les `date_maj` des lignes remontent à 2024-07-01 : chaque ligne n'est à jour que si son opérateur publie. **Données statiques seulement** : aucune disponibilité en temps réel. La base IRVE dynamique n'a pas été étudiée (non vérifié).

### Pièges constatés

1. **Doublons massifs** : un même `id_pdc_itinerance` apparaît 2 fois ou plus, publié par des sources différentes. À Saint-Véran, on a « SPBR1 | FR*EBN » (2025) et « EASYCHARGE » (2026) pour la même borne. À Nancy, le même Power Dot figure en 2025-09-14 et en 2026-03-30, avec une puissance différente (100 puis 200 kW). Il faut **dédoublonner par `id_pdc_itinerance` en gardant la `date_maj` la plus récente**, puis regrouper par station (Paris : 352 → 197 → 33).
2. `id_station_itinerance` n'est pas stable entre publieurs (`FREBNP4978…` vs `FREBNPBTYUZ`). Pour regrouper, les coordonnées ou `nom_station` + `adresse_station` sont plus fiables.
3. **`gratuit` presque toujours `null`** : 188 sur 197 PDC à Paris. On ne peut pas afficher « gratuit : non » par défaut. Il faut écrire « non renseigné ».
4. Un filtre bbox rectangulaire ne donne pas de distance. Le résultat « ±1 km » à Nancy renvoie une station à 1 159 m (coin de la boîte). Il faut calculer la distance côté client et trier.
5. En zone dense, il faut paginer : 352 lignes pour 1 km² à Paris, soit 2 appels à `page_size=200`. Pour une petite boîte, 500 m suffisent.
6. `nom_station` vaut parfois un identifiant technique (« Réseau eborn/194a41c4-… », « FR*Y55/1958… »).
7. `consolidated_is_lon_lat_correct = false` sur de nombreuses lignes, alors que les coordonnées consolidées tombent au bon endroit dans nos tests. Le sens exact de ce drapeau est non vérifié.
8. L'identifiant de ressource « dernière version » semble stable (le fichier est remplacé chaque jour), mais une autre ressource du même jeu a déjà été supprimée : c'est une dépendance à surveiller.

### Pré-calcul (alternative)

Aucun intérêt pour la fraîcheur, puisque l'API est en direct et ouverte en CORS. Si on voulait se passer de l'API tabulaire : CSV de 156 Mo, dédoublonné et regroupé par station avec ~10 champs. Avec le ratio parisien (352 lignes → 33 stations), on estime ~20–40 k stations, soit quelques Mo au national et ~50–300 Ko par département. **Estimation non mesurée** : le CSV n'a pas été téléchargé.

---

## Synthèse

| Donnée | Endpoint | CORS | Clé | Quota | Fraîcheur | Précision | Verdict |
|---|---|---|---|---|---|---|---|
| Commune / RNU / littoral | `apicarto.ign.fr/api/gpu/municipality?geom=` | oui (origine renvoyée + credentials ; pré-vol `*`) | non | non documenté ; 15 req. parallèles OK | direct (flux WFS GPU) | commune (2 entités à Paris) | **en direct** |
| Document d'urbanisme (type, nom, date) | `/api/gpu/document?geom=` + `geoportail-urbanisme.gouv.fr/api/document/<id>/details` | oui / `*` | non | idem | direct | intercommunal ou communal | **en direct** |
| Zone PLU/PLUi (U/AU/A/N + libellé) | `/api/gpu/zone-urba?geom=` | oui | non | idem | direct ; `datvalid` = approbation | polygone de zone, point exact | **en direct** |
| Secteur de carte communale | `/api/gpu/secteur-cc?geom=` | oui | non | idem | direct | polygone ZC/ZNC | **en direct** |
| Prescriptions / informations | `/api/gpu/prescription-surf`, `/info-surf` (+ `-lin`, `-pct`) | oui | non | idem ; 1–3,4 s, jusqu'à 1,15 Mo | direct | polygones, 1 à 18 superposés | **en direct** (lourd, à filtrer) |
| Servitudes d'utilité publique | `/api/gpu/assiette-sup-s?geom=` (+ `-l`, `-p`) | oui | non | idem | direct (`gpu_timestamp` du jour) | emprise (ex. tampon de 500 m AC1) | **en direct** |
| Actes des SUP | `/api/gpu/acte-sup?partition=` (**ignore geom**) | oui | non | 291 Ko par partition départementale | direct | département, filtrage client | **à écarter** (`assiette-sup-s.fichier` suffit) |
| Lien vers le document officiel | `geoportail-urbanisme.gouv.fr/document/by-id/<id>`, `/api/document/<id>/files/<nomfic>` | `*` (API JSON) | non | non vérifié | direct | document / pièce PDF | **en direct** (lien construit) |
| Parcelle cadastrale | `apicarto.ign.fr/api/cadastre/parcelle?geom=` | oui | non | non documenté | non vérifié | parcelle (`idu`, contenance) | **en direct** |
| Bornes IRVE (puissance, nb PDC, accès, horaires, gratuit) | `tabular-api.data.gouv.fr/api/resources/eb76d20a-8501-400e-b336-d85724de5435/data/?consolidated_latitude__greater=…` | `*` | non | non vérifié | quotidienne (fichier) ; `date_maj` par ligne jusqu'à 2 ans | point de charge (coordonnées), à dédoublonner | **en direct** (dédoublonnage client ; pré-calcul possible, ~50–300 Ko/dép. estimés) |
| Bornes IRVE, export GeoJSON national | ressource `7eee8f09-…` (565 Mo) | non vérifié | non | — | quotidienne | point | **à écarter** |
| Disponibilité temps réel des bornes | IRVE dynamique | non vérifié | non vérifié | non vérifié | non vérifié | non vérifié | non vérifié (hors périmètre testé) |
