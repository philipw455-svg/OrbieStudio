// Team presets for making games. A team is saved as team.json in the project's agents folder and can be edited in the app.
// Each preset looks at the folder first (Roblox, Unity, Unreal, Godot, web, or nothing yet) and fits the builder to it.
'use strict';

const fs = require('fs');
const path = require('path');

// Validated categorical order for dark surfaces (colorblind-safe adjacent pairs), so agent colors also work in charts.
const COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

const MCP = { roblox_studio: { command: 'cmd.exe', args: ['/c', '%LOCALAPPDATA%\\Roblox\\mcp.bat'] }, blender: { command: 'uvx', args: ['blender-mcp'] } };

const TALK = 'You are in Orbie Studio with the rest of the team: {team}. Talk to them only with the agent_deck tools: list_agents, send_message, handoff, report_status, ask_owner for the human owner, show_view to put your screenshots, reports and test output on the owner\'s board, and task_board to keep the shared kanban current.';
const HOUSE = 'House rules: only the owner publishes or releases anything; never publish, upload or change live settings. Original work only: no real brands, logos, copyrighted characters or ripped assets. Keep the project\'s CLAUDE.md as the rule book and GAME_PLAN.md as the plan.';

/* ---------------------------------------------------------------- what kind of project is this folder */

function list(dir, depth) {
  const out = [];
  const walk = (d, n) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (out.length > 4000) return;
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'Library' || e.name === 'Intermediate' || e.name === 'Saved') continue;
      const f = path.join(d, e.name);
      out.push({ name: e.name, dir: e.isDirectory(), rel: path.relative(dir, f) });
      if (e.isDirectory() && n > 0) walk(f, n - 1);
    }
  };
  walk(dir, depth);
  return out;
}

const ENGINES = {
  roblox: { label: 'Roblox', builder: 'Roblox Studio builder', role: 'Roblox Studio + Luau', tool: 'Roblox Studio (through its MCP server) and Luau scripts', mcp: ['roblox_studio'], test: 'code-driven play tests in Roblox Studio on R6 and R15 avatars, on PC, phone and tablet sizes' },
  unity: { label: 'Unity', builder: 'Unity builder', role: 'Unity + C#', tool: 'the Unity project and C# scripts', mcp: [], test: 'Unity play mode and edit mode tests, plus a build on the target platform' },
  unreal: { label: 'Unreal Engine', builder: 'Unreal builder', role: 'Unreal + C++/Blueprints', tool: 'the Unreal project, C++ and Blueprints', mcp: [], test: 'Unreal automation tests and a packaged build' },
  godot: { label: 'Godot', builder: 'Godot builder', role: 'Godot + GDScript', tool: 'the Godot project, scenes and GDScript', mcp: [], test: 'Godot scene runs and GUT or script tests' },
  web: { label: 'web (JavaScript)', builder: 'Web game builder', role: 'Browser game code', tool: 'the web game code (HTML, JavaScript/TypeScript, its build tools)', mcp: [], test: 'the dev server in a browser plus automated tests' },
  none: { label: 'nothing yet', builder: 'Game builder', role: 'Builds the game in the chosen engine', tool: 'whatever engine the owner picks (ask first)', mcp: [], test: 'whatever tests fit the chosen engine' },
};

function detect(projectPath) {
  const files = list(projectPath, 2);
  const has = (re) => files.some(f => re.test(f.rel.replace(/\\/g, '/')));
  let engine = 'none';
  if (has(/\.rbxlx?$|(^|\/)default\.project\.json$|\.luau$|(^|\/)wally\.toml$|(^|\/)rokit\.toml$/i)) engine = 'roblox';
  else if (has(/\.uproject$/i)) engine = 'unreal';
  else if (has(/(^|\/)project\.godot$/i)) engine = 'godot';
  else if (has(/(^|\/)ProjectSettings\/ProjectVersion\.txt$/) || (has(/^Assets$/) && has(/^ProjectSettings$/))) engine = 'unity';
  else if (has(/(^|\/)package\.json$/i) && has(/\.(js|ts|tsx|html)$/i)) engine = 'web';
  const blend = has(/\.blend$/i);
  const meaningful = files.filter(f => !/^(readme|license|\.git)/i.test(f.name));
  return { engine, label: ENGINES[engine].label, blend, empty: meaningful.length === 0, hasRules: has(/^CLAUDE\.md$/i), hasPlan: has(/^GAME_PLAN\.md$/i) };
}

/* ---------------------------------------------------------------- agents */

function agent(o) {
  return Object.assign({ command: 'claude', model: 'claude-opus-5-5', permissionMode: 'default', mcp: [], autostart: true }, o);
}

