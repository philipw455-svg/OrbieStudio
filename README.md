# Agent Deck

A Windows command post for running Claude Code agents side by side on one board: real terminals, a team that talks to each other, Replies, Needs you, a task board, Remote view for your Mac or phone, and one-click updates.

Created and published by **Cohesive**. © 2026 Cohesive. All rights reserved. The code is public so every copy can update itself; it is not open source.

## Install

Download **Agent-Deck-Setup-x.y.z.exe** from the newest [release](https://github.com/ki11phil0405-bit/agent-deck/releases/latest) and run it. If Windows says "Windows protected your PC", click **More info**, then **Run anyway** (the app is not code-signed yet).

You also need Claude Code: in PowerShell run `irm https://claude.ai/install.ps1 | iex`.

## Updates

Every copy checks `update/manifest.json` on this repo's `main` branch every 10 minutes. When a newer version is listed, Agent Deck shows **Restart to update**, downloads each file from that version's tag, checks its SHA-256, backs up the current version and restarts. Updates that change the app's libraries download the new installer from the release instead.

## Publishing a new version (Cohesive)

1. Change the code, add a `## x.y.z` section at the top of `CHANGES.md`, and set `version` in `package.json`.
2. `npm ci` then `npm run dist` (builds `dist/Agent-Deck-Setup-x.y.z.exe`).
3. `npm run release` (writes `update/manifest.json`).
4. Commit, tag `vx.y.z`, push `main` and the tag, then create the GitHub release for the tag and attach the installer.

Copies pick it up within 10 minutes.

Built with Electron, xterm.js, node-pty, marked and DOMPurify, used under their licenses.
