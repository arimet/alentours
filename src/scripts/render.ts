import { formatWalk } from '../lib/walk';
import { LEVELS, formatDistance, type Block, type BlockView, type Context } from '../lib/block';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const skeleton = () => el('div', { className: 'skeleton', ariaHidden: 'true' }, el('span'), el('span'), el('span'));

const view = (v: BlockView) => {
  const frag = document.createDocumentFragment();
  frag.append(el('dl', { className: 'facts' }, ...v.facts.flatMap((f) => {
    const level = f.level && LEVELS[f.level];
    return [
      el('dt', {}, f.label),
      el('dd', { className: f.level ? `level level-${f.level}` : '' },
        ...(level ? [el('span', { className: 'level-icon', ariaHidden: 'true' }, level.icon), el('span', { className: 'sr-only' }, `${level.text} : `)] : []),
        el('strong', {}, f.value),
        ...(f.detail ? [el('span', { className: 'detail' }, f.detail)] : [])),
    ];
  })));
  frag.append(el('p', { className: 'explanation' }, v.explanation));
  if (v.items?.length)
    frag.append(el('ul', { className: 'items' }, ...v.items.map((i) => el('li', {},
      i.url ? el('a', { href: i.url, rel: 'noopener' }, i.name) : el('span', { className: 'item-name' }, i.name),
      ...(i.detail || i.walk || i.distance !== undefined
        ? [el('span', { className: 'detail' }, [i.detail, i.walk ? formatWalk(i.walk) : i.distance !== undefined && `${formatDistance(i.distance)} à vol d’oiseau`].filter(Boolean).join(', '))]
        : [])))));
  for (const n of v.notes ?? [])
    frag.append(typeof n === 'string'
      ? el('p', { className: 'note' }, n)
      : el('p', { className: 'note' }, `${n.text} `, el('a', { href: n.link.url, rel: 'noopener' }, n.link.label), '.'));
  frag.append(el('p', { className: 'provenance' },
    `Précision : ${v.precision}. `,
    'Source : ', el('a', { href: v.source.url, rel: 'noopener' }, v.source.name),
    v.source.updated ? `, données du ${v.source.updated}.` : '.'));
  return frag;
};

/** `onDone` gets each block's view once loaded (null on error), for the key figures and the map. */
export const mountBlocks = (container: HTMLElement, blocks: Block[], ctx: Context, onDone?: (b: Block, v: BlockView | null) => void) => {
  container.replaceChildren();
  for (const b of blocks) {
    const body = el('div', { className: 'block-body' }, skeleton());
    const section = el('section', { className: 'block', id: `bloc-${b.id}` }, el('h2', {}, b.title), body);
    section.setAttribute('aria-busy', 'true');
    container.append(section);
    // Each block loads on its own: a slow or failing source never blocks the others.
    b.load(ctx)
      .then((v) => { body.replaceChildren(view(v)); onDone?.(b, v); })
      .catch((e) => { body.replaceChildren(el('p', { className: 'error' }, `Donnée indisponible pour l’instant : ${e instanceof Error ? e.message : 'erreur inconnue'}.`)); onDone?.(b, null); })
      .finally(() => section.removeAttribute('aria-busy'));
  }
};