function supervisor(ctx, extra) {
  return agent({
    id: 'supervisor', name: 'Supervisor', role: 'Plans, assigns, checks proof', color: COLORS[0], lead: true,
    prompt: `You are the Supervisor for the game {project}. ${TALK} ${HOUSE} This folder looks like a ${ctx.label} project${ctx.empty ? ' and is empty, so this is a brand-new game' : ''}. ` +
      `${ctx.hasRules ? 'Read CLAUDE.md first.' : 'There is no CLAUDE.md yet: draft one with the owner (rules, tone, platform, what never to do) and ask them to approve it with ask_owner.'} ` +
      `${ctx.hasPlan ? 'Read GAME_PLAN.md.' : 'There is no GAME_PLAN.md yet: have the designer write it before anyone builds.'} ` +
      `Break the plan into small steps on the task_board and give each agent one step at a time with send_message. When the owner sends a general change ([From the owner] ...), split it and send each part to the agent who needs it, then say what went where with report_status. Nothing is done without proof (files, screenshots, test output) and a pass from QA. You never build and you never open the game engine yourself. ${extra || ''} Start by saying hello to the team and reporting your first plan.`,
  });
}
function designer(ctx, color) {
  return agent({
    id: 'designer', name: 'Game designer', role: 'Idea, rules, story, levels, the plan', color,
    prompt: `You are the Game designer for {project}. ${TALK} ${HOUSE} You own GAME_PLAN.md: the one-line pitch, who it is for, the core loop, mechanics and controls, progression and rewards, story and characters, levels or map, art and sound direction, UI screens, how it makes money if at all, and milestones (first playable, alpha, beta, launch). ` +
      `${ctx.hasPlan ? 'GAME_PLAN.md exists: read it and keep it current.' : 'Interview the owner with ask_owner first: a few short multiple-choice questions at a time, your recommended answer first. Then write GAME_PLAN.md and show it with show_view.'} ` +
      'You write no code. When the plan changes, tell the Supervisor what changed. Reply that you are ready.',
  });
}
function builder(ctx, color) {
  const e = ENGINES[ctx.engine];
  return agent({
    id: 'builder', name: e.builder, role: e.role, color, mcp: e.mcp.slice(),
    prompt: `You are the ${e.builder} for {project}. ${TALK} ${HOUSE} You own ${e.tool}. ${ctx.engine === 'none' ? 'No engine is set up in this folder yet: once GAME_PLAN.md exists, ask the owner which engine to use (Roblox, Unity, Unreal, Godot or web) with ask_owner, your recommendation first, then set the project up. ' : ''}` +
      'Take steps only from the Supervisor ([Message from Supervisor] ...). Back up what you change, keep the game running after every step, and fix every error before moving on. When a step is done, send the proof (files changed, screenshots, errors or "no errors") to the Supervisor and ask QA to check it. Use report_status to say what you are doing. Reply that you are ready, then wait for your first step.',
  });
}
function artist(ctx, color) {
  return agent({
    id: 'artist', name: '3D artist', role: 'Models and art in Blender', color, mcp: ['blender'],
    prompt: `You are the 3D artist for {project}. ${TALK} ${HOUSE} You make original models, props and art in Blender, at real scale for a ${ctx.label === 'nothing yet' ? 'game' : ctx.label + ' game'}, with sensible polygon counts and clean names. Follow the art direction in GAME_PLAN.md. Take steps only from the Supervisor. Every drop goes to QA for a check before the builder places it. Use report_status to say what you are doing. Reply that you are ready, then wait for your first step.`,
  });
}
function qa(ctx, color) {
  const e = ENGINES[ctx.engine];
  return agent({
    id: 'qa', name: 'QA + security', role: 'Tests, scans, never fixes', color, mcp: e.mcp.slice(),
    prompt: `You are QA + security for {project}. ${TALK} ${HOUSE} You test every finished step: ${e.test}. You scan every store or downloaded asset before it is used (hidden scripts, remote code loading, backdoors, real brands) and check saves, money and anything a cheater could abuse. You never check your own work and you never fix what you test: report pass or fail with proof to the Supervisor and the agent who built it.${e.mcp.length ? ' Only use the engine when the builder is not using it; ask them first with send_message.' : ''} Reply that you are ready, then wait for your first check.`,
  });
}

/* ---------------------------------------------------------------- presets */

