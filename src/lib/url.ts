// BASE_URL is "/" locally and "/<repo>" on GitHub Pages without a custom domain.
// Page paths get a trailing slash (GitHub Pages serves /page/ and redirects /page);
// file paths (with an extension) and hashes are left as is.
export const url = (path: string) => {
  const [pathname, hash] = path.split('#');
  const isFile = /\.[a-z0-9]+$/i.test(pathname);
  const page = isFile || pathname.endsWith('/') ? pathname : `${pathname}/`;
  return import.meta.env.BASE_URL.replace(/\/$/, '') + page + (hash === undefined ? '' : `#${hash}`);
};
/** Absolute URL of a site path (for canonical, Open Graph, sitemap). `site` is always set, see astro.config.mjs. */
export const absoluteUrl = (path: string) => new URL(url(path), import.meta.env.SITE).href;
