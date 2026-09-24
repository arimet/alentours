import type { APIRoute } from 'astro';
import { absoluteUrl } from '../lib/url';

export const GET: APIRoute = () => new Response(`User-agent: *\nAllow: /\n\nSitemap: ${absoluteUrl('/sitemap.xml')}\n`);