function studio(o) {
  const ctx = o.ctx;
  const agents = [supervisor(ctx), designer(ctx, COLORS[4]), builder(ctx, COLORS[1])];
  if (ctx.engine === 'roblox' || ctx.blend || ctx.engine === 'none' || ctx.engine === 'unity' || ctx.engine === 'unreal' || ctx.engine === 'godot') agents.push(artist(ctx, COLORS[2]));
  agents.push(qa(ctx, COLORS[3]));
  return { name: 'Game studio', mcpServers: pick(agents) , agents };
}
function roblox(o) {
  const ctx = Object.assign({}, o.ctx, { engine: 'roblox', label: 'Roblox' });
  const agents = [supervisor(ctx, 'Roblox: one Studio window at a time; the builder and QA take turns in it.'), builder(ctx, COLORS[1]), artist(ctx, COLORS[2]), qa(ctx, COLORS[3])];
  return { name: 'Roblox game crew', mcpServers: pick(agents), agents };
}
function prototype(o) {
  const ctx = o.ctx;
  const d = designer(ctx, COLORS[4]);
  d.lead = true;
  d.prompt = d.prompt.replace('Reply that you are ready.', 'You also lead this small team: turn the plan into the smallest playable version (one level, the core loop, placeholder art) and hand the builder one step at a time with send_message. Reply that you are ready.');
  const t = agent({ id: 'tester', name: 'Playtester', role: 'Plays it and reports what feels wrong', color: COLORS[3], model: 'claude-sonnet-5-5', mcp: ENGINES[ctx.engine].mcp.slice(),
    prompt: `You are the Playtester for {project}. ${TALK} After each build step, run the game and report to the designer and builder: what works, what breaks, and what feels slow, confusing or boring, with steps to reproduce. You never edit files. Reply that you are ready.` });
  const agents = [d, builder(ctx, COLORS[1]), t];
  return { name: 'Prototype sprint', mcpServers: pick(agents), agents };
}
function pair(o) {
  const ctx = o.ctx;
  const b = builder(ctx, COLORS[1]);
  b.prompt = `You are the ${b.name} for {project}. ${TALK} ${HOUSE} Read CLAUDE.md if there is one, then wait for the owner's task. When you finish a piece, ask the Reviewer to check it with send_message.`;
  return {
    name: 'Builder + reviewer', mcpServers: pick([b]),
    agents: [b,
      agent({ id: 'reviewer', name: 'Reviewer', role: 'Reviews and tests, never edits', color: COLORS[3], permissionMode: 'plan', model: '',
        prompt: `You are the Reviewer for {project}. ${TALK} You read and test the builder's work but never edit files. Reply with what passed and what failed, with file and line. Wait for the builder's first request.` })],
  };
}
function solo() {
  return { name: 'Solo', mcpServers: {}, agents: [{ id: 'claude', name: 'Claude', role: 'Does the work', color: COLORS[0], command: 'claude', model: '', permissionMode: 'default', mcp: null, autostart: true, prompt: '' }] };
}
function shell() {
  return { name: 'Terminals', mcpServers: {}, agents: [{ id: 'shell', name: 'PowerShell', role: 'Plain terminal', color: COLORS[5], command: process.platform === 'win32' ? 'powershell.exe -NoLogo' : 'bash', model: '', permissionMode: 'default', mcp: null, autostart: true, prompt: '' }] };
}
function pick(agents) {
  const out = {};
  for (const a of agents) for (const k of a.mcp || []) if (MCP[k]) out[k] = MCP[k];
  return out;
}

const LIST = [
  { id: 'studio', name: 'Game studio', build: studio,
    count: (c) => (c.engine === 'web' && !c.blend ? 4 : 5),
    blurb: (c) => `Supervisor, Game designer (writes the game plan with you), ${ENGINES[c.engine].builder}, ${c.engine === 'web' && !c.blend ? '' : '3D artist, '}QA + security. For a new game or a big one.` },
  { id: 'roblox', name: 'Roblox game crew', build: roblox, count: () => 4,
    blurb: () => 'Supervisor, Roblox Studio builder, 3D artist (Blender), QA + security. Uses the Roblox Studio and Blender connections.' },
  { id: 'prototype', name: 'Prototype sprint', build: prototype, count: () => 3,
    blurb: (c) => `Designer (leads), ${ENGINES[c.engine].builder}, Playtester. Gets a first playable version of an idea fast.` },
  { id: 'pair', name: 'Builder + reviewer', build: pair, count: () => 2,
    blurb: (c) => `${ENGINES[c.engine].builder} and a reviewer who never edits. For fixes and small features.` },
  { id: 'solo', name: 'Solo Claude Code', build: solo, count: () => 1, blurb: () => 'One Claude Code console with your usual settings.' },
  { id: 'shell', name: 'Plain terminal', build: shell, count: () => 1, blurb: () => 'A PowerShell console. Add agents later.' },
];

// What the chooser shows for one folder: the presets with counts and blurbs fitted to it, best one first.
function forFolder(projectPath) {
  const ctx = detect(projectPath);
  const best = ctx.engine === 'roblox' ? 'roblox' : 'studio';
  return { detected: ctx, best, presets: LIST.map(p => ({ id: p.id, name: p.name, count: p.count(ctx), blurb: p.blurb(ctx) })) };
}
module.exports = { COLORS, MCP, ENGINES, detect, forFolder, list: LIST.map(p => ({ id: p.id, name: p.name, count: p.count(detect('/nonexistent')), blurb: p.blurb(detect('/nonexistent')), build: (a) => p.build(Object.assign({}, a, { ctx: detect(a.projectPath) })) })) };
