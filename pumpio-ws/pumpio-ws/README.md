# pumpio-ws (minimal WebSocket server)

A minimal Node.js WebSocket backend for **pump.io** that:
- Accepts connections and `hello` packets
- Maintains lobby states: **WAITING → COUNTDOWN → IN_MATCH**
- Enforces **≥10 players**, **20s countdown**, and **reset countdown on each new join**
- Emits `welcome`, `lobby_update`, and `match_start` (when countdown reaches 0)
- Exposes an HTTP `GET /health` for Render health checks

> This is a starter. You can add snapshots, physics, spectate, and leaderboard later.

## Run locally

```bash
npm install
npm start
# WS: ws://localhost:8787  |  HTTP health: http://localhost:8787/health
```

## Deploy on Render (UI)

1. Push this folder to a new GitHub repo (e.g., `pumpio-ws`).
2. Go to **render.com** → **New** → **Web Service**.
3. Connect your GitHub repo.
4. Settings:
   - Environment: **Node**
   - Build command: `npm install`
   - Start command: `npm start`
5. Create service → wait for build → you’ll get a URL like:
   - `https://YOUR-SERVICE.onrender.com` (HTTP)
   - `wss://YOUR-SERVICE.onrender.com` (WebSocket)
6. In **Bolt** → **Settings → Environment Variables**:
   ```
   VITE_WS_URL = wss://YOUR-SERVICE.onrender.com
   ```
7. Redeploy your Bolt site.

## Deploy on Render (Blueprint, optional)

You can also commit a `render.yaml` and create via **New → Blueprint**.

```yaml
services:
  - type: web
    name: pumpio-ws
    env: node
    plan: free
    buildCommand: "npm install"
    startCommand: "npm start"
    autoDeploy: true
```

## Endpoints

- `GET /health` → `{ ok, status, players, countdownMs }`
- WebSocket endpoint: root (`wss://.../`)

## Notes

- For production, consider origin checks to allow only your Bolt domain.
- When you implement full gameplay, start broadcasting `snapshot` at ~30 Hz during `IN_MATCH`.
