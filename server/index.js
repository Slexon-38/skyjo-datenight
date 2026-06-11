const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const { createClient } = require('@supabase/supabase-js');
const { newRound, viewFor, shuffle } = require('./gameLogic');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Supabase (Umgebungsvariablen von Render)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

app.get('/', (req, res) => res.send('Skyjo Server läuft ❤️'));

// Spielzustand im Speicher (+ DB-Backup)
let state = null;
const sockets = {}; // { 0: ws, 1: ws }

async function saveState() {
  if (!state) return;
  await supabase.from('games').upsert({
    id: 'main', state: JSON.stringify(state), updated_at: new Date()
  });
}

async function loadState() {
  const { data } = await supabase
    .from('games').select('state').eq('id', 'main').single();
  if (data?.state) state = JSON.parse(data.state);
}

function pushAll() {
  [0, 1].forEach(idx => {
    const ws = sockets[idx];
    if (ws?.readyState === 1) {
      ws.send(JSON.stringify({ t: 'state', view: viewFor(state, idx) }));
    }
  });
  saveState();
}

function log(txt) {
  if (!state) return;
  state.log = [txt, ...(state.log || [])].slice(0, 40);
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const playerIdx = parseInt(url.searchParams.get('player') || '0');
  const secret = url.searchParams.get('secret');

  // Einfacher Secret-Check
  const secrets = ['2211', '2408']; // ← ihr ändert diese!
  if (secret !== secrets[playerIdx]) {
    ws.send(JSON.stringify({ t: 'error', msg: 'Falsches Passwort!' }));
    ws.close();
    return;
  }

  sockets[playerIdx] = ws;
  console.log(`Spieler ${playerIdx} verbunden`);
  ws.send(JSON.stringify({ t: 'hello', playerIdx }));

  if (state) {
    ws.send(JSON.stringify({ t: 'state', view: viewFor(state, playerIdx) }));
  }

  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    handleAction(msg, playerIdx);
  });

  ws.on('close', () => {
    console.log(`Spieler ${playerIdx} getrennt`);
    delete sockets[playerIdx];
  });
});

function handleAction(msg, from) {
  if (msg.t === 'start') {
    state = newRound(state?.players?.map(p => p.total));
    state.players[0].name = msg.names?.[0] || 'Simi';
    state.players[1].name = msg.names?.[1] || 'Lol';
    log(`Spiel gestartet!`);
    pushAll(); return;
  }
  if (msg.t === 'new-round') {
    const totals = state?.players?.map(p => p.total) || [0, 0];
    state = newRound(state.phase === 'game-over' ? [0, 0] : totals);
    state.round = (state.round || 0) + 1;
    log('Neue Runde!'); pushAll(); return;
  }
  if (msg.t === 'reset') { state = null; saveState(); pushAll(); return; }
  if (!state || !['setup', 'turn'].includes(state.phase)) return;

  const me = state.players[from];

  if (state.phase === 'setup') {
    if (msg.t !== 'flip-setup') return;
    const c = me.grid[msg.i]; if (!c || c.up) return;
    c.up = true; state.flips[from]++;
    log(`${me.name} deckt Startkarte auf (${state.flips[from]}/2)`);
    if (state.flips.every(n => n >= 2)) {
      state.phase = 'turn'; state.cur = 0;
      log(`${state.players[0].name} beginnt!`);
    }
    pushAll(); return;
  }

  if (state.cur !== from) return;

  if (msg.t === 'draw-deck') {
    if (state.pending || !state.deck.length) return;
    if (state.deck.length === 0) {
      const top = state.discard.pop();
      state.deck = shuffle(state.discard.map(c => ({ ...c, up: false })));
      state.discard = [top];
    }
    state.pending = { ...state.deck.pop(), up: true };
    state.pendingSrc = 'deck';
    log(`${me.name} zieht ${state.pending.v}`);
    pushAll(); return;
  }
  if (msg.t === 'draw-discard') {
    if (state.pending || !state.discard.length) return;
    state.pending = { ...state.discard.pop(), up: true };
    state.pendingSrc = 'discard';
    log(`${me.name} nimmt Ablage (${state.pending.v})`);
    pushAll(); return;
  }
  if (msg.t === 'swap') {
    if (!state.pending) return;
    const t = me.grid[msg.i]; if (!t) return;
    const old = { ...t, up: true };
    me.grid[msg.i] = { ...state.pending, up: true };
    state.discard.push(old);
    state.pending = null;
    log(`${me.name} tauscht → ${me.grid[msg.i].v}`);
    if (!finishRound()) state.cur = state.cur === 0 ? 1 : 0;
    pushAll(); return;
  }
  if (msg.t === 'discard-flip') {
    if (!state.pending) return;
    const t = me.grid[msg.i]; if (!t || t.up) return;
    state.discard.push({ ...state.pending, up: true });
    t.up = true; state.pending = null;
    log(`${me.name} deckt ${t.v} auf`);
    if (!finishRound()) state.cur = state.cur === 0 ? 1 : 0;
    pushAll(); return;
  }
}

function finishRound() {
  const act = state.cur;
  if (!state.players[act].grid.every(c => c.up)) return false;
  state.phase = 'round-over';
  state.players.forEach(p => p.grid.forEach(c => c.up = true));
  const sc = state.players.map(p => p.grid.reduce((a, c) => a + c.v, 0));
  if (sc[act] !== Math.min(...sc)) { sc[act] *= 2; }
  state.players.forEach((p, i) => p.total += sc[i]);
  log(`Runde vorbei! ${state.players[0].name}: ${sc[0]} | ${state.players[1].name}: ${sc[1]}`);
  if (state.players.some(p => p.total >= 100)) { state.phase = 'game-over'; log('Spiel beendet!'); }
  return true;
}

// Beim Start gespeicherten State laden
loadState().then(() => {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
});
