/* global dagre, d3 */
'use strict';

// "Whole tree" view: everyone at once, one row per generation.
// Partners are placed side by side as one block so dagre keeps couples (and remarriages) together;
// connector lines are drawn here, genealogy-style. Clicking a card hands the person back to app.js.
// Uses el(), t(), fullName(), lifespan(), initials(), genderClass() and AVATAR_RE from app.js/i18n.js.

const OV = { cardW: 190, cardH: 64, partnerGap: 28, rankGap: 72, blockGap: 40, margin: 60 };

function createOverview(container, { onSelect }) {
  const stage = el('div', { class: 'ov-stage' });
  container.replaceChildren(stage, el('p', { class: 'ov-hint', 'data-i18n': 'overviewHint' }, t('overviewHint')));
  let size = { width: 0, height: 0 };

  const zoom = d3
    .zoom()
    .scaleExtent([0.05, 2])
    .on('zoom', (e) => {
      const { x, y, k } = e.transform;
      stage.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
    });
  d3.select(container).call(zoom).on('dblclick.zoom', null);

  return { render, fit };

  function render(people, focusedId) {
    const { pos, families, partnerPairs, width, height } = layout(people);
    size = { width, height };
    stage.style.width = `${width}px`;
    stage.style.height = `${height}px`;
    stage.replaceChildren(
      drawLinks(pos, families, partnerPairs, width, height),
      ...people.map((p) => drawCard(p, pos.get(p.id), p.id === focusedId)),
    );
  }

  function fit() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h || !size.width) return;
    const k = Math.min(1, w / size.width, h / size.height);
    const x = (w - size.width * k) / 2;
    const y = (h - size.height * k) / 2;
    d3.select(container).call(zoom.transform, d3.zoomIdentity.translate(x, y).scale(k));
  }

  function drawCard(person, at, isFocused) {
    const unknown = Boolean(person.unknown);
    const name = unknown ? t('unknown') : fullName(person) || t('unnamed');
    const avatar = person.data.avatar;
    const classes = ['ov-card', genderClass(person.data.gender), unknown ? 'unknown' : '', isFocused ? 'is-focused' : '']
      .filter(Boolean)
      .join(' ');

    const card = el(
      'button',
      { type: 'button', class: classes, title: name },
      avatar && AVATAR_RE.test(avatar)
        ? el('img', { class: 'ov-photo', src: avatar, alt: '' })
        : el('span', { class: 'ov-photo placeholder', 'aria-hidden': 'true' }, unknown ? '?' : initials(name)),
      el('span', { class: 'ov-text' }, el('span', { class: 'ov-name' }, name), el('span', { class: 'ov-years' }, lifespan(person))),
    );
    card.style.left = `${at.x}px`;
    card.style.top = `${at.y}px`;
    card.addEventListener('click', () => onSelect(person.id));
    return card;
  }
}

function layout(people) {
  const byId = new Map(people.map((p) => [p.id, p]));

  // 1. Partner blocks: each group of people connected by partnerships, in chain order.
  const blockOf = new Map();
  const blocks = [];
  for (const p of people) {
    if (blockOf.has(p.id)) continue;
    const block = { id: `b${blocks.length}`, members: partnerChain(p.id, byId) };
    block.members.forEach((id) => blockOf.set(id, block));
    blocks.push(block);
  }

  // 2. dagre places the blocks. Its result depends on input order, so try a few orders (and partner
  //    directions) and keep the layout whose parent→child lines cross the least.
  const parentLinks = people.flatMap((p) => p.rels.parents.filter((id) => byId.has(id)).map((parentId) => [parentId, p.id]));
  const random = seededRandom(people.length);
  const tries = people.length > 200 ? 3 : 10;
  let best = null;
  for (let i = 0; i < tries; i++) {
    const order = i === 0 ? blocks : shuffled(blocks, random);
    const flips = new Set(i === 0 ? [] : blocks.filter(() => random() < 0.5));
    const attempt = placeBlocks(order, flips, blockOf, parentLinks);
    const score = layoutScore(attempt.pos, parentLinks);
    if (!best || score < best.score) best = { ...attempt, score };
  }
  const { pos, width, height } = best;

  // Families: children grouped by their exact set of parents.
  const families = new Map();
  for (const p of people) {
    const parents = p.rels.parents.filter((id) => pos.has(id));
    if (!parents.length) continue;
    const key = [...parents].sort().join('+');
    if (!families.has(key)) families.set(key, { parents, children: [] });
    families.get(key).children.push(p.id);
  }

  const partnerPairs = [];
  for (const p of people) {
    for (const s of p.rels.spouses) if (p.id < s && pos.has(s)) partnerPairs.push([p.id, s]);
  }

  return { pos, families: [...families.values()], partnerPairs, width, height };
}

