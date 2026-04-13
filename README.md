# Great Northern Diver

A small installer for a planning, execution, and critique prompt set. Adapters
control where files land so the workflow integrates with your editor's agent
discovery.

## Install

One-shot scaffold. No global install or project dependency required.

```bash
npx gnd-workflow@latest install
# or
pnpm dlx gnd-workflow@latest install
```

Target another repo or pin a version:

```bash
npx gnd-workflow@latest install ../my-repo
npx gnd-workflow@0.1.0 install
```

## What It Writes

The installer writes managed files through an **adapter** that decides where
each artifact type goes. The default adapter is `vscode-github-copilot`, which
targets `.github/`:

```text
.github/                  ← managed by the installer (adapter-controlled)
  agents/
    gnd-diver.agent.md
    gnd-navigator.agent.md
  skills/
    gnd-chart/SKILL.md
    gnd-critique/SKILL.md
.planning/                ← created by gnd-chart and gnd-navigator
  active-plan-*.md
  archive/                ← completed plans moved here by gnd-critique
```

Each managed file carries `gnd-version` and `gnd-adapter` in its YAML
frontmatter so you can tell which package version wrote it and which adapter
was used.
- `gnd-chart` is the planning skill.
- `gnd-navigator` dispatches approved plan legs.
- `gnd-diver` executes one leg.
- `gnd-critique` reviews delivered work and feeds corrections back into the process.

All of these are plain text. Whether to track them in git is up to you:

- **Managed files** — tracking lets collaborators (or yourself on another
  machine) see the workflow files without re-running the installer. Ignoring
  keeps generated files out of your repo; `npx gnd-workflow@latest install`
  re-creates them.
- **`.planning/`** — tracking preserves plan history alongside code. Ignoring
  treats plans as ephemeral working state.

Neither directory needs to be tracked or ignored for the workflow to function.

## Philosophy

This is an agentic-development-first workflow. The navigator commits and pushes
directly to the default branch — no feature branches, no pull requests, no
staging area. Plan → execute → critique → push, in a tight loop.

That model works well for solo and hobby projects where you're the only
collaborator and velocity matters more than ceremony
([peninsular-reveries](https://github.com/ironloon/peninsular-reveries) is
the project it was built around). It's a poor fit for teams that rely on branch
protection, code review gates, or CI pipelines that run before merge.

If your project needs those guardrails, you can still use the planning and
critique skills on their own — just override the navigator's landing step to
target a branch instead of pushing directly.

## Updating

```bash
npx gnd-workflow@latest install
```

If a managed file already exists and differs from the packaged version, the
installer prompts before overwriting. Non-interactive runs fail unless you pass
`--force`.

Flags:

- `--adapter <name>` selects a runtime adapter (default: `vscode-github-copilot`).
- `--dry-run` shows what would change.
- `--force` replaces differing managed files without prompting. **Overwrites are not backed up.**
- `--version` shows the installed version.
- `-C, --cwd <path>` resolves the target project root from a specific working directory.

The target project root must be a real directory; symlinked and junctioned roots are rejected.

## Development

```bash
npm test
node ./bin/gnd-workflow.js help
node ./bin/gnd-workflow.js install --dry-run
npm pack --dry-run
```

Maintainer release steps live in [RELEASING.md](RELEASING.md).