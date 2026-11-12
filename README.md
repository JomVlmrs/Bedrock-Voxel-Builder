# Bedrock Voxel Builder

A browser-based builder for creating Minecraft Bedrock structures and exporting them as `.mcstructure` or `.mcfunction` files.

This repository mirrors the saved source files from the Hatchable project.

## Community and updates

Join the [Bedrock Voxel Builder Discord](https://discord.gg/eEMvsrwwGW) for development updates and announcements.

The footer includes a shared visit counter and a live active-tab indicator. It uses an anonymous random tab-session ID, refreshes active presence every 25 seconds, and considers a tab active for 90 seconds after its last heartbeat. A visit is counted once per tab session after 30 minutes of inactivity. It does not collect visitor names or IP addresses.

## Repository layout

- `public/` — the complete static frontend, block catalogue, block-state data, texture metadata, and model geometry files.
- `api/custom-blocks.js` — the Hatchable custom-block library API source.
- `api/visitors.js` — the public visitor statistics endpoint used by the footer.
- `migrations/` — database schema migrations used by the Hatchable backend.
- `.github/workflows/jekyll-gh-pages.yml` — validates local file references and publishes only `public/` to GitHub Pages.

## Hosting notes

GitHub Pages is a static mirror. It does not execute the Hatchable API routes or provide their PostgreSQL database. Custom-block uploads and saved custom-block persistence require the Hatchable-hosted app.

The live visit tracker on GitHub Pages also calls the Hatchable visitor API. **Set the Hatchable project's visibility to Public in Hatchable Console → Project Settings** to let anonymous GitHub Pages visitors reach that API. Until then the footer displays **PUBLISH APP** instead of showing a fake live count. This is a separate hosting setting; it does not change the static GitHub Pages site.

- GitHub Pages: https://jomvlmrs.github.io/Bedrock-Voxel-Builder/
- Hatchable app: https://bedrock-structure-lznl.hatchable.site/

The Pages workflow rewrites root-relative asset and data paths for the repository's project-site URL and verifies that the frontend, API, and migration source files are present.
