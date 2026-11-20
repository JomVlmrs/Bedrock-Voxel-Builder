# Bedrock Voxel Builder

A browser-based Minecraft Bedrock structure editor. Build with the vanilla block catalogue, textured block models, block states and custom blocks, then export structures as `.mcstructure` or `.mcfunction` files.

## Features

- 3D Bedrock structure editor with a searchable block catalogue and block-state controls.
- Import and export structure files, with optimized rendering for larger builds.
- Per-account saved structure library: save, reopen, update and delete structures.
- Account sign-in with email one-time verification codes and optional device passkeys. Authentication is managed by Hatchable; this app does not use password-based sign-in.
- Optional plan upgrades through PayPal. Checkout is handled by server-side Hatchable routes.
- Custom block tools and a shared community visit counter / active-tab indicator.

Join the [Bedrock Voxel Builder Discord](https://discord.gg/eEMvsrwwGW) for development updates and announcements.

## Repository layout

- `public/` — static frontend, login and upgrade screens, block catalogue, textures, state data, and model geometry.
- `api/` — Hatchable backend routes for accounts, saved structures, billing, custom blocks, and visitor statistics.
- `lib/` — shared billing and PayPal server-side helpers.
- `migrations/` — PostgreSQL schema migrations for custom blocks, visitor statistics, billing, account profiles, and saved structures.
- `hatchable.toml` — authentication, secret declarations, PayPal environment configuration, and per-user database access.
- `.github/workflows/jekyll-gh-pages.yml` — validates local file references and publishes only `public/` to GitHub Pages.

## Hosting notes

GitHub Pages is a **static mirror**. It can serve the browser editor, but it does not execute Hatchable API routes or provide the PostgreSQL database. Account sign-in, cloud-saved structures, custom-block persistence, visitor statistics, and PayPal plan purchases require the Hatchable-hosted app.

- GitHub Pages: https://jomvlmrs.github.io/Bedrock-Voxel-Builder/
- Hatchable app: https://bedrock-structure-lznl.hatchable.site/

The visitor tracker calls the Hatchable visitor API. Set the Hatchable project's visibility to **Public** in Hatchable Console → Project Settings to let anonymous GitHub Pages visitors reach that API. Until then, the footer displays **PUBLISH APP** instead of showing a fake live count.

PayPal credentials belong in the Hatchable project's Setup section, not in this repository. The source contains only the secret names and configuration declarations; never commit live credentials or user data.
