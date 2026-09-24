import type { APIRoute } from 'astro';
import { absoluteUrl } from '../lib/url';

// Address sheets live in the URL fragment and are not indexable, on purpose (privacy).
export const GET: APIRoute = () => new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${['/', '/sources/'].map((p) => `  <url><loc>${absoluteUrl(p)}</loc></url>`).join('\n')}
</urlset>
`, { headers: { 'Content-Type': 'application/xml' } });
