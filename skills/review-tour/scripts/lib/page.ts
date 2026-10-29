// Builds the tour page as one self-contained HTML file. Every piece of text
// from the tour plan or the patch goes through `escape`, or through the
// escaping Markdown subset for prose. Its one script only navigates; the
// Content-Security-Policy allows that script by hash and nothing else.
import { createHash } from 'node:crypto';
import { describeFollowUp } from './follow-up.ts';
import { inlineMarkdown, markdown } from './markdown.ts';
import type { FileDiff, Hunk } from './patch.ts';
import { tierLabels, tiers, type Callout, type Intent, type Step, type TourPlan, type Trace } from './plan.ts';
import { describeProofs, isProven, type Change, type ChangedFile } from './work-folder.ts';

export function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Colours are theme tokens: light by default, dark when the system asks for
// it, and either one when the reader picks it with the theme switch.
const lightTheme =
  'color-scheme: light; --bg: #ffffff; --text: #1f2328; --muted: #59636e; --border: #d1d9e0; --surface: #f6f8fa; ' +
  '--link: #0969da; --add: #dafbe1; --del: #ffebe9; --mark: #fff8c5; --mark-edge: #9a6700; --danger: #b42318; ' +
  '--flag-bg: #fff3cd; --flag-text: #664d03;';
const darkTheme =
  'color-scheme: dark; --bg: #0d1117; --text: #e6edf3; --muted: #9198a1; --border: #3d444d; --surface: #151b23; ' +
  '--link: #4493f8; --add: #12261e; --del: #25171c; --mark: #272115; --mark-edge: #d29922; --danger: #ff7b72; ' +
  '--flag-bg: #3b2e0a; --flag-text: #e3b341;';

const styles = `
:root { ${lightTheme} }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${darkTheme} } }
:root[data-theme="dark"] { ${darkTheme} }
body { font: 16px/1.5 system-ui, sans-serif; margin: 0; display: grid; grid-template-columns: 17rem minmax(0, 1fr); background: var(--bg); color: var(--text); }
a { color: var(--link); }
.content { max-width: 72rem; min-width: 0; padding: 1rem 1.5rem; }
.sidebar { position: sticky; top: 0; align-self: start; box-sizing: border-box; height: 100vh; overflow-y: auto; padding: 1rem; background: var(--surface); border-right: 1px solid var(--border); font-size: 0.9rem; }
.sidebar .progress { margin-top: 0; font-weight: 600; }
.nav-tier { margin: 1rem 0 0.25rem; font-weight: 600; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.05em; color: var(--muted); }
.nav-steps { list-style: none; margin: 0; padding: 0; }
.nav-steps a { display: block; padding: 0.2rem 0.5rem; border-left: 3px solid transparent; color: var(--text); text-decoration: none; overflow-wrap: anywhere; }
.nav-steps a:hover { background: var(--bg); }
.nav-steps a[aria-current="step"] { border-left-color: var(--link); background: var(--bg); font-weight: 600; }
.nav-steps .number { display: inline-block; min-width: 1.5em; color: var(--muted); font-variant-numeric: tabular-nums; }
.theme-switch { margin-top: 1.5rem; font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 0.25rem 0.75rem; cursor: pointer; }
.theme-switch::before { content: "○ "; }
.theme-switch[aria-pressed="true"]::before { content: "● "; }
@media (max-width: 50rem) {
  body { display: block; }
  .sidebar { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--border); }
}
code, .diff { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.step { scroll-margin-top: 1rem; border-top: 1px solid var(--border); padding-top: 1rem; }
.explanation { white-space: pre-wrap; }
.file-path { font-size: 1rem; }
.diff { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
.diff td { padding: 0 0.5rem; vertical-align: top; }
.diff .number { color: var(--muted); text-align: right; user-select: none; width: 1%; }
.diff .code { white-space: pre-wrap; word-break: break-all; }
.diff .add { background: var(--add); }
.diff .del { background: var(--del); }
.diff .hunk-header td, .diff .note td, .note { color: var(--muted); }
.intent { border: 1px solid var(--border); border-radius: 6px; padding: 0 1rem; margin-bottom: 1rem; }
.intent .why { white-space: pre-wrap; font-size: 1.1rem; }
.intent .visual { background: var(--surface); padding: 0.75rem; overflow-x: auto; }
.door.one-way { color: var(--danger); font-weight: 600; }
.diff .callout td { background: var(--mark); border-left: 4px solid var(--mark-edge); padding: 0.25rem 0.5rem; font-family: system-ui, sans-serif; }
.callout .tag { font-weight: bold; margin-right: 0.5rem; }
.pseudocode pre { background: var(--surface); padding: 0.5rem; overflow-x: auto; }
.trace table { border-collapse: collapse; }
.trace th, .trace td { border: 1px solid var(--border); padding: 0.25rem 0.5rem; text-align: left; vertical-align: top; }
.trace .diverges { background: var(--mark); }
.flag { font: 600 0.8rem system-ui, sans-serif; background: var(--flag-bg); color: var(--flag-text); border-radius: 0.25rem; padding: 0 0.4rem; }
.mechanical { border-collapse: collapse; margin: 0.5rem 0 1rem; }
.mechanical caption { text-align: left; font-weight: 600; }
.mechanical th, .mechanical td { border-bottom: 1px solid var(--border); padding: 0.2rem 0.75rem 0.2rem 0; text-align: left; }
.mechanical .count { text-align: right; }
.tier:last-child .step:last-child { min-height: calc(100vh - 2rem); }
a:focus-visible, button:focus-visible { outline: 2px solid var(--link); outline-offset: 2px; }
`;

