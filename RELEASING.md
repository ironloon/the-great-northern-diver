# Releasing

This package is published from GitHub Actions on `v*` tags using npm trusted
publishing.

## One-Time Setup

If `gnd-workflow` does not exist on npm yet, run `npm login` and publish it
once manually with `npm publish`.

Then configure trusted publishing on npm:

1. Open the package settings for `gnd-workflow` on npmjs.com.
2. In Trusted publishing, add a GitHub Actions publisher with:
   GitHub user or organization: `ironloon`
   repository: `the-great-northern-diver`
   workflow filename: `publish.yml`

## Release Flow

```bash
npm version patch
git push
git push --tags
```

That creates a `v*` tag and triggers `.github/workflows/publish.yml`.

## Rolling Back a Release

If a publish fails after the tag was pushed, or a broken version was published:

```bash
# Unpublish within 72 hours (npm policy)
npm unpublish gnd-workflow@<bad-version>

# Or deprecate if unpublish is too late
npm deprecate gnd-workflow@<bad-version> "broken release, use <good-version>"

# Delete the remote tag
git push origin --delete v<bad-version>

# Delete the local tag
git tag -d v<bad-version>
```

Then fix the issue on `main`, bump with `npm version patch`, and re-release.