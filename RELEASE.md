# Release Guide

## Update Version

```bash
# Patch (1.0.0 -> 1.0.1)
npm run version:patch

# Minor (1.0.0 -> 1.1.0)
npm run version:minor

# Major (1.0.0 -> 2.0.0)
npm run version:major
```

These commands update `package.json` and, via the npm `version` lifecycle
script (`scripts/sync-version.mjs`), also sync the version into
`src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`. No git operations.

## Manual Release Steps

```bash
# 1. Update version
npm run version:patch

# 2. Commit
git add package.json
git commit -m "v1.0.1"

# 3. Tag
git tag v1.0.1

# 4. Push
git push origin main --tags
```

GitHub Actions will automatically build and create a Release when you push a tag.
