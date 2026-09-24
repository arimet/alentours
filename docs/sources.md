# Sources : faisabilité (tâche 0, 24/09/2026)

Synthèse des études détaillées dans `docs/feasibility/` (appels réels, échantillons dans `docs/feasibility/samples/`).
Contexte : site statique (GitHub Pages), aucun backend, aucune clé secrète possible.

| Thème | Donnée | Source | CORS / clé | Précision | Verdict V1 |
|---|---|---|---|---|---|
| Géocodage | recherche, autocomplétion, inverse | `data.geopf.fr/geocodage` (l'ancien `api-adresse.data.gouv.fr` est arrêté) | `*` / non, 50 req/s | adresse | **en direct** |
| Risques | argiles, TRI, cavités, sites pollués, ICPE proches | Géorisques API v1 | `*` / non, 5 req/s | point | **en direct**, avec délai max et mode dégradé (**API en panne pendant l'étude**) |
| Risques | sismicité, radon, GASPAR (PPR, AZI, CatNat) | Géorisques API v1 | idem | commune | **pré-calculée** (stable, protège des pannes) |
| Risques | API v2 | Géorisques | jeton personnel | — | écartée (backend nécessaire) |
| Eau | conformité, nitrates, pesticides, PFAS | Hub'Eau `qualite_eau_potable` | `*` / non | commune et réseau (UDI), pas l'adresse | **en direct** |
| Air | indice ATMO du jour et du lendemain | `data.atmo-france.org/geoserver` (WFS `ind:ind_atmo_2021`) | origine renvoyée / non | commune | **en direct** |
| Air | moyennes annuelles | fichiers LCSQA horaires (data.gouv) | pas de CORS | station | **V2** (mesures brutes non validées) |
| Bruit | aéroports (PEB, PGS) | Géoplateforme WMS `dgac_peb_plan_wmsv` | `*` / non | zone | **en direct** |
| Bruit | routier et ferré (cartes stratégiques) | ~425 services Géo-IDE par département | OK / non | zone, grands axes seulement | **V2** (index des services à construire) |
| Fibre et fixe | technologies, opérateurs, débits, couverture FttH | Arcep open data (Ma connexion internet, Cartefibre) | pas d'API utilisable | **commune** (le bâtiment ferait ~1,2 Go) | **pré-calculée** (~10 Mo) |
| Mobile | couverture 2G/3G/4G/5G × 4 opérateurs (simulation) | Arcep Mon réseau mobile (GeoPackages) | pas d'API utilisable | **grille de 200 m** | **pré-calculée** en CI (~50–120 Mo), publiée au build sans commit |
| Mobile | mesures de qualité | campagnes Arcep 2025 | — | commune (quelques milliers) | V2 |
| Immobilier | ventes et médiane €/m² 2021–2025 | Statistiques DVF via `tabular-api.data.gouv.fr` | `*` / non | commune, section | **en direct** |
| Immobilier | évolution annuelle sur 5 ans | fichiers geo-dvf | pas de CORS | commune | **pré-calculée** (~15 Mo), agrégats uniquement |
| Écoles | écoles, collèges, lycées proches, public ou privé | `data.education.gouv.fr` (Explore v2.1) | `*` / non, 50 000/jour | point | **en direct** |
| Santé | pharmacies, urgences | FINESS via tabular API (filtre par zone) | `*` / non | point | **en direct** (données de mai 2026) |
| Santé | médecins généralistes | annuaire Ameli (copie Opendatasoft) ; secours : RPPS pré-calculé | `*` / non | point | **en direct** |
| Transports | arrêts proches | `transport.data.gouv.fr/api/gtfs-stops` | `*` / non | point | V2 (prévu au plan) |

## Limites à afficher

- Eau : résultats par réseau de la commune, pas à l'adresse ; dernier prélèvement 2 à 5 mois avant.
- Mobile : « simulation des opérateurs, précision ~100 m ».
- Bruit : « aucune zone » veut dire « non cartographié », pas « calme ».
- DVF : pas de données en Alsace, en Moselle ni à Mayotte ; les conditions DGFiP interdisent la réidentification, donc aucune vente individuelle.
- Fibre : pas de date prévisionnelle à l'adresse.
