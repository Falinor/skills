// The stand-up page: one self-contained HTML file. Cards for every item sit
// in three sections; each item's details sit in one dialog, shown one at a
// time and reached by #id. Its only script opens and walks that dialog; the
// Content-Security-Policy allows that script by hash and nothing else.
import { createHash } from 'node:crypto';
import { longDate } from './dates.ts';
import { escape } from './html.ts';
import type { Labels } from './labels.ts';
import { badge, sourceOf } from './links.ts';
import type { Item, Plan } from './plan.ts';
import type { Section } from './sections.ts';
import { blocks, inline } from './text.ts';
import type { Context } from './work-folder.ts';

const styles = `
:root {
  --bg: #f4f4f9; --surface: #ffffff; --fg: #161628; --muted: #565672; --line: #d9d9e6;
  --accent: #000091; --accent-soft: #e8e8fb; --ok: #18753c; --ok-soft: #e3f3e8;
  --warn: #9a3d00; --warn-soft: #fdeee2; --draft: #5a5a6e; --draft-soft: #ececf2;
  --backdrop: rgba(22, 22, 40, .55);
  --font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #11111c; --surface: #1a1a29; --fg: #ececf6; --muted: #a6a6c0; --line: #2e2e46;
    --accent: #9a9aff; --accent-soft: #23234a; --ok: #5fd08f; --ok-soft: #173325;
    --warn: #f3a463; --warn-soft: #3a2616; --draft: #b4b4c8; --draft-soft: #2a2a3c;
    --backdrop: rgba(0, 0, 0, .7); color-scheme: dark;
  }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 400 15px/1.55 var(--font); padding: 32px max(16px, env(safe-area-inset-right)) 64px max(16px, env(safe-area-inset-left)); }
.wrap { max-width: 1120px; margin: 0 auto; display: grid; gap: 48px; }
.sections { display: grid; gap: 48px; min-width: 0; }
h1, h2, h3, h4 { margin: 0; text-wrap: balance; }
code { font-family: var(--mono); font-size: .86em; background: var(--draft-soft); padding: .08em .35em; border-radius: 4px; overflow-wrap: anywhere; }
a { color: var(--accent); }
:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.icon { width: 14px; height: 14px; flex: none; fill: currentColor; }
.icon-line { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

.top { display: grid; gap: 14px; }
.eyebrow { font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
h1 { font-size: clamp(28px, 4.2vw, 40px); line-height: 1.1; font-weight: 700; letter-spacing: -.01em; }
.tally { display: flex; flex-wrap: wrap; gap: 8px 20px; margin: 4px 0 0; padding: 0; list-style: none; font-variant-numeric: tabular-nums; }
.tally li { display: flex; align-items: baseline; gap: 6px; color: var(--muted); }
.tally b { font-size: 20px; line-height: 1; color: var(--fg); }
.banner { display: grid; gap: 4px; background: var(--ok-soft); border: 1px solid color-mix(in srgb, var(--ok) 35%, transparent); border-radius: 8px; padding: 12px 16px; }
.banner p { margin: 0; }

section.day { display: grid; gap: 20px; }
.day-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; border-bottom: 2px solid var(--fg); padding-bottom: 10px; }
.day-head h2 { font-size: 24px; font-weight: 700; }
.day-head .when { color: var(--muted); }
.day-head .count { margin-left: auto; font-variant-numeric: tabular-nums; color: var(--muted); font-size: 14px; }
.groups { display: grid; gap: 40px; }
.group { display: grid; gap: 12px; }
.group h3 { font-size: 13px; font-weight: 600; line-height: 1.3; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.group .hint { margin: -6px 0 0; color: var(--muted); font-size: 14px; max-width: 75ch; }
.nothing { margin: 0; color: var(--muted); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); gap: 12px; }

.card { position: relative; display: grid; grid-template-rows: auto auto 1fr auto; gap: 8px; min-width: 0; padding: 14px 16px 12px; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; transition: border-color .15s, transform .15s, box-shadow .15s; }
.card:hover { border-color: var(--accent); box-shadow: 0 2px 0 var(--accent); transform: translateY(-1px); }
.card:has(.card-link:focus-visible) { outline: 3px solid var(--accent); outline-offset: 2px; }
.card-link { color: inherit; text-decoration: none; }
.card-link:focus-visible { outline: none; }
.card-link::after { content: ""; position: absolute; inset: 0; border-radius: 8px; }
.card-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-width: 0; }
.kind { font: 400 12px/1.3 var(--mono); color: var(--muted); min-width: 0; }
.card h4 { font-size: 16px; font-weight: 600; line-height: 1.3; }
.card p { margin: 0; color: var(--muted); font-size: 14px; }
.card-foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums; padding-top: 6px; border-top: 1px dashed var(--line); }
.card-foot .more { color: var(--accent); font-weight: 500; white-space: nowrap; }

.pill { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; line-height: 1; padding: 4px 8px; border-radius: 999px; white-space: nowrap; }
.pill::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.tone-ok { color: var(--ok); background: var(--ok-soft); }
.tone-review, .tone-todo { color: var(--accent); background: var(--accent-soft); }
.tone-draft { color: var(--draft); background: var(--draft-soft); }
.tone-warn { color: var(--warn); background: var(--warn-soft); }

dialog { width: min(780px, calc(100vw - 32px)); max-height: calc(100vh - 48px); padding: 0; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--fg); overflow-y: auto; overflow-x: hidden; }
dialog::backdrop { background: var(--backdrop); }
@media (prefers-reduced-motion: no-preference) {
  dialog[open] { animation: zoom .18s ease-out; }
  @keyframes zoom { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: none; } }
}
.dlg-bar { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: var(--surface); border-bottom: 1px solid var(--line); }
.dlg-bar .where { font-size: 13px; color: var(--muted); margin-right: auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.btn { font: 500 13px/1 var(--font); color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; cursor: pointer; }
.btn:hover { border-color: var(--accent); color: var(--accent); }
.btn:disabled { opacity: .4; cursor: default; border-color: var(--line); color: var(--fg); }
.detail { padding: 20px 22px 26px; display: grid; gap: 22px; }
.detail-head { display: grid; gap: 10px; }
.detail-head h2 { font-size: 24px; line-height: 1.2; }
.detail-head p { margin: 0; color: var(--muted); }
.block { display: grid; gap: 8px; }
.block h3 { font-size: 12px; font-weight: 600; line-height: 1.3; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); }
.product { background: var(--accent-soft); border-radius: 8px; padding: 14px 16px; display: grid; gap: 10px; }
.product p, .product ul { margin: 0; max-width: 68ch; }
.product ul { padding-left: 1.2em; display: grid; gap: 4px; }
.tech { margin: 0; padding-left: 1.2em; display: grid; gap: 6px; font-size: 14px; }
.links { list-style: none; margin: 0; padding: 0; display: grid; gap: 7px; }
.links li { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 4px 10px; min-width: 0; line-height: 22px; }
.links a { display: flex; align-items: flex-start; gap: 10px; min-width: 0; overflow-wrap: anywhere; text-decoration: none; }
.links .label { text-decoration: underline; text-underline-offset: 2px; }
.links .src { flex: none; width: 82px; height: 22px; display: inline-flex; align-items: center; gap: 6px; font: 500 11px/1 var(--mono); text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
.links .src .icon { color: var(--fg); }
.links .src-text { text-box: trim-both cap alphabetic; }

@media (max-width: 520px) {
  body { padding-top: 20px; padding-bottom: 48px; }
  .day-head .count { margin-left: 0; width: 100%; }
  .detail { padding: 16px 16px 22px; }
}
`;

