# Releasing

This package is published from GitHub Actions on `v*` tags using npm trusted
publishing.

## One-Time Setup

If `gnd-workflow` does not exist on npm yet, publish it once manually.

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