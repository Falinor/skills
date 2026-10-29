# Skills

Agent skills in the [Agent Skills](https://agentskills.io) format. They run in Claude Code, Codex, OpenCode and any other agent that supports the format.

## review-tour

`/review-tour <pull request number|URL, or branch> [base <ref>] [since <sha>]` builds a **tour** of a change: a local, self-contained HTML page that leads a human reviewer through the change step by step, each step with an explanation and the real diffs from git. The page is written to a per-tour folder under the system temp directory, outside the checkout.

A pull request is fetched through `gh`, with nothing to check out by hand. The base is the one you give, else the pull request's base, else the remote's default branch; the tool never assumes `main`.

After the author addresses feedback, `since <sha>` (the earlier tour's head) gives a **follow-up tour** of only what changed since. If the author merged the base in meanwhile, the base's changes are left out. If that head was force-pushed away, the tour covers the full change and says why.

### Install

```sh
npx skills add Falinor/skills --skill review-tour
```

Requires Node 24.12+ and git (gh for GitHub pull requests). The skill runs only when you invoke it.

## Development

```sh
npm ci
npx playwright install chromium
npm test            # typecheck, CLI tests, page tests
npm run typecheck   # tsc --noEmit
npm run test:cli    # node:test against throwaway git repositories
npm run test:page   # Playwright on rendered pages
```

The skill's scripts are TypeScript run directly by Node (type stripping) with built-in modules only; the dev dependencies serve the tests and the type check alone. See `GLOSSARY.md` for the vocabulary and `docs/adr/` for the decisions.

## Credits

`review-tour` was inspired by Trail of Bits' [`review-walkthrough`](https://github.com/trailofbits/skills) and Cursor's `pr-review-canvas`. No code or prose was copied from either; it is written from our own decisions ([ADR 0001](docs/adr/0001-rewrite-from-ideas-under-mit.md)).

## License

[MIT](LICENSE)