// Navigation: j and k move to the next and previous step from the step being
// read (the last one whose top reached the top of the viewport), through the
// `#step-N` link; the sidebar marks that step and counts it. The last step is
// tall enough to reach the top. The theme switch overrides the system theme.
// The script never writes markup.
const script = `addEventListener('DOMContentLoaded', () => {
  const steps = [...document.querySelectorAll('main .step')];
  const links = [...document.querySelectorAll('#sidebar a[href^="#step-"]')];
  const count = document.getElementById('progress-count');
  const reading = () => steps.findLastIndex((step) => step.getBoundingClientRect().top <= 32);
  const showProgress = () => {
    const index = reading();
    links.forEach((link, i) => (i === index ? link.setAttribute('aria-current', 'step') : link.removeAttribute('aria-current')));
    count.textContent = String(index + 1);
  };
  addEventListener('scroll', showProgress, { passive: true });
  addEventListener('hashchange', showProgress);
  showProgress();
  const go = (index) => {
    const step = steps[index];
    if (!step) return;
    if (location.hash === '#' + step.id) step.scrollIntoView();
    else location.hash = step.id;
  };
  addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')) return;
    if (event.key === 'j') go(reading() + 1);
    else if (event.key === 'k') go(reading() - 1);
    else return;
    event.preventDefault();
  });
  const root = document.documentElement;
  const themeSwitch = document.getElementById('theme-switch');
  const systemDark = matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : systemDark.matches);
  const showTheme = () => themeSwitch.setAttribute('aria-pressed', String(isDark()));
  themeSwitch.addEventListener('click', () => {
    root.dataset.theme = isDark() ? 'light' : 'dark';
    showTheme();
  });
  systemDark.addEventListener('change', showTheme);
  showTheme();
});`;
const scriptHash = createHash('sha256').update(script).digest('base64');

export const doors = { 'one-way': 'One-way door', 'two-way': 'Two-way door' } as const;

/** The opening of the page: why the change exists, one visual of its shape, and its merge danger. */
function renderIntent({ why, visual, mergeDanger }: Intent): string {
  return (
    `<section class="intent" id="intent" aria-labelledby="intent-title">` +
    `<h2 id="intent-title">Intent</h2>` +
    `<p class="why">${inlineMarkdown(why.trim())}</p>` +
    `<pre class="visual"><code>${escape(visual.trimEnd())}</code></pre>` +
    `<p class="merge-danger"><strong>Merge danger:</strong> ` +
    `<span class="door ${mergeDanger.door}">${doors[mergeDanger.door]}</span>, ` +
    `blast radius: ${inlineMarkdown(mergeDanger.blastRadius)}</p>` +
    `</section>`
  );
}

