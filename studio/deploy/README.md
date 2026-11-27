# Deploying Studio on aspire

Two units, both **systemd user units** (no `sudo`, no absolute paths, no account
names — `%h` expands to the home of whoever owns the unit):

| Unit | Port | Role |
|---|---|---|
| `openclaude-studio.service` | 8787 | bridge (HTTP + WS, spawns the ACP agent) |
| `openclaude-studio-web.service` | 8768 | static server for the Studio UI |

The legacy `openclaude-web.service` (`acp-web.mjs` on 5178) was removed: Studio
replaces it.

1. Create the environment file:

   ```bash
   install -d -m 700 ~/.config/openclaude-studio
   printf 'OPENCLAUDE_BRIDGE_TOKEN=%s\n' "$(openssl rand -hex 24)" \
     > ~/.config/openclaude-studio/bridge.env
   chmod 600 ~/.config/openclaude-studio/bridge.env
   ```

   Add `OPENCLAUDE_BRIDGE_HOST=<bind address>` to that file to pick the bind
   address (defaults to loopback). Do not bind to `0.0.0.0`.

2. Install dependencies and build:

   ```bash
   cd ~/code/openclaude/studio
   pnpm install
   pnpm --filter @openclaude-studio/bridge build
   pnpm --filter @openclaude-studio/web build
   ```

   The bridge resolves `@rayss-dev/openclaude` through a workspace
   `link:../../..` symlink to the openclaude repo root, so no global
   `@rayss-dev/openclaude` install is needed. Rebuild after any change under
   `packages/bridge/src` and restart the unit.

3. Install and start both units (user scope):

   ```bash
   install -Dm644 deploy/openclaude-studio.service deploy/openclaude-studio-web.service \
     -t ~/.config/systemd/user/
   systemctl --user daemon-reload
   systemctl --user enable --now openclaude-studio.service openclaude-studio-web.service
   # keep them running without an active login
   loginctl enable-linger "$USER"
   ```

4. Read the token once for the browser URL:

   ```bash
   cat ~/.config/openclaude-studio/bridge.env
   ```

5. Open the web app over Tailscale with
   `?bridge=ws://127.0.0.1:8787&token=<token>` when the browser runs on aspire,
   or `ws://<tailscale-host>:8787` when it runs on another tailnet device.
   The web UI itself is served on port 8768.

Do not bind the bridge to `0.0.0.0`. Tailscale already restricts who can reach
the port, and the bearer token is the second layer.

## Web UI layout

The web client is project-first. On load it asks you to pick a project folder, then
lists the OpenClaude sessions that already exist for that folder (read from disk).
A new session is created only when you send the first prompt in a fresh tab, so
refreshing the page no longer spams empty session files.

- **Left — Project** (`ProjectRail`): the active project path, a "Change project"
  button, and that project's sessions. Selecting a session opens it in a tab; the
  "+" button opens an empty tab that starts a session on the first prompt.
- **Center — Chat** (`SessionTabs` / `ChatPane` / `MessageBubble` / `MessageList`):
  one in-app tab per open session, all kept mounted so background streams keep
  running. Composer is an inline textarea (Enter to send, Escape to cancel while
  streaming). Permission requests appear as a modal overlay.
- **Right — Files** (`FileExplorer`): a recursive folder tree of the agent's working
  directory, populated from the bridge.

The active project is remembered in `localStorage` (`openclaude.project`).

## Session connection status

Each session tab shows its live connection state in a status bar at the top of
the chat pane and as a dot on the tab itself, so you are never blind about
whether the agent is reachable:

- **Connected** (green) — the agent socket is open and ready.
- **Connecting to agent…** (pulsing orange) — the handshake or session load is in
  flight. The composer stays disabled until this clears, which is why the first
  prompt in a freshly opened session can feel slow: the pane must finish the
  agent handshake *and* replay the saved transcript before it accepts input.
- **Asleep** (grey) — the tab was backgrounded after the agent finished its turn,
  so Studio soft-closed the WebSocket to free the bridge's agent process while
  keeping the transcript on disk. This is the resource-saving idle state, and it
  is never triggered while the agent is still streaming, awaiting a tool
  permission, or waiting on an `AskUserQuestion` answer — the socket stays open
  in those cases even if you leave the tab. Resuming the tab (or sending the next
  prompt) automatically reopens the connection; a **Wake** button is also shown.
- **Disconnected** (red) — the agent is unreachable. A **Reconnect** button
  re-handshakes from scratch.

Use **End session** (visible while Connected/Asleep) to drop the live connection
on purpose; the transcript remains visible and **Reload** reattaches it.

A freshly restored background tab mounts asleep on purpose so it does not spawn
an agent process until you actually view it.

## Project and session endpoints

The bridge serves both, token-gated the same way as `/fs` (query `?token=` or
`Authorization: Bearer`):

```
GET http://<bridge-host>:8787/projects
GET http://<bridge-host>:8787/sessions?cwd=<absolute path>
```

- `/projects` returns `{ projects: [{ name, path, sessionCount }] }`.
- `/sessions` returns `{ sessions: [{ id, title, updatedAt, messageCount }] }`.
- The listings come from `~/.openclaude/projects/<sanitized-cwd>/`, where every
  non-alphanumeric character of the working directory is replaced with `-`.
- Missing `cwd` → `400`; wrong/absent token → `401`.

## Filesystem endpoint

The bridge serves a read-only directory listing over HTTP:

```
GET http://<bridge-host>:8787/fs?path=<relative>&token=<token>
```

- Requires the same bearer token as the WebSocket (query `?token=` or
  `Authorization: Bearer`). Wrong/absent token → `401`.
- Returns JSON `{ root, path, entries: [{ name, path, kind, size }] }`, scoped to
  the bridge's working directory. Path traversal outside the root is rejected.
- The web app derives the HTTP origin from the bridge `ws://` URL (drop the
  `ws` scheme, keep host:8787), so the static web UI and the bridge must share
  the same host/port.

## Web UI static server

The built SPA in `apps/web/dist` is served by `deploy/web/serve.mjs` — a tiny
static file server (no auth of its own). It runs as the second unit
(`openclaude-studio-web.service`, installed in step 3 above) and is `PartOf` the
bridge unit, so restarting the bridge also restarts the web server.

Optional host/port overrides go in `~/.config/openclaude-studio/web.env`
(`WEB_HOST`, `WEB_PORT`). The server binds `127.0.0.1:8768` by default and has no
authentication, so bind it to the Tailscale address rather than `0.0.0.0`.

Rebuild the web app (`pnpm --filter @openclaude-studio/web build`) after changing
`apps/web` or `packages/ui`, then `systemctl --user restart openclaude-studio-web`.
