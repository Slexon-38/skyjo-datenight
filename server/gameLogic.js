// Alle Spielregeln laufen NUR auf dem Server
function makeDeck() {
  const d = [];
  const add = (v, n) => { for (let i = 0; i < n; i++) d.push({ v, up: false }); };
  add(-2, 5); add(-1, 10); add(0, 15);
  for (let v = 1; v <= 12; v++) add(v, 10);
  return shuffle(d);
}

function shuffle(a) {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

function newRound(prevTotals) {
  const deck = makeDeck();
  return {
    players: [0, 1].map(i => ({
      id: i, name: ['Simi', 'Lol'][i],
      grid: Array.from({ length: 12 }, () => ({ ...deck.pop() })),
      total: prevTotals?.[i] ?? 0
    })),
    deck, discard: [{ ...deck.pop(), up: true }],
    cur: 0, phase: 'setup', pending: null,
    flips: [0, 0], round: 1, log: []
  };
}

// Gibt die sichere Sicht für einen bestimmten Spieler zurück
function viewFor(state, viewerIdx) {
  const s = JSON.parse(JSON.stringify(state));
  s.viewer = viewerIdx;
  const over = ['round-over', 'game-over'].includes(s.phase);
  s.players.forEach(p => {
    if (p.id !== viewerIdx && !over) {
      p.grid = p.grid.map(c => c.up ? c : { v: null, up: false });
    }
    p.roundScore = over ? p.grid.reduce((a, c) => a + c.v, 0) : '?';
  });
  if (s.pending && s.cur !== viewerIdx) s.pending = { v: null, up: false };
  return s;
}

module.exports = { newRound, viewFor, shuffle };