const signs = { add: '+', del: '-', context: ' ', note: '' } as const;

function renderCallout(callout: Callout): string {
  return (
    `<tr class="callout"><td colspan="3"><span class="tag">${escape(callout.tag)}</span>` +
    `${inlineMarkdown(callout.text)}</td></tr>`
  );
}

function renderHunk(hunk: Hunk, callouts: Callout[]): string {
  const rows = hunk.lines.map(
    (line) =>
      `<tr class="${line.kind}"><td class="number">${line.oldNumber ?? ''}</td>` +
      `<td class="number">${line.newNumber ?? ''}</td>` +
      `<td class="code">${escape(signs[line.kind] + line.text)}</td></tr>` +
      callouts
        .filter((callout) => callout.line === (callout.side === 'old' ? line.oldNumber : line.newNumber))
        .map(renderCallout)
        .join(''),
  );
  return `<tbody><tr class="hunk-header"><td colspan="3">${escape(hunk.header)}</td></tr>${rows.join('')}</tbody>`;
}

const nameOf = (file: ChangedFile) => (file.oldPath ? `${file.oldPath} → ${file.path}` : file.path);

function renderFile({ file, hunks, binary }: FileDiff, callouts: Callout[], unprovenMechanical: boolean): string {
  const name = nameOf(file);
  const flag = unprovenMechanical ? ' <span class="flag">Unproven mechanical</span>' : '';
  const stats = file.additions === null ? 'binary' : `+${file.additions} −${file.deletions}`;
  const body = binary
    ? '<p class="note">Binary file, not shown.</p>'
    : hunks.length > 0
      ? `<table class="diff">${hunks.map((hunk) => renderHunk(hunk, callouts)).join('')}</table>`
      : '<p class="note">No content change.</p>';
  return `<article class="file"><h4 class="file-path"><code>${escape(name)}</code>${flag} <span class="stats">${stats}</span></h4>${body}</article>`;
}

function mechanicalTable(files: ChangedFile[], caption: string, proofOf: (file: ChangedFile) => string): string {
  if (files.length === 0) return '';
  const rows = files.map(
    (file) =>
      `<tr><td><code>${escape(nameOf(file))}</code></td>` +
      `<td class="count">${file.additions ?? 'binary'}</td><td class="count">${file.deletions ?? 'binary'}</td>` +
      `<td>${escape(proofOf(file))}</td></tr>`,
  );
  return (
    `<table class="mechanical"><caption>${caption}</caption>` +
    '<thead><tr><th scope="col">File</th><th scope="col">Added</th><th scope="col">Removed</th><th scope="col">Proof</th></tr></thead>' +
    `<tbody>${rows.join('')}</tbody></table>`
  );
}

/** Mechanical files as tables, never diffs: proven files first, then declared generated ones apart. */
function renderMechanical(files: ChangedFile[]): string {
  const proven = files.filter(isProven);
  const declared = files.filter((file) => !isProven(file));
  return (
    mechanicalTable(proven, 'Proven', describeProofs) +
    mechanicalTable(declared, 'Declared generated', () => 'declared, not proven')
  );
}


/** The old and new runs side by side, row by row, each row marked = or ≠. */
function renderTrace(trace: Trace): string {
  const rows = Array.from({ length: Math.max(trace.old.length, trace.new.length) }, (_, index) => {
    const [before, after] = [trace.old[index] ?? '', trace.new[index] ?? ''];
    const [mark, label] = before === after ? ['=', 'same'] : ['≠', 'diverges'];
    return (
      `<tr class="${label}"><th scope="row" title="${label}">${mark}</th>` +
      `<td>${inlineMarkdown(before)}</td><td>${inlineMarkdown(after)}</td></tr>`
    );
  });
  return (
    `<div class="trace"><h4>Old versus new</h4><p>Input: ${inlineMarkdown(trace.input)}</p>` +
    `<table><thead><tr><td></td><th scope="col">Old</th><th scope="col">New</th></tr></thead>` +
    `<tbody>${rows.join('')}</tbody></table></div>`
  );
}

