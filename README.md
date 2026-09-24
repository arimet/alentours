# Le Relevé

[Français](README.fr.md)

**What public data says about any address in France, with the source of every figure.**

Type an address and get a clear sheet about the place: natural and industrial risks, tap water quality, air quality, airport noise, fibre and mobile coverage, property prices, nearby schools, health services and everyday shops. The data is open but scattered across a dozen official sites; Le Relevé gathers it, explains it in plain French and links every number to its source.

The site is in French, for people moving house, buying, renting, or simply curious about their neighbourhood.

## What the sheet shows

| Theme | What you get | Precision |
|---|---|---|
| Risks | flood zones, clay shrink-swell, seismic zone, radon, risk prevention plans, natural disasters recognised since 1996, polluted sites and classified facilities nearby | point or commune |
| Tap water | latest sample compliance, nitrates, PFAS, pesticides, against regulatory limits | water network of the commune |
| Air | today's and tomorrow's ATMO index | commune |
| Noise | airport noise exposure and nuisance plans | zone |
| Fixed internet | share of premises with fibre, best technology, speeds, copper network closure date | commune |
| Mobile | 4G and 5G coverage for each operator (operators' simulations) | 200 m grid |
| Property | median price per m² for flats and houses, yearly trend | commune |
| Schools | nearest public schools, catchment *collège*, nearest *lycée* | point, address for the *collège* |
| Health | nearest pharmacies, GPs and emergency departments | point |
| Shops | nearest bakery, grocery, supermarket, post office, bank… | point |

Distances are **walking distances** on the IGN road graph for places within 3 km, as the crow flies beyond.

## Principles

- **Privacy.** The address never reaches a server of ours: there is none. It goes only to the public APIs that need it (geocoding first). The place lives in the URL fragment (`#lat,lon`), which browsers never send to servers or to the cookieless audience counter (GoatCounter).
- **Sources.** Every figure shows its source, its date and its precision. Every threshold (water limits, air index classes, seismic and radon zones, noise zones) comes from the regulation, cited in the code.
- **No score.** No "neighbourhood 7/10": a theme's status only counts the alerts and warnings already shown, and missing data is never turned into "nothing to report".
- **Honest limits.** Commune-level data, operator simulations, sampling delays and missing territories are said so on the sheet.

The full list of sources, licences and limits is on the site's *Sources et méthodologie* page and in [docs/sources.md](docs/sources.md).

## How it works

A static [Astro](https://astro.build) site, hosted on GitHub Pages. No backend, no database, no framework on the client: a few small TypeScript modules.

- **Live data**, fetched from the browser for public APIs that allow it (CORS): IGN geocoding and route service, Géorisques, Hub'Eau, Atmo France, the Géoplateforme (noise), data.gouv.fr tabular API (DVF statistics, FINESS), Éducation nationale directory and school catchment map.
- **Pre-computed data**, for datasets too big or without a suitable API, built by Node scripts into `public/data/<theme>/<department>.json` and refreshed by scheduled GitHub Actions that open a pull request:

| Script | Output | Size | Refresh |
|---|---|---|---|
| `scripts/risks.mjs` | risks per commune (GASPAR, radon) | 7.6 MB | monthly |
| `scripts/dvf.mjs` | yearly property prices per commune | 5.9 MB | monthly |
| `scripts/internet.mjs` | fibre and fixed internet per commune (Arcep) | 3.5 MB | quarterly |
| `scripts/shops.mjs` | geolocated shops and services (INSEE BPE) | 6.6 MB | monthly check |
| `scripts/mobile.mjs` | 200 m mobile coverage tiles (Arcep) | ~57 MB | twice a week check |
| `scripts/routes.mjs` | road corridors drawn on the home map | 7 KB | by hand |

Mobile tiles are too big to version: `data-mobile.yml` builds them (GDAL, 7-Zip) into an Actions cache that `deploy.yml` restores before the build. They are never committed.

### Code map

```
src/
  pages/        index (search and sheet), sources (methodology), robots, sitemap
  layouts/      Base.astro: head, fonts, all styles
  scripts/      app.ts (search, sheet, stage), map.ts (tile map), render.ts (blocks)
  blocks/       one loader per theme (fetching), and GROUPS / BLOCKS order
  lib/          pure functions per theme (URLs, parsing, views), tested
scripts/        data pipelines (Node, no dependency)
tests/          node --test, with real API answers in tests/fixtures/
```

A block is a pure `lib/<theme>.ts` (URL builders, parsers, a `view` returning facts, items and notes) plus a small `blocks/<theme>.ts` loader. See `src/lib/block.ts` for the contract.

## Development

Requires Node 24.

```sh
npm install
npm run dev     # http://localhost:4321
npm test        # node --test
npm run build
```

To try mobile coverage locally, build the tiles for a few departments (needs GDAL and 7-Zip): `node scripts/mobile.mjs 75 971`.

## Contributing

Issues and pull requests are welcome, especially new sources, corrections of a figure or a wording, and accessibility fixes. Please keep the principles above: a source for every figure, no invented threshold, no global score, and the address stays in the browser.

## Licence

Code under the [MIT licence](LICENSE). Data belongs to its producers (IGN, BRGM, ministries, Arcep, INSEE, DGFiP, Atmo France…) under their own licences, mostly Licence Ouverte (Etalab) and ODbL, credited on the *Sources et méthodologie* page. Fonts: Cormorant Garamond and Schibsted Grotesk, SIL Open Font License.
