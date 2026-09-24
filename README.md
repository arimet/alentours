# Mon adresse en données

[Français](README.fr.md)

Type a French address and get a clear, sourced sheet about the place: natural and industrial risks, tap water, air, noise, fibre and mobile coverage, property prices, schools, health services and everyday shops. The data is open but scattered across a dozen sites; this project gathers it, explains it and cites the source of every figure.

## Principles

- **Privacy**: the address never reaches a server of ours. It only goes to the public APIs that need it (geocoding first). Shareable links keep the place in the URL fragment (`#lat,lon`), which browsers never send to servers or to the audience counter.
- **Sources**: every indicator shows its source, its update date and its precision (address, building, commune). No overall "neighbourhood score".
- **Honest limits**: missing or commune-level data is said so. Mobile coverage maps are operator simulations, not measurements.

See [docs/sources.md](docs/sources.md) for each data source, its access mode and its limits.

## Architecture

A static [Astro](https://astro.build) site on GitHub Pages, no backend and no database.

- Fast, CORS-enabled public APIs are called directly from the browser.
- Heavy datasets (property sales history, fibre, mobile coverage) are pre-computed by Node scripts in `scripts/` into `public/data/`.

## Development

Requires Node 24.

```sh
npm install
npm run dev     # http://localhost:4321
npm test        # node --test
npm run build
```

## Licence

Code under the [MIT licence](LICENSE). Data belongs to its producers, under their own licences (mostly Licence Ouverte / Etalab and ODbL), credited on the site's "Sources et méthodologie" page.