// One dagre run: a node per block, an edge from each parent's block to the child's block.
// Returns card positions (top-left corners); `flipped` blocks list their partners right to left.
function placeBlocks(blocks, flipped, blockOf, parentLinks) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: OV.blockGap, ranksep: OV.rankGap, marginx: OV.margin, marginy: OV.margin });
  g.setDefaultEdgeLabel(() => ({}));
  for (const b of blocks) {
    g.setNode(b.id, { width: b.members.length * OV.cardW + (b.members.length - 1) * OV.partnerGap, height: OV.cardH });
  }
  for (const [parentId, childId] of parentLinks) {
    const from = blockOf.get(parentId);
    const to = blockOf.get(childId);
    if (from !== to) g.setEdge(from.id, to.id);
  }
  dagre.layout(g);

  const pos = new Map();
  for (const b of blocks) {
    const n = g.node(b.id);
    let x = n.x - n.width / 2;
    for (const id of flipped.has(b) ? [...b.members].reverse() : b.members) {
      pos.set(id, { x, y: n.y - OV.cardH / 2 });
      x += OV.cardW + OV.partnerGap;
    }
  }
  return { pos, width: g.graph().width, height: g.graph().height };
}

// Lower is better: crossing parent→child lines first, then total sideways distance.
function layoutScore(pos, parentLinks) {
  const lines = parentLinks.map(([parentId, childId]) => ({
    parentId,
    childId,
    top: pos.get(parentId).y,
    bottom: pos.get(childId).y,
    x1: pos.get(parentId).x,
    x2: pos.get(childId).x,
  }));
  let crossings = 0;
  let distance = 0;
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i];
    distance += Math.abs(a.x1 - a.x2);
    for (let j = i + 1; j < lines.length; j++) {
      const b = lines[j];
      if (a.top !== b.top || a.bottom !== b.bottom) continue;
      if (a.parentId === b.parentId || a.childId === b.childId) continue;
      if ((a.x1 - b.x1) * (a.x2 - b.x2) < 0) crossings++;
    }
  }
  return crossings * 1e6 + distance;
}

function shuffled(items, random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Small deterministic PRNG (mulberry32) so the same tree always gets the same layout.
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Members of one partnership group, ordered so partners sit next to each other where possible.
function partnerChain(startId, byId) {
  const group = new Set();
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop();
    if (group.has(id) || !byId.has(id)) continue;
    group.add(id);
    stack.push(...byId.get(id).rels.spouses);
  }
  const partners = (id) => byId.get(id).rels.spouses.filter((s) => group.has(s));
  const start = [...group].find((id) => partners(id).length <= 1) ?? startId;

  const order = [];
  const walk = (id) => {
    if (order.includes(id)) return;
    order.push(id);
    partners(id).forEach(walk);
  };
  walk(start);
  return order;
}

function drawLinks(pos, families, partnerPairs, width, height) {
  const { cardW, cardH, rankGap } = OV;
  const center = (id) => pos.get(id).x + cardW / 2;
  const paths = [];

  // Partner line between the two cards, at mid height.
  for (const [a, b] of partnerPairs) {
    const [left, right] = pos.get(a).x < pos.get(b).x ? [a, b] : [b, a];
    if (pos.get(left).y !== pos.get(right).y) continue; // different rows; the child lines still connect them
    const y = pos.get(left).y + cardH / 2;
    paths.push(`M${pos.get(left).x + cardW},${y}H${pos.get(right).x}`);
  }

  // Parent(s) → horizontal bar → each child.
  const barsPerRow = new Map();
  for (const family of families) {
    const [p1, p2] = family.parents;
    const sameRow = p2 && pos.get(p1).y === pos.get(p2).y;
    const origins = sameRow
      ? [{ x: (center(p1) + center(p2)) / 2, y: pos.get(p1).y + cardH / 2 }]
      : family.parents.map((id) => ({ x: center(id), y: pos.get(id).y + cardH }));

    const childTop = Math.min(...family.children.map((id) => pos.get(id).y));
    const row = Math.round(childTop);
    const index = barsPerRow.get(row) || 0; // stagger bars that share a row so they stay distinguishable
    barsPerRow.set(row, index + 1);
    const barY = childTop - rankGap / 2 + (index % 4) * 6 - 9;

    const xs = [...origins.map((o) => o.x), ...family.children.map(center)];
    for (const o of origins) paths.push(`M${o.x},${o.y}V${barY}`);
    paths.push(`M${Math.min(...xs)},${barY}H${Math.max(...xs)}`);
    for (const id of family.children) paths.push(`M${center(id)},${barY}V${pos.get(id).y}`);
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ov-links');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', paths.join(''));
  svg.append(path);
  return svg;
}