const script = String.raw`addEventListener('DOMContentLoaded', () => {
  const dialog = document.getElementById('detail');
  const panels = Array.from(dialog.querySelectorAll('.detail'));
  const order = panels.map((panel) => panel.dataset.id);
  const where = document.getElementById('detail-where');
  const previous = document.getElementById('detail-previous');
  const next = document.getElementById('detail-next');
  const close = document.getElementById('detail-close');
  let current = null;

  function show(id) {
    current = id;
    for (const panel of panels) panel.hidden = panel.dataset.id !== id;
    const panel = panels[order.indexOf(id)];
    dialog.setAttribute('aria-labelledby', 'title-' + id);
    where.textContent = panel.dataset.where;
    const index = order.indexOf(id);
    previous.disabled = index <= 0;
    next.disabled = index >= order.length - 1;
    dialog.scrollTop = 0;
    if (!dialog.open) dialog.showModal();
    close.focus();
  }

  function go(id) {
    if (location.hash.slice(1) === id) show(id);
    else location.hash = id;
  }

  function fromHash() {
    const id = location.hash.slice(1);
    if (order.includes(id)) show(id);
    else if (dialog.open) dialog.close();
  }

  dialog.addEventListener('close', () => {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch {
      // Some browsers refuse history changes on file: pages; the hash then stays.
    }
    const card = current && document.getElementById('link-' + current);
    if (card) card.focus();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  close.addEventListener('click', () => dialog.close());
  previous.addEventListener('click', () => {
    const index = order.indexOf(current);
    if (index > 0) go(order[index - 1]);
  });
  next.addEventListener('click', () => {
    const index = order.indexOf(current);
    if (index < order.length - 1) go(order[index + 1]);
  });
  addEventListener('hashchange', fromHash);
  fromHash();
});`;

const scriptHash = createHash('sha256').update(script).digest('base64');

