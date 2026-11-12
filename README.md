# Bedrock Voxel Builder

A browser-based builder for creating Minecraft Bedrock structures and exporting them as `.mcstructure` or `.mcfunction` files.

This repository mirrors the saved source files from the Hatchable project.

## Repository layout

- `public/` — the complete static frontend, block catalogue, block-state data, texture metadata, and model geometry files.
- `api/custom-blocks.js` — the Hatchable custom-block library API source.
- `migrations/` — the database schema migration used by the Hatchable backend.
- `.github/workflows/jekyll-gh-pages.yml` — validates local file references and publishes only `public/` to GitHub Pages.

## Hosting notes

GitHub Pages is a static mirror. It does not execute the Hatchable API route or provide its PostgreSQL database, so custom-block uploads and saved custom-block persistence require the Hatchable-hosted app.

- GitHub Pages: https://jomvlmrs.github.io/Bedrock-Voxel-Builder/
- Hatchable app: https://bedrock-structure-lznl.hatchable.site/

The Pages workflow rewrites root-relative asset and data paths for the repository's project-site URL and verifies that the mirrored API and migration source files are present.
