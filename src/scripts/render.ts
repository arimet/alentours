import { formatWalk } from '../lib/walk';
import { LEVELS, formatDistance, summarize, type Block, type BlockView, type Context } from '../lib/block';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const skeleton = () => el('div', { className: 'skeleton', ariaHidden: 'true' }, el('span'), el('span'), el('span'));

/** Items shown before "Voir les autres". */
const SHOWN = 5;

const distanceText = (i: NonNullable<BlockView['items']>[number]) =>
  i.walk ? formatWalk(i.walk) : i.distance !== undefined ? `${formatDistance(i.distance)} à vol d’oiseau` : '';

// A block reads as an editorial row: key facts side by side, one sentence, a compact list,
// and the limits folded away (they stay one click from every figure).
const view = (v: BlockView) => {
  const frag = document.createDocumentFragment();
  frag.append(el('dl', { className: 'facts' }, ...v.facts.map((f) => {
    const level = f.level && LEVELS[f.level];
    return el('div', { className: `fact${f.level ? ` level-${f.level}` : ''}` },
      el('dt', {}, f.label),
      el('dd', {},
        el('span', { className: 'fact-value' },
          ...(level ? [el('span', { className: 'level-icon', ariaHidden: 'true' }, level.icon), el('span', { className: 'sr-only' }, `${level.text} : `)] : []),
          f.value),
        ...(f.detail ? [el('span', { className: 'detail' }, f.detail)] : [])));
  })));
  frag.append(el('p', { className: 'explanation' }, v.explanation));
  if (v.items?.length) {
    const li = (i: NonNullable<BlockView['items']>[number]) => el('li', {},
      i.url ? el('a', { href: i.url, rel: 'noopener', className: 'item-name' }, i.name) : el('span', { className: 'item-name' }, i.name),
      ...(i.detail ? [el('span', { className: 'detail' }, i.detail)] : []),
      ...(distanceText(i) ? [el('span', { className: 'item-dist' }, distanceText(i))] : []));
    frag.append(el('ul', { className: 'items' }, ...v.items.slice(0, SHOWN).map(li)));
    const rest = v.items.slice(SHOWN);
    if (rest.length) frag.append(el('details', { className: 'more' }, el('summary', {}, `Voir ${rest.length > 1 ? `les ${rest.length} autres` : 'l’autre'}`), el('ul', { className: 'items' }, ...rest.map(li))));
  }
  if (v.notes?.length)
    frag.append(el('details', { className: 'notes' },
      el('summary', {}, `Limites et précisions (${v.notes.length})`),
      ...v.notes.map((n) => typeof n === 'string'
        ? el('p', { className: 'note' }, n)
        : el('p', { className: 'note' }, `${n.text} `, el('a', { href: n.link.url, rel: 'noopener' }, n.link.label), '.'))));
  return frag;
};

const provenance = (v: BlockView) => el('p', { className: 'provenance' },
  el('span', {}, el('span', { className: 'prov-k' }, 'Précision '), v.precision),
  el('span', {}, el('span', { className: 'prov-k' }, 'Source '), el('a', { href: v.source.url, rel: 'noopener' }, `${v.source.name} ↗`), v.source.updated ? `, ${v.source.updated}` : ''));

const statusChip = (v: BlockView) => {
  const st = summarize(v.facts);
  return st ? el('span', { className: `status-chip level-${st.level}` }, el('span', { className: 'level-icon', ariaHidden: 'true' }, LEVELS[st.level].icon), st.text) : null;
};

type Options = {
  groups: { title: string; ids: string[] }[];
  /** Sommaire filled with one link per block, its status added once loaded. */
  toc?: HTMLElement;
  /** Blocks drawn on the map get a "Voir sur la carte" button. */
  onMap?: { ids: string[]; show: (id: string) => void };
  /** Gets each block's view once loaded (null on error), for the key figures and the map. */
  onDone?: (b: Block, v: BlockView | null) => void;
};

export const mountBlocks = (container: HTMLElement, blocks: Block[], ctx: Context, { groups, toc, onMap, onDone }: Options) => {
  container.replaceChildren();
  toc?.replaceChildren();
  for (const g of groups) {
    const members = g.ids.map((id) => blocks.find((b) => b.id === id)).filter((b): b is Block => !!b);
    const tocList = el('ul');
    toc?.append(el('li', {}, el('span', { className: 'toc-group' }, g.title), tocList));
    const group = el('section', { className: 'group' }, el('h2', { className: 'group-title' }, g.title));
    container.append(group);
    for (const b of members) {
      const tocLink = el('a', { href: `#bloc-${b.id}`, onclick: (e: Event) => { e.preventDefault(); section.scrollIntoView({ behavior: 'smooth' }); } }, b.title);
      tocList.append(el('li', {}, tocLink));
      const body = el('div', { className: 'block-body' }, skeleton());
      const title = el('div', { className: 'block-title' }, el('h3', {}, b.title));
      const head = el('div', { className: 'block-head' }, title);
      if (onMap?.ids.includes(b.id)) head.append(el('button', { type: 'button', className: 'to-map', onclick: () => onMap.show(b.id) }, 'Voir sur la carte ↑'));
      const section = el('section', { className: 'block', id: `bloc-${b.id}` }, head, body);
      section.setAttribute('aria-busy', 'true');
      group.append(section);
      // Each block loads on its own: a slow or failing source never blocks the others.
      b.load(ctx)
        .then((v) => {
          body.replaceChildren(view(v));
          head.after(provenance(v));
          const chip = statusChip(v);
          if (chip) title.append(chip);
          onDone?.(b, v);
        })
        .catch((e) => {
          body.replaceChildren(el('p', { className: 'error' }, `Donnée indisponible pour l’instant : ${e instanceof Error ? e.message : 'erreur inconnue'}.`));
          onDone?.(b, null);
        })
        .finally(() => section.removeAttribute('aria-busy'));
    }
  }
  // Highlight the sommaire entry of the block in view.
  if (toc) {
    const links = new Map([...toc.querySelectorAll<HTMLAnchorElement>('a')].map((a) => [a.hash.slice(1), a]));
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) {
        links.forEach((a) => a.removeAttribute('aria-current'));
        links.get(e.target.id)?.setAttribute('aria-current', 'true');
      }
    }, { rootMargin: '-30% 0px -60% 0px' });
    container.querySelectorAll('.block').forEach((s) => io.observe(s));
  }
};
