import { defineConfig } from 'astro/config';

// SITE_URL and BASE_PATH are set by the deploy workflow (GitHub Pages).
// The site fallback keeps absolute URLs (canonical, Open Graph, sitemap) well-formed in local builds.
export default defineConfig({
  site: process.env.SITE_URL || 'https://arimet.github.io',
  base: process.env.BASE_PATH || '/',
});
