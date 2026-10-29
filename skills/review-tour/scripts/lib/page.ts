// Builds the tour page as one self-contained HTML file. Every piece of text
// from the tour plan or the patch goes through `escape`.
import type { FileDiff, Hunk } from './patch.ts';
import type { Intent, TourPlan } from './plan.ts';
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
`;

const doors = { 'one-way': 'One-way door', 'two-way': 'Two-way door' } as const;

/** The opening of the page: why the change exists, one visual of its shape, and its merge danger. */
function renderIntent({ why, visual, mergeDanger }: Intent): string {
  return (
    `<section class="intent" id="intent" aria-labelledby="intent-title">` +
    `<h2 id="intent-title">Intent</h2>` +
    `<p class="why">${escape(why.trim())}</p>` +
    `<pre class="visual"><code>${escape(visual.trimEnd())}</code></pre>` +
    `<p class="merge-danger"><strong>Merge danger:</strong> ` +
    `<span class="door ${mergeDanger.door}">${doors[mergeDanger.door]}</span>, ` +
    `blast radius: ${escape(mergeDanger.blastRadius)}</p>` +
    `</section>`
  );
}

const signs = { add: '+', del: '-', context: ' ', note: '' } as const;

function renderHunk(hunk: Hunk): string {
  const rows = hunk.lines.map(
    (line) =>
      `<tr class="${line.kind}"><td class="number">${line.oldNumber ?? ''}</td>` +
      `<td class="number">${line.newNumber ?? ''}</td>` +
      `<td class="code">${escape(signs[line.kind] + line.text)}</td></tr>`,
  );
  return `<tbody><tr class="hunk-header"><td colspan="3">${escape(hunk.header)}</td></tr>${rows.join('')}</tbody>`;
}

function renderFile({ file, hunks, binary }: FileDiff): string {
  const name = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
  const stats = file.additions === null ? 'binary' : `+${file.additions} −${file.deletions}`;
  const body = binary
    ? '<p class="note">Binary file, not shown.</p>'
    : hunks.length > 0
      ? `<table class="diff">${hunks.map(renderHunk).join('')}</table>`
      : '<p class="note">No content change.</p>';
  return `<article class="file"><h3 class="file-path"><code>${escape(name)}</code> <span class="stats">${stats}</span></h3>${body}</article>`;
}

export function renderPage(change: Change, plan: TourPlan, diffs: Map<string, FileDiff>): string {
  const steps = plan.steps.map((step, index) => {
    const id = `step-${index + 1}`;
    return (
      `<section class="step" id="${id}" aria-labelledby="${id}-title">` +
      `<h2 id="${id}-title"><a href="#${id}">Step ${index + 1}</a> · ${escape(step.title)}</h2>` +
      `<div class="explanation">${escape(step.explanation)}</div>` +
      step.files.map((file) => renderFile(diffs.get(file) as FileDiff)).join('') +
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
