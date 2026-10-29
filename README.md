# Skills

Agent skills in the [Agent Skills](https://agentskills.io) format. They run in Claude Code, Codex, OpenCode and any other agent that supports the format.

## review-tour

`/review-tour <pull request number|URL, or branch> [base <ref>] [since <sha>]` builds a **tour** of a change: a local, self-contained HTML page that leads a human reviewer through the change step by step, each step with an explanation and the real diffs from git. The page is written to a per-tour folder under the system temp directory, outside the checkout.

Steps come in tiers: core logic, then wiring, then mechanical. Only files with a mechanical proof (from git: pure move between files, pure rename, whitespace-only change outside whitespace-sensitive languages; from [difftastic](https://github.com/Wilfred/difftastic) when installed: syntax-identical, an unchanged syntax tree) reach the mechanical tier, shown as a table rather than diffs; files the base declares generated are listed apart as declared, not proven.

On the page, a sidebar lists the steps by tier and shows how far you have read; `j` and `k` move to the next and previous step, each at its own `#step-N` link. It follows the system's light or dark theme, and a switch picks the other one. Its only script navigates and switches themes; the page's Content-Security-Policy allows that script by hash and nothing else.

A pull request is fetched through `gh`, with nothing to check out by hand. The base is the one you give, else the pull request's base, else the remote's default branch; the tool never assumes `main`.

After the author addresses feedback, `since <sha>` (the earlier tour's head) gives a **follow-up tour** of only what changed since. If the author merged the base in meanwhile, the base's changes are left out. If that head was force-pushed away, the tour covers the full change and says why.

For a pull request, say "done 3" or "done 1–4" in the chat when you finish steps, and their files are ticked as Viewed on GitHub. Once the tour is built, the skill offers to tick the proven mechanical files in one batch. It skips files you already viewed, never unticks anything, and refuses when the pull request has moved since the tour was built, suggesting a follow-up tour instead.

### Install

```sh
npx skills add Falinor/skills --skill review-tour
```

Requires Node 24.12+ and git (gh for GitHub pull requests). The skill runs only when you invoke it.

Optional: difftastic (`brew install difftastic` or `cargo install --locked difftastic`) lets the tour prove formatter reflows and re-indentation syntax-identical. Without it the tour still works; the tool never installs it.

## Development

```sh
npm ci
npx playwright install chromium
npm test            # typecheck, CLI tests, page tests
npm run typecheck   # tsc --noEmit
npm run test:cli    # node:test against throwaway git repositories (the real-difftastic test runs when difft is installed, always in CI)
npm run test:page   # Playwright on rendered pages
```

The skill's scripts are TypeScript run directly by Node (type stripping) with built-in modules only; the dev dependencies serve the tests and the type check alone. See `GLOSSARY.md` for the vocabulary and `docs/adr/` for the decisions.

### Agent eval

The tests above check the scripts. The eval measures the agent's part of the job: it runs the whole skill headless on a synthetic repository and grades the tour plan the agent wrote.

```sh
evals/review-tour/run.sh                    # Claude Code, three runs
evals/review-tour/run.sh --agent codex      # or --agent opencode
evals/review-tour/run.sh --runs 5
```

**Every run is a paid model call.** The eval never runs in CI and refuses to start when `CI` is set. Run it by hand, with the agent's CLI installed and logged in.

Each run builds a fresh repository whose change looks like a tidy-up: a function moved to another file, a rename, a re-indented file, a regenerated file and the exports rewired. One re-indented file also changes behaviour on one line. The harness installs the skill into it, runs `/review-tour feature base trunk` and grades the result: the hidden change sits in core logic (not flagged unproven mechanical), proven files sit in mechanical, every file appears exactly once, and the final plan renders into a page. It prints a result per run and the overall pass rate, and keeps each run's repository and logs in the folder it names last.

## Credits

`review-tour` was inspired by Trail of Bits' [`review-walkthrough`](https://github.com/trailofbits/skills) and Cursor's `pr-review-canvas`. No code or prose was copied from either; it is written from our own decisions ([ADR 0001](docs/adr/0001-rewrite-from-ideas-under-mit.md)).

## License

[MIT](LICENSE)
