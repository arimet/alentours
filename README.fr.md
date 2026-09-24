# Le Relevé

[English](README.md)

**Ce que les données publiques disent de n'importe quelle adresse en France, avec la source de chaque chiffre.**

Tapez une adresse et obtenez une fiche claire sur l'endroit : risques naturels et industriels, qualité de l'eau du robinet, qualité de l'air, bruit des aéroports, fibre et réseau mobile, prix de l'immobilier, écoles, santé et commerces du quotidien. Ces données sont ouvertes mais éparpillées sur une dizaine de sites officiels ; Le Relevé les rassemble, les explique simplement et relie chaque chiffre à sa source.

Pour celles et ceux qui déménagent, achètent, louent, ou sont simplement curieux de leur quartier.

## Ce que montre la fiche

| Thème | Contenu | Précision |
|---|---|---|
| Risques | zones inondables, argiles, sismicité, radon, plans de prévention, catastrophes naturelles reconnues depuis 1996, sites pollués et installations classées proches | point ou commune |
| Eau du robinet | conformité du dernier prélèvement, nitrates, PFAS, pesticides, comparés aux limites réglementaires | réseau d'eau de la commune |
| Air | indice ATMO du jour et du lendemain | commune |
| Bruit | plans d'exposition et de gêne sonore des aéroports | zone |
| Internet fixe | part des locaux raccordables à la fibre, meilleure technologie, débits, date de fermeture du cuivre | commune |
| Réseau mobile | couverture 4G et 5G par opérateur (simulations des opérateurs) | carreau de 200 m |
| Immobilier | prix médian au m² des appartements et des maisons, évolution annuelle | commune |
| Écoles | écoles publiques proches, collège de secteur, lycée le plus proche | point, adresse pour le collège |
| Santé | pharmacies, généralistes et urgences les plus proches | point |
| Commerces | boulangerie, supérette, supermarché, poste, banque les plus proches… | point |

Les distances sont **à pied**, calculées sur le réseau routier de l'IGN pour les lieux à moins de 3 km, à vol d'oiseau au-delà.

## Principes

- **Vie privée.** L'adresse n'arrive jamais sur un serveur à nous : il n'y en a pas. Elle part seulement aux API publiques qui en ont besoin, d'abord le géocodage. Le lieu est gardé dans le fragment de l'URL (`#lat,lon`), que le navigateur n'envoie ni aux serveurs ni à l'outil d'audience sans cookie (GoatCounter).
- **Sources.** Chaque chiffre affiche sa source, sa date et sa précision. Chaque seuil (limites de qualité de l'eau, classes de l'indice ATMO, zones sismiques et radon, zones de bruit) vient d'un texte réglementaire, cité dans le code.
- **Pas de note.** Pas de « quartier 7/10 » : le statut d'un thème compte seulement les alertes et vigilances déjà affichées, et une donnée manquante ne devient jamais « rien à signaler ».
- **Limites assumées.** Données communales, simulations des opérateurs, délais de publication et territoires non couverts sont signalés sur la fiche.

La liste complète des sources, licences et limites est sur la page *Sources et méthodologie* du site et dans [docs/sources.md](docs/sources.md).

## Fonctionnement

Un site statique [Astro](https://astro.build), hébergé sur GitHub Pages. Ni serveur, ni base de données, ni framework côté navigateur : quelques petits modules TypeScript.

- **Données en direct**, appelées depuis le navigateur pour les API publiques qui l'autorisent (CORS) : géocodage et calcul d'itinéraire de l'IGN, Géorisques, Hub'Eau, Atmo France, Géoplateforme (bruit), API tabulaire de data.gouv.fr (statistiques DVF, FINESS), annuaire et carte scolaire de l'Éducation nationale.
- **Données pré-calculées**, pour les jeux trop lourds ou sans API adaptée, produites par des scripts Node dans `public/data/<thème>/<département>.json` et rafraîchies par des GitHub Actions planifiées qui ouvrent une pull request :

| Script | Contenu | Taille | Mise à jour |
|---|---|---|---|
| `scripts/risks.mjs` | risques par commune (GASPAR, radon) | 7,6 Mo | mensuelle |
| `scripts/dvf.mjs` | prix immobiliers annuels par commune | 5,9 Mo | mensuelle |
| `scripts/internet.mjs` | fibre et internet fixe par commune (Arcep) | 3,5 Mo | trimestrielle |
| `scripts/shops.mjs` | commerces et services géolocalisés (BPE de l'INSEE) | 6,6 Mo | vérification mensuelle |
| `scripts/mobile.mjs` | couverture mobile en carreaux de 200 m (Arcep) | ~57 Mo | vérification deux fois par semaine |
| `scripts/routes.mjs` | grands axes dessinés sur la carte d'accueil | 7 Ko | à la main |

Les carreaux mobiles sont trop lourds pour être versionnés : `data-mobile.yml` les construit (GDAL, 7-Zip) dans un cache GitHub Actions que `deploy.yml` restaure avant le build. Ils ne sont jamais commités.

### Organisation du code

```
src/
  pages/        index (recherche et fiche), sources (méthodologie), robots, sitemap
  layouts/      Base.astro : en-tête, polices, tous les styles
  scripts/      app.ts (recherche, fiche, carte), map.ts (carte en tuiles), render.ts (blocs)
  blocks/       un chargeur par thème (appels réseau), ordre BLOCKS / GROUPS
  lib/          fonctions pures par thème (URL, lecture, vue), testées
scripts/        chaînes de données (Node, sans dépendance)
tests/          node --test, avec de vraies réponses d'API dans tests/fixtures/
```

Un bloc, c'est un `lib/<thème>.ts` pur (construction des URL, lecture des réponses, une `view` qui renvoie faits, éléments et notes) et un petit chargeur `blocks/<thème>.ts`. Le contrat est dans `src/lib/block.ts`. Le code est en anglais, l'interface en français.

## Développement

Node 24 requis.

```sh
npm install
npm run dev     # http://localhost:4321
npm test        # node --test
npm run build
```

Pour tester la couverture mobile en local, construisez les carreaux de quelques départements (GDAL et 7-Zip nécessaires) : `node scripts/mobile.mjs 75 971`.

## Contribuer

Tickets et pull requests bienvenus, en particulier pour une nouvelle source, la correction d'un chiffre ou d'une formulation, ou l'accessibilité. Merci de garder les principes ci-dessus : une source pour chaque chiffre, aucun seuil inventé, pas de note globale, et l'adresse reste dans le navigateur.

## Licence

Code sous [licence MIT](LICENSE). Les données appartiennent à leurs producteurs (IGN, BRGM, ministères, Arcep, INSEE, DGFiP, Atmo France…), sous leurs propres licences, surtout Licence Ouverte (Etalab) et ODbL, créditées sur la page *Sources et méthodologie*. Polices : Cormorant Garamond et Schibsted Grotesk, licence SIL Open Font License.
