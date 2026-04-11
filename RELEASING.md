# Releasing

This package is published from GitHub Actions on `v*` tags using npm trusted
publishing.

## Release Policy

- Require CI on `main` and only tag commits that are already on `main`.
- The publish workflow re-runs release validation on the tagged commit before it
  publishes, so a bad tag fails closed instead of shipping.
- Trusted publishing uses GitHub OIDC instead of a long-lived npm token.

## One-Time Setup

If `gnd-workflow` does not exist on npm yet, publish it once manually.

Then configure trusted publishing on npm:

1. Open the package settings for `gnd-workflow` on npmjs.com.
2. In Trusted publishing, add a GitHub Actions publisher with:
   GitHub user or organization: `ironloon`
   repository: `the-great-northern-diver`
   workflow filename: `publish.yml`
3. After trusted publishing works, remove any old npm publish token.
4. Optionally require 2FA and disallow tokens in the package publishing
   settings.

## Release Flow

```bash
npm version patch
git push
git push --tags
```

The publish workflow in `.github/workflows/publish.yml` runs on `v*` tags,
verifies the tag matches `package.json`, re-runs validation on Linux and
Windows, checks the tarball with `npm pack --dry-run`, and only then publishes
to npm.

Because trusted publishing is OIDC-based, the release workflow does not need an
`NPM_TOKEN` repository secret.