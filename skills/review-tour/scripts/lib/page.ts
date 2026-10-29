// Builds the tour page as one self-contained HTML file. Every piece of text
// from the tour plan or the patch goes through `escape`, or through the
// escaping Markdown subset for prose.
import { inlineMarkdown, markdown } from './markdown.ts';
import type { FileDiff, Hunk } from './patch.ts';
import type { Callout, Intent, Step, TourPlan, Trace } from './plan.ts';
import type { Change } from './work-folder.ts';

export function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const styles = `
body { font: 16px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 72rem; padding: 1rem; }
code, .diff { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.step { scroll-margin-top: 1rem; border-top: 1px solid #ccc; padding-top: 1rem; }
.explanation { white-space: pre-wrap; }
.file-path { font-size: 1rem; }
.diff { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
.diff td { padding: 0 0.5rem; vertical-align: top; }
.diff .number { color: #888; text-align: right; user-select: none; width: 1%; }
.diff .code { white-space: pre-wrap; word-break: break-all; }
.diff .add { background: #e6ffec; }
.diff .del { background: #ffebe9; }
.diff .hunk-header td, .diff .note td { color: #888; }
.intent { border: 1px solid #ccc; border-radius: 6px; padding: 0 1rem; margin-bottom: 1rem; }
.intent .why { white-space: pre-wrap; font-size: 1.1rem; }
.intent .visual { background: #f6f8fa; padding: 0.75rem; overflow-x: auto; }
.door.one-way { color: #b42318; font-weight: 600; }
.diff .callout td { background: #fff8c5; border-left: 4px solid #9a6700; padding: 0.25rem 0.5rem; font-family: system-ui, sans-serif; }
.callout .tag { font-weight: bold; margin-right: 0.5rem; }
.pseudocode pre { background: #f6f8fa; padding: 0.5rem; overflow-x: auto; }
.trace table { border-collapse: collapse; }
.trace th, .trace td { border: 1px solid #ccc; padding: 0.25rem 0.5rem; text-align: left; vertical-align: top; }
.trace .diverges { background: #fff8c5; }
`;

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

function renderFile({ file, hunks, binary }: FileDiff, callouts: Callout[]): string {
  const name = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
  const stats = file.additions === null ? 'binary' : `+${file.additions} −${file.deletions}`;
  const body = binary
    ? '<p class="note">Binary file, not shown.</p>'
    : hunks.length > 0
      ? `<table class="diff">${hunks.map((hunk) => renderHunk(hunk, callouts)).join('')}</table>`
      : '<p class="note">No content change.</p>';
  return `<article class="file"><h3 class="file-path"><code>${escape(name)}</code> <span class="stats">${stats}</span></h3>${body}</article>`;
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
    `<div class="trace"><h3>Old versus new</h3><p>Input: ${inlineMarkdown(trace.input)}</p>` +
    `<table><thead><tr><td></td><th scope="col">Old</th><th scope="col">New</th></tr></thead>` +
    `<tbody>${rows.join('')}</tbody></table></div>`
  );
}

/** The step's reading aids, shown between its explanation and its diffs. */
function renderAids(step: Step): string {
  const questions = step.questions ?? [];
  const parts: string[] = [];
  if (step.pseudocode !== undefined) {
    parts.push(`<div class="pseudocode"><h3>Pseudocode</h3><pre><code>${escape(step.pseudocode)}</code></pre></div>`);
  }
  if (step.trace !== undefined) parts.push(renderTrace(step.trace));
  if (questions.length > 0) {
    const items = questions.map((question) => `<li>${inlineMarkdown(question)}</li>`).join('');
    parts.push(`<div class="questions"><h3>Reviewer questions</h3><ul>${items}</ul></div>`);
  }
  return parts.join('');
}

export function renderPage(change: Change, plan: TourPlan, diffs: Map<string, FileDiff>): string {
  const steps = plan.steps.map((step, index) => {
    const id = `step-${index + 1}`;
    return (
      `<section class="step" id="${id}" aria-labelledby="${id}-title">` +
      `<h2 id="${id}-title"><a href="#${id}">Step ${index + 1}</a> · ${escape(step.title)}</h2>` +
      `<div class="explanation">${markdown(step.explanation)}</div>` +
      renderAids(step) +
      step.files
        .map((file) =>
          renderFile(
            diffs.get(file) as FileDiff,
            (step.callouts ?? []).filter((callout) => callout.file === file),
          ),
        )
        .join('') +
      `</section>`
    );
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Tour of ${escape(change.target)}</title>
<style>${styles}</style>
</head>
<body>
<header>
<h1>Tour of <code>${escape(change.target)}</code></h1>
<p>${escape(change.repository)} · against <code>${escape(change.base)}</code> · head <code>${escape(change.head.slice(0, 12))}</code></p>
</header>
<main>
${renderIntent(plan.intent)}
${steps.join('\n')}
</main>
</body>
</html>
`;
}