/** The step's reading aids, shown between its explanation and its diffs. */
function renderAids(step: Step): string {
  const questions = step.questions ?? [];
  const parts: string[] = [];
  if (step.pseudocode !== undefined) {
    parts.push(`<div class="pseudocode"><h4>Pseudocode</h4><pre><code>${escape(step.pseudocode)}</code></pre></div>`);
  }
  if (step.trace !== undefined) parts.push(renderTrace(step.trace));
  if (questions.length > 0) {
    const items = questions.map((question) => `<li>${inlineMarkdown(question)}</li>`).join('');
    parts.push(`<div class="questions"><h4>Reviewer questions</h4><ul>${items}</ul></div>`);
  }
  return parts.join('');
}

function renderStep(step: Step, index: number, diffs: Map<string, FileDiff>): string {
  const id = `step-${index + 1}`;
  const body =
    step.tier === 'mechanical'
      ? renderMechanical(step.files.map((file) => (diffs.get(file) as FileDiff).file))
      : step.files
          .map((file) =>
            renderFile(
              diffs.get(file) as FileDiff,
              (step.callouts ?? []).filter((callout) => callout.file === file),
              step.unprovenMechanical?.includes(file) ?? false,
            ),
          )
          .join('');
  return (
    `<section class="step" id="${id}" aria-labelledby="${id}-title">` +
    `<h3 id="${id}-title"><a href="#${id}">Step ${index + 1}</a> · ${escape(step.title)}</h3>` +
    `<div class="explanation">${markdown(step.explanation)}</div>` +
    renderAids(step) +
    body +
    `</section>`
  );
}

/** The sidebar: every step, grouped by tier, as a link to its `#step-N`. */
function renderSidebar(plan: TourPlan): string {
  const groups = tiers.flatMap((tier) => {
    const links = plan.steps.flatMap((step, index) =>
      step.tier === tier
        ? [`<li><a href="#step-${index + 1}"><span class="number">${index + 1}</span> ${escape(step.title)}</a></li>`]
        : [],
    );
    if (links.length === 0) return [];
    return [
      `<p class="nav-tier" id="nav-tier-${tier}">${tierLabels[tier]}</p>` +
        `<ol class="nav-steps" aria-labelledby="nav-tier-${tier}">${links.join('')}</ol>`,
    ];
  });
  const total = plan.steps.length;
  return (
    `<nav class="sidebar" id="sidebar" aria-label="Steps">` +
    `<p class="progress"><span id="progress-count">0</span> of ${total} ${total === 1 ? 'step' : 'steps'}</p>` +
    `${groups.join('')}` +
    `<button type="button" class="theme-switch" id="theme-switch" aria-pressed="false">Dark theme</button></nav>`
  );
}

export function renderPage(change: Change, plan: TourPlan, diffs: Map<string, FileDiff>): string {
  // Validation keeps steps in tier order, so grouping keeps their numbers ascending.
  const steps = tiers.flatMap((tier) => {
    const inTier = plan.steps.flatMap((step, index) => (step.tier === tier ? [renderStep(step, index, diffs)] : []));
    if (inTier.length === 0) return [];
    return [
      `<section class="tier" id="tier-${tier}" aria-labelledby="tier-${tier}-title">` +
        `<h2 id="tier-${tier}-title">${tierLabels[tier]}</h2>${inTier.join('\n')}</section>`,
    ];
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${scriptHash}'">
<title>Tour of ${escape(change.target)}</title>
<style>${styles}</style>
<script>${script}</script>
</head>
<body>
${renderSidebar(plan)}
<div class="content">
<header>
<h1>Tour of <code>${escape(change.target)}</code></h1>
<p>${escape(change.repository)} · against <code>${escape(change.base)}</code> · head <code>${escape(change.head.slice(0, 12))}</code></p>
${change.followUp ? `<p class="follow-up">${escape(describeFollowUp(change.followUp))}</p>\n` : ''}</header>
<main>
${renderIntent(plan.intent)}
${steps.join('\n')}
</main>
</div>
</body>
</html>
`;
}
