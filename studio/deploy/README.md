# Deploying the bridge on aspire

1. Create the environment file:

   ```bash
   install -d -m 700 ~/.config/openclaude-studio
   printf 'OPENCLAUDE_BRIDGE_TOKEN=%s\n' "$(openssl rand -hex 24)" \
     > ~/.config/openclaude-studio/bridge.env
   chmod 600 ~/.config/openclaude-studio/bridge.env
   ```

2. Install dependencies and build the bridge:

   ```bash
   cd /home/dy/code/openclaude/studio
   pnpm install
   pnpm --filter @openclaude-studio/bridge build
   ```

   The bridge resolves `@rayss-dev/openclaude` through a workspace
   `link:../../..` symlink to the openclaude repo root, so no global
   `@rayss-dev/openclaude` install is needed. Rebuild after any change under
   `packages/bridge/src` and restart the unit.

3. Install and start the unit:

   ```bash
   sudo cp deploy/openclaude-studio.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now openclaude-studio
   ```

4. Read the token once for the browser URL:

   ```bash
   sudo cat ~/.config/openclaude-studio/bridge.env
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
static file server (no auth of its own). Serve it as a second systemd unit so it
survives reboots instead of a manually launched `/tmp/serve.mjs`.

Install and start:

```bash
sudo cp deploy/openclaude-studio-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now openclaude-studio-web
```

Optional host/port overrides go in `/home/dy/.config/openclaude-studio/web.env`
(`WEB_HOST`, `WEB_PORT`). The server binds `127.0.0.1:8768` by default and has no
authentication, so bind it to the Tailscale address (e.g. `WEB_HOST=100.84.56.62`)
rather than `0.0.0.0`. It runs as a `PartOf` the bridge unit, so restarting the
bridge also restarts the web server, and the web server is stopped when the
bridge stops.

Rebuild the web app (`pnpm --filter @openclaude-studio/web build`) after changing
`apps/web` or `packages/ui`, then `sudo systemctl restart openclaude-studio-web`.
