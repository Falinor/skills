# Keep every skill portable across Agent Skills agents

The author works in Claude Code, but colleagues use other coding agents (Codex, OpenCode, …), so every skill here must install with `npx skills add` into `.agents/skills/` and run in any agent that supports the Agent Skills format. Steps rely only on a shell and reading and writing files; scripts are TypeScript run directly by Node 24.12+ (type stripping, no build step) using built-in modules only, since installing a skill copies files and never installs dependencies, and every `npx skills add` user already has Node; Claude-only tools and harnesses (for example `claude plugin eval` or the Artifact tool) stay out, even where they would be convenient. Per-agent metadata sits beside `SKILL.md`: frontmatter for Claude Code, `agents/openai.yaml` for Codex.

## Consequences

Evals run through our own harness (`evals/run.sh --agent claude|codex|opencode`) with plain-script graders, Claude being the default runner. Subagents are optional in every step, with a sequential fallback.

## Amendment (2026-10-29): eval paths

The decision stands; only the paths above changed when the first eval landed. Each skill has its own harness, `evals/<skill>/run.sh --agent claude|codex|opencode` (for this skill `evals/review-tour/run.sh`), not one shared `evals/run.sh`. It installs the skill as `npx skills add` does: under `.agents/skills/`, linked into `.claude/skills/` for Claude Code.
