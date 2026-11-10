# Orbie Studio changes

## 1.0.0
- New name: Agent Deck is now Orbie Studio, your team's AI game studio. New logo and new icon.
- New look: glass panels on a soft color backdrop, with four themes. Open the main menu and pick Dusk, Daylight, Aurora or Midnight.
- A soft light follows the mouse behind the panels.
- New tab bar: Home, Studio, Previews, Status, Usage, Team and Questions. The app starts on Home.
- Home shows your games, the agents, the open questions and the rocket flight of the open game.
- Studio is the board with the live agent terminals. Five icons on the top right arrange the board: Tree, Orbit, Lanes, Timeline and Flow.
- Previews shows the newest answer and the views of each agent.
- Status shows one card for each agent, with Start, Stop and Open console.
- Usage shows the rocket flight: 19 stops from Earth to the Andromeda Galaxy, for the tokens of the whole life of a game. The warning line is Saturn (1 billion tokens).
- Questions shows each question and each approval, and you can write to one agent.
- Team shows the plan only. The Team features need a shared online database, which is not built yet.
- Each agent has a picture. The logo wears a space helmet.
- Orbie Studio installs next to Agent Deck and keeps its own settings. The first start copies your recent projects and your agents folder from Agent Deck.
- Safer updates: Orbie Studio reads its own update list (update/orbie-studio.json) and refuses a list or a folder that belongs to another app.
- Safer updates: Orbie Studio no longer searches other drives and cloud folders for an update folder. It uses GitHub, or a folder that you pick.
- Safer window: the window can change the theme only. It cannot change where updates come from, and it cannot make the PC run a file.
- Safer web tiles: an embedded page gets no camera, no microphone and no other permission, and its links open in your browser.
- Safer local server: the server that agents use to talk ignores requests that come through another host name.
- The text cleaner library (DOMPurify) is updated to 3.4.17, which fixes known faults.
- Paired Remote view devices are not copied from Agent Deck. Pair each device again.

# Agent Deck changes (before Orbie Studio)

## 1.7.0
- Updates come from GitHub: every copy checks github.com/ki11phil0405-bit/agent-deck by itself every 10 minutes, downloads the new version, checks every file against its checksum, and offers Restart to update. No shared folder needed.
- Bigger updates that need a new installer: one click downloads it from GitHub and starts it. Your teams, boards and settings stay.
- If a copy can't reach GitHub or a shared folder, the title bar says "Updates not connected" with a Fix button.
- The shared Google Drive folder still works as a backup, and Agent Deck now finds it by itself (My Drive\Agent Deck on any drive letter).

## 1.6.1
- New starting teams for making any game, not just Make It In Miami: Game studio (Supervisor, Game designer, builder, 3D artist, QA + security), Roblox game crew, Prototype sprint (first playable fast), Builder + reviewer, Solo, Plain terminal.
- Agent Deck looks at the folder first (Roblox, Unity, Unreal, Godot, web, or empty) and sets the builder, tests and connections to match. An empty folder is treated as a brand-new game: the designer asks you about your idea and writes GAME_PLAN.md before anyone builds.
- Suggest a team also plans for new games.

## 1.6.0
- Replies: every agent's answer at the end of a turn shows in the side panel (newest first), with Open, Copy, Read aloud, Reply and Console. A green dot on an agent's window means a new reply. Also in Remote view (Replies tab).
- Main menu: click "Agent Deck ▾" in the top left for Home, opening or switching project folders, recent projects, the agents and update folders, Remote view, the quick guide and updates.
- Click the project name on the toolbar to switch this tab to another folder or open it in Explorer.
- Quick guide: a 2-page PDF explanation you can save and share (main menu, F1, or Remote view menu).
- Fixed: agent windows could sit on top of dialogs so Close couldn't be clicked.

## 1.5.0
- Remote view: open your board from your Mac, iPhone or iPad in Safari or Chrome. Live agent terminals (type, run / commands, Enter/Esc/arrow keys), Tell the team, Needs you, tasks, views and the feed.
- Off until you turn it on (Remote button on the toolbar). Each device pairs once with a 6-digit code shown on the PC; sign devices out any time.
- Home network only, or anywhere with Tailscale.

## 1.4.0
- Created and published by Cohesive.
- Updates: pick your own update folder on the welcome screen (for example the shared Google Drive folder).
- A team file inside the project (.agents/team.json) is picked up automatically, so teammates who clone the repo get the same agents.

## 1.3.1
- Slash commands work: type /model (or any /command) in the Tell the team bar and it runs in the chosen agent, exactly as typed.
- Every running agent has a / button with the common Claude Code commands.
- Clicking anywhere in an agent's window puts the cursor in its terminal.

## 1.3.0
- One-click updates: Agent Deck picks up new versions from Documents\Dev\agent-deck and offers "Restart to update".
- Agents view layout (Supervisor on top, agents below, connector lines) and a side panel toggle (Ctrl+\).

## 1.1.0
- Suggest a team, suggested edits, markup on pictures, task board, token usage.