const capitalize = (text: string, lang: string) => text.charAt(0).toLocaleUpperCase(lang) + text.slice(1);

function pill(item: Item): string {
  return `<span class="pill tone-${item.status.tone}">${escape(item.status.label)}</span>`;
}

function card(item: Item, labels: Labels): string {
  return `<article class="card" id="card-${item.id}">
  <div class="card-top"><span class="kind">${escape(item.kind)}</span>${pill(item)}</div>
  <h4><a class="card-link" id="link-${item.id}" href="#${item.id}">${escape(item.title)}</a></h4>
  <p>${escape(item.summary)}</p>
  <div class="card-foot"><span>${escape(item.refs)}</span><span class="more" aria-hidden="true">${escape(labels.details)} →</span></div>
</article>`;
}

function detail(item: Item, where: string, labels: Labels): string {
  const links = item.links
    .map((link) => {
      const source = sourceOf(link.url);
      return `<li data-source="${source}"><a href="${escape(link.url)}" target="_blank" rel="noopener">${badge(source, labels)}<span class="label">${escape(link.label)}</span></a></li>`;
    })
    .join('');
  return `<section class="detail" data-id="${item.id}" data-where="${escape(where)}" hidden>
  <div class="detail-head">
    <div class="card-top"><span class="kind">${escape(item.kind)} · ${escape(item.refs)}</span>${pill(item)}</div>
    <h2 id="title-${item.id}">${escape(item.title)}</h2>
    <p>${escape(item.summary)}</p>
  </div>
  <div class="block"><h3>${escape(labels.product)}</h3><div class="product">${blocks(item.product)}</div></div>
  <div class="block"><h3>${escape(labels.tech)}</h3><ul class="tech">${item.tech.map((line) => `<li>${inline(line)}</li>`).join('')}</ul></div>
  ${item.links.length ? `<div class="block"><h3>${escape(labels.links)}</h3><ul class="links">${links}</ul></div>` : ''}
</section>`;
}

function renderSection(section: Section, labels: Labels): string {
  const total = section.groups.reduce((count, group) => count + group.items.length, 0);
  const count = `${total} ${total === 1 ? labels.item : labels.items}`;
  const body = section.groups.length
    ? `<div class="groups">${section.groups
        .map(
          (group) => `<div class="group">
  <h3>${escape(group.title)}</h3>
  ${group.hint ? `<p class="hint">${inline(group.hint)}</p>` : ''}
  <div class="grid">${group.items.map((item) => card(item, labels)).join('\n')}</div>
</div>`,
        )
        .join('\n')}</div>`
    : `<p class="nothing">${escape(labels.nothing)}</p>`;
  return `<section class="day" aria-labelledby="section-${section.key}">
  <div class="day-head"><h2 id="section-${section.key}">${escape(section.title)}</h2>${section.when ? `<span class="when">${escape(section.when)}</span>` : ''}<span class="count">${escape(count)}</span></div>
  ${body}
</section>`;
}

/** The whole page for a validated plan. */
export function renderPage(plan: Plan, sections: Section[], labels: Labels, context: Context): string {
  const date = capitalize(longDate(context.today, context.lang), context.lang);
  const details = sections.flatMap((section) =>
    section.groups.flatMap((group) => group.items.map((item) => detail(item, `${section.title} · ${group.title}`, labels))),
  );
  const tally = plan.tally?.length
    ? `<ul class="tally" aria-label="${escape(labels.inNumbers)}">${plan.tally
        .map((count) => `<li><b>${escape(String(count.value))}</b> ${escape(count.label)}</li>`)
        .join('')}</ul>`
    : '';
  const banner = plan.banner ? `<div class="banner" role="note">${blocks(plan.banner)}</div>` : '';

  return `<!doctype html>
<html lang="${escape(context.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${scriptHash}'">
<title>${escape(labels.standUp)} · ${escape(date)}</title>
<style>${styles}</style>
<script>${script}</script>
</head>
<body>
<div class="wrap">
<header class="top">
  <span class="eyebrow">${escape(labels.standUp)}</span>
  <h1>${escape(date)}</h1>
  ${tally}
  ${banner}
</header>
<main class="sections">
${sections.map((section) => renderSection(section, labels)).join('\n')}
</main>
</div>
<dialog id="detail" aria-labelledby="detail-where">
  <div class="dlg-bar">
    <span class="where" id="detail-where"></span>
    <button class="btn" type="button" id="detail-previous"><span aria-hidden="true">←</span> ${escape(labels.previous)}</button>
    <button class="btn" type="button" id="detail-next">${escape(labels.next)} <span aria-hidden="true">→</span></button>
    <button class="btn" type="button" id="detail-close">${escape(labels.close)}</button>
  </div>
  ${details.join('\n')}
</dialog>
</body>
</html>
`;
}
