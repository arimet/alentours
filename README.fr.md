# Mon adresse en données

[English](README.md)

Tapez une adresse en France et obtenez une fiche claire et sourcée sur cet endroit : risques naturels et industriels, eau du robinet, air, bruit, fibre et réseau mobile, prix de l'immobilier, écoles et santé. Les données sont ouvertes mais éparpillées sur une dizaine de sites ; ce projet les rassemble, les explique et cite la source de chaque chiffre.

## Principes

- **Vie privée** : l'adresse n'arrive jamais sur un serveur à nous. Elle part seulement aux API publiques qui en ont besoin, d'abord le géocodage. Le lien partageable garde le lieu dans le fragment d'URL (`#lat,lon`), que le navigateur n'envoie ni aux serveurs ni à l'outil d'audience.
- **Sources** : chaque indicateur affiche sa source, sa date de mise à jour et sa précision (adresse, bâtiment, commune). Pas de « note du quartier ».
- **Limites assumées** : une donnée absente ou seulement communale est signalée. Les cartes de couverture mobile sont des simulations des opérateurs, pas des mesures.

Le détail de chaque source, de son mode d'accès et de ses limites est dans [docs/sources.md](docs/sources.md).

## Architecture

Un site statique [Astro](https://astro.build) sur GitHub Pages, sans backend ni base de données.

- Les API publiques rapides et compatibles CORS sont appelées directement depuis le navigateur.
- Les jeux lourds (historique des ventes, fibre, couverture mobile) sont pré-calculés par des scripts Node dans `scripts/`, vers `public/data/`.

## Développement

Node 24 requis.

```sh
npm install
npm run dev     # http://localhost:4321
npm test        # node --test
npm run build
```

## Licence

Code sous [licence MIT](LICENSE). Les données appartiennent à leurs producteurs, sous leurs propres licences (surtout Licence Ouverte / Etalab et ODbL), crédités sur la page « Sources et méthodologie » du site.
