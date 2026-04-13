# Contributing

Thanks for considering a contribution to Great Northern Diver.

## Development Setup

**Node ≥ 22** is required (see `engines` in `package.json`).

```bash
git clone https://github.com/ironloon/the-great-northern-diver.git
cd the-great-northern-diver
npm install
npm test
```

Useful during development:

```bash
node ./bin/gnd-workflow.js help
node ./bin/gnd-workflow.js install --dry-run
```

## Change Types

### Installer logic (`src/`)

Changes to how files are written, overwritten, or validated. These affect every
consumer of the package.

### Templates (`templates/`)

Agent and skill files that get scaffolded into the target repo. The install
path is adapter-controlled (default: `.github/`). Template changes alter what a
target repo receives on install.

### Docs-only

README, CONTRIBUTING, RELEASING, or inline comment changes that don't touch
runtime behavior.

## Validation

1. **Run `npm test`** — this is the minimum bar for any change. Tests cover
   installer behavior, CLI flags, path policy, and the template contract.

2. **Local install check** — if your change touches the installer or templates,
   verify with a real install into a scratch repo:

   ```bash
   node ./bin/gnd-workflow.js install ../scratch-repo
   ```

   `--dry-run` is enough to confirm file-selection logic; an actual install
   confirms write behavior and prompts.

3. **Editor / runtime behavior** — the workflow targets VS Code with GitHub
   Copilot. If a template change affects agent or skill dispatching:

   - Dry-run the install to confirm file selection.
   - Install into a test repo and open it in VS Code.
   - Verify agent discovery picks up the changed files.
   - Trigger the affected workflow (e.g., invoke `@gnd-navigator`) and confirm
     the updated behavior.

## Runtime and Adapter Expectations

The installer uses an **adapter** to decide where files land. The default
adapter is `vscode-github-copilot`, which writes to `.github/`. Each managed
file carries `gnd-version` and `gnd-adapter` in its YAML frontmatter for
provenance.

The shipped agents and skills assume **VS Code + GitHub Copilot** as the
runtime. Other editors or assistant runtimes are not tested today. If you're
adding a new adapter or adapting the workflow for a different environment:

- Add the adapter to the `ADAPTERS` map in `src/install.js`.
- Document which runtime the adapter targets.
- Keep runtime-specific behavior isolated so it doesn't regress the default
  VS Code path.

## Releases

Release steps live in [RELEASING.md](RELEASING.md) and are maintainer-only.
The short version: `npm version patch` → `git push` → `git push --tags`
triggers GitHub Actions to publish to npm.
