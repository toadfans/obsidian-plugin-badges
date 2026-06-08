# Obsidian Plugin Badges Action

Generate badge SVG files for an Obsidian community plugin repository.

- `assets/min-version.svg`: reads `minAppVersion` from `manifest.json`
- `assets/plugin.svg`: reads the plugin page `Current version`, `Last updated`, `Downloads`, and Scorecard score from Obsidian Community

The action commits and pushes changed badge files by default.

## Usage

Add this workflow to your plugin repository:

```yaml
name: Update badges

on:
  workflow_dispatch:
  schedule:
    - cron: "17 2 * * *"

permissions:
  contents: write

jobs:
  badges:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: toadfans/obsidian-plugin-badges-action@v1
```

If the Obsidian Community URL slug differs from `manifest.json` `id`:

```yaml
- uses: toadfans/obsidian-plugin-badges-action@v1
  with:
    plugin-slug: name-guard
```

To generate files without committing them:

```yaml
- uses: toadfans/obsidian-plugin-badges-action@v1
  with:
    commit: "false"
```

## Inputs

| input | default | description |
| --- | --- | --- |
| `source-dir` | `.` | Directory containing `manifest.json` |
| `plugin-slug` | `manifest.json` `id` | Obsidian Community plugin slug |
| `commit` | `true` | Commit and push changed badge files |

## Local Checks

```bash
bun run lint
bun test
INPUT_SOURCE_DIR=/path/to/plugin INPUT_COMMIT=false bun run src/cli.ts
```
