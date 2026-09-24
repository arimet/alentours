import { formatWalk } from '../lib/walk';
import { LEVELS, formatDistance, type Block, type BlockView, type Context } from '../lib/block';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const skeleton = () => el('div', { className: 'skeleton', ariaHidden: 'true' }, el('span'), el('span'), el('span'));

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
  if (v.items?.length)
    frag.append(el('ul', { className: 'items' }, ...v.items.map((i) => el('li', {},
      i.url ? el('a', { href: i.url, rel: 'noopener', className: 'item-name' }, i.name) : el('span', { className: 'item-name' }, i.name),
      ...(i.detail ? [el('span', { className: 'detail' }, i.detail)] : []),
      ...(distanceText(i) ? [el('span', { className: 'item-dist' }, distanceText(i))] : [])))));
  if (v.notes?.length)
    frag.append(el('details', { className: 'notes' },
      el('summary', {}, `Limites et précisions (${v.notes.length})`),
      ...v.notes.map((n) => typeof n === 'string'
        ? el('p', { className: 'note' }, n)
        : el('p', { className: 'note' }, `${n.text} `, el('a', { href: n.link.url, rel: 'noopener' }, n.link.label), '.'))));
  return frag;
};

const provenance = (v: BlockView) => el('p', { className: 'provenance' },
  el('span', {}, `Précision : ${v.precision}`),
  el('span', {}, 'Source : ', el('a', { href: v.source.url, rel: 'noopener' }, v.source.name), v.source.updated ? `, ${v.source.updated}` : ''));

/** `onDone` gets each block's view once loaded (null on error), for the key figures and the map. */
export const mountBlocks = (container: HTMLElement, blocks: Block[], ctx: Context, onDone?: (b: Block, v: BlockView | null) => void) => {
  container.replaceChildren();
  for (const b of blocks) {
    const body = el('div', { className: 'block-body' }, skeleton());
    const head = el('div', { className: 'block-head' }, el('h2', {}, b.title));
    const section = el('section', { className: 'block', id: `bloc-${b.id}` }, head, body);
    section.setAttribute('aria-busy', 'true');
    container.append(section);
    // Each block loads on its own: a slow or failing source never blocks the others.
    b.load(ctx)
      .then((v) => { body.replaceChildren(view(v)); head.append(provenance(v)); onDone?.(b, v); })
      .catch((e) => { body.replaceChildren(el('p', { className: 'error' }, `Donnée indisponible pour l’instant : ${e instanceof Error ? e.message : 'erreur inconnue'}.`)); onDone?.(b, null); })
      .finally(() => section.removeAttribute('aria-busy'));
  }
};
