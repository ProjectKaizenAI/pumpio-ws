import http from "http";
import { WebSocketServer } from "ws";
import { randomUUID } from "crypto";

// ---------- Config ----------
const PORT = process.env.PORT || 8787;
const TICK_MS = 1000; // lobby broadcast tick

// ---------- In-memory state ----------
const clients = new Map(); // id -> { ws, username, wallet, isAlive }
let status = "WAITING";    // WAITING | COUNTDOWN | IN_MATCH
let countdownMs = 0;
let lastPlayerCount = 0;
const resetTimestamps = []; // track joins during countdown for failsafe

// ---------- Utilities ----------
const shortWallet = w => (w && w.length > 8 ? `${w.slice(0,3)}…${w.slice(-3)}` : (w || ""));
const now = () => Date.now();

function playerCount() {
  let n = 0;
  for (const c of clients.values()) if (c.ws.readyState === 1) n++;
  return n;
}

function playersList() {
  return Array.from(clients.entries()).map(([id, c]) => ({
    id, u: c.username || "anon", w: shortWallet(c.wallet || "")
  }));
}

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const c of clients.values()) {
    if (c.ws.readyState === 1) c.ws.send(msg);
  }
}

function broadcastLobby() {
  broadcast({
    type: "lobby_update",
    status,
    players: playersList(),
    ...(status === "COUNTDOWN" ? { countdownMs: Math.max(0, Math.round(countdownMs)) } : {})
  });
}

// ---------- Lobby logic ----------
function onPlayerJoin() {
  const c = playerCount();

  if (status === "IN_MATCH") {
    // Late joiners spectate (client-side). We just keep broadcasting status.
    broadcastLobby();
    return;
  }

  if (c < 10) {
    status = "WAITING";
    countdownMs = 0;
  } else {
    if (status !== "COUNTDOWN") {
      status = "COUNTDOWN";
      countdownMs = 20000;
      resetTimestamps.length = 0; // reset history
    } else if (c > lastPlayerCount) {
      countdownMs = 20000; // reset on each new join while counting down
      resetTimestamps.push(now());
    }
  }
  lastPlayerCount = c;
  broadcastLobby();
}

function tickLobby(dt) {
  if (status !== "COUNTDOWN") return;

  if (playerCount() < 10) {
    status = "WAITING";
    countdownMs = 0;
    broadcastLobby();
    return;
  }

  // Failsafe: if too many resets in 30s, clamp remaining countdown to 10s
  const cutoff = now() - 30000;
  while (resetTimestamps.length && resetTimestamps[0] < cutoff) resetTimestamps.shift();
  if (resetTimestamps.length > 3 && countdownMs > 10000) {
    countdownMs = 10000;
  }

  countdownMs -= dt;
  if (countdownMs <= 0) {
    status = "IN_MATCH";
    countdownMs = 0;
    // In a full server you'd start the match loop & snapshots here:
    broadcast({ type: "match_start", seed: Math.floor(Math.random() * 1e9), world: { w: 8000, h: 8000 } });
    broadcastLobby();
  } else {
    broadcastLobby();
  }
}

// ---------- HTTP server (for Render health checks) ----------
const server = http.createServer((req, res) => {
  // Simple health/status page
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, status, players: playerCount(), countdownMs }));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("pump.io ws server ok\n");
});

server.listen(PORT, () => {
  console.log(`[pump.io] HTTP/WS listening on :${PORT}`);
});

// ---------- WebSocket server ----------
const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const id = randomUUID();
  const info = { ws, username: null, wallet: null, isAlive: true };
  clients.set(id, info);

  // Welcome packet
  ws.send(JSON.stringify({ type: "welcome", playerId: id, serverTime: Date.now(), tickRate: 30 }));

  // First lobby state
  broadcastLobby();

  ws.on("message", (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }

    switch (msg.type) {
      case "ping":
        ws.send(JSON.stringify({ type: "pong", t: Date.now() }));
        return;
      case "hello": {
        const c = clients.get(id);
        if (!c) return;
        c.username = String(msg.username || "").slice(0, 16);
        c.wallet = String(msg.wallet || "").slice(0, 64);
        onPlayerJoin();
        return;
      }
      case "req_lobby":
        broadcastLobby();
        return;
      // Other messages (input, spectate_target, etc.) are no-ops in this minimal server.
      default:
        return;
    }
  });

  ws.on("close", () => {
    clients.delete(id);

    // Recompute lobby state if not in match
    if (status !== "IN_MATCH") {
      if (playerCount() < 10) {
        status = "WAITING";
        countdownMs = 0;
      }
      broadcastLobby();
    }
  });

  ws.on("error", (err) => {
    console.error("[ws error]", err?.message || err);
  });
});

// Keep-alive ping to detect dead connections
setInterval(() => {
  for (const [id, c] of clients.entries()) {
    if (c.ws.readyState !== 1) {
      clients.delete(id);
      continue;
    }
    try {
      c.ws.ping();
    } catch {}
  }
}, 15000);

// Main lobby timer
setInterval(() => {
  tickLobby(TICK_MS);
  // prune disconnected
  for (const [id, c] of clients.entries()) {
    if (c.ws.readyState !== 1) clients.delete(id);
  }
}, TICK_MS);
