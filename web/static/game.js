// One game page: draw the board, poll the server, send moves.
// The rules live on the server; nothing here decides whether a move is legal.

const SIZE = 9;
const STARS = [[2, 2], [2, 6], [6, 2], [6, 6], [4, 4]];

const gameId = location.pathname.split('/').filter(Boolean)[1] || '';
const storageKey = 'avgo:' + gameId;

const canvas = document.getElementById('board');
const context = canvas.getContext('2d');
const statusLine = document.getElementById('status');
const scoreLine = document.getElementById('score');
const errorLine = document.getElementById('error');
const passButton = document.getElementById('pass');
const joinForm = document.getElementById('joinForm');
const joinName = document.getElementById('joinName');
const joinButton = joinForm.querySelector('button');
const inviteRow = document.getElementById('inviteRow');
const inviteField = document.getElementById('invite');
const seatsRow = document.getElementById('seats');
const muteButton = document.getElementById('mute');
const muteWaves = document.getElementById('muteWaves');
const muteCross = document.getElementById('muteCross');
const chatPanel = document.getElementById('chat');
const chatLog = document.getElementById('chatLog');
const chatEmpty = document.getElementById('chatEmpty');
const chatForm = document.getElementById('chatForm');
const chatText = document.getElementById('chatText');
const seatEls = {
  1: document.getElementById('seatBlack'),
  2: document.getElementById('seatWhite'),
};

let token = localStorage.getItem(storageKey) || '';
let state = null;
let cells = new Array(SIZE * SIZE).fill(0);
let lastPlaced = -1;
let hovered = -1;
let lastMoves = null;
let lastPasses = null;
let chatShown = '';
let lastChatAt = null;
let muted = localStorage.getItem('avgo:muted') === '1';

const headers = () => (token ? { 'x-player-token': token } : {});
const colorName = (n) => (n === 1 ? 'Black' : n === 2 ? 'White' : 'nobody');
const nameOf = (color) =>
  (color === 1 ? state.blackName : state.whiteName) || colorName(color);
const myTurn = () =>
  state && state.status === 'playing' && state.you !== 0 && state.you === state.turn;

/* ------------------------------------------------------------------ sound -- */

// Synthesised rather than loaded, so the server has no audio file to serve.
let audio = null;

function unlockAudio() {
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch (unsupported) {
    audio = null;
  }
}

// Browsers keep an audio context suspended until the page has been touched.
document.addEventListener('pointerdown', unlockAudio);
document.addEventListener('keydown', unlockAudio);

function showMute() {
  muteWaves.hidden = muted;
  muteCross.hidden = !muted;
  muteButton.setAttribute('aria-pressed', String(muted));
  const label = muted ? 'Unmute sounds' : 'Mute sounds';
  muteButton.title = label;
  muteButton.setAttribute('aria-label', label);
}

muteButton.addEventListener('click', () => {
  muted = !muted;
  localStorage.setItem('avgo:muted', muted ? '1' : '0');
  showMute();
});

showMute();

function audible() {
  return audio && audio.state === 'running' && !muted;
}

function playStone() {
  if (!audible()) return;
  const now = audio.currentTime;

  const samples = Math.floor(audio.sampleRate * 0.05);
  const buffer = audio.createBuffer(1, samples, audio.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < samples; i++) {
    channel[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / samples, 6);
  }
  const noise = audio.createBufferSource();
  noise.buffer = buffer;
  const band = audio.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1900;
  band.Q.value = 0.9;
  const noiseGain = audio.createGain();
  noiseGain.gain.setValueAtTime(0.35, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  noise.connect(band).connect(noiseGain).connect(audio.destination);
  noise.start(now);

  const thock = audio.createOscillator();
  thock.type = 'triangle';
  thock.frequency.setValueAtTime(340, now);
  thock.frequency.exponentialRampToValueAtTime(120, now + 0.05);
  const thockGain = audio.createGain();
  thockGain.gain.setValueAtTime(0.18, now);
  thockGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
  thock.connect(thockGain).connect(audio.destination);
  thock.start(now);
  thock.stop(now + 0.09);
}

function playChime(incoming) {
  // Two short tones, a fifth apart: up for a message arriving, down for one
  // leaving, so you can tell them apart without looking.
  if (!audible()) return;
  const now = audio.currentTime;
  const low = incoming ? 660 : 780;
  const high = incoming ? 990 : 520;

  const tone = audio.createOscillator();
  tone.type = 'sine';
  tone.frequency.setValueAtTime(low, now);
  tone.frequency.setValueAtTime(high, now + 0.08);

  const level = audio.createGain();
  level.gain.setValueAtTime(0.0001, now);
  level.gain.exponentialRampToValueAtTime(0.09, now + 0.012);
  level.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);

  tone.connect(level).connect(audio.destination);
  tone.start(now);
  tone.stop(now + 0.26);
}

function soundMoves() {
  // Both players' stones arrive the same way: the move count went up. A pass
  // advances that count too, so it is told apart by its own counter rising.
  if (lastMoves !== null && state.moves > lastMoves && state.passes <= lastPasses) {
    playStone();
  }
  lastMoves = state.moves;
  lastPasses = state.passes;
}

/* ----------------------------------------------------------------- board -- */

function geometry() {
  const pad = canvas.width * 0.055;
  return { pad, step: (canvas.width - 2 * pad) / (SIZE - 1) };
}

function pointAt(index) {
  const { pad, step } = geometry();
  return {
    x: pad + (index % SIZE) * step,
    y: pad + Math.floor(index / SIZE) * step,
  };
}

function drawStone(x, y, r, color, alpha) {
  context.save();
  context.globalAlpha = alpha;
  const light = color === 1 ? '#5c554a' : '#ffffff';
  const dark = color === 1 ? '#17150f' : '#ded7c5';
  const shade = context.createRadialGradient(
    x - r * 0.35, y - r * 0.4, r * 0.08, x, y, r,
  );
  shade.addColorStop(0, light);
  shade.addColorStop(1, dark);
  context.shadowColor = 'rgba(0, 0, 0, .35)';
  context.shadowBlur = r * 0.35;
  context.shadowOffsetY = r * 0.14;
  context.beginPath();
  context.arc(x, y, r, 0, Math.PI * 2);
  context.fillStyle = shade;
  context.fill();
  context.restore();
}

function draw() {
  const { pad, step } = geometry();
  const size = canvas.width;
  context.clearRect(0, 0, size, size);

  context.strokeStyle = 'rgba(0, 0, 0, .55)';
  context.lineWidth = 1;
  for (let i = 0; i < SIZE; i++) {
    const at = Math.round(pad + i * step) + 0.5;
    context.beginPath();
    context.moveTo(pad, at);
    context.lineTo(size - pad, at);
    context.moveTo(at, pad);
    context.lineTo(at, size - pad);
    context.stroke();
  }

  context.fillStyle = 'rgba(0, 0, 0, .6)';
  for (const [row, col] of STARS) {
    context.beginPath();
    context.arc(pad + col * step, pad + row * step, 3.5, 0, Math.PI * 2);
    context.fill();
  }

  const radius = step * 0.45;

  cells.forEach((value, index) => {
    if (!value) return;
    const { x, y } = pointAt(index);
    drawStone(x, y, radius, value, 1);
  });

  // A quiet ring on the stone that just landed, so a move is easy to find.
  if (lastPlaced >= 0 && cells[lastPlaced]) {
    const { x, y } = pointAt(lastPlaced);
    context.beginPath();
    context.arc(x, y, radius * 0.38, 0, Math.PI * 2);
    context.strokeStyle = cells[lastPlaced] === 1 ? 'rgba(255,255,255,.75)' : 'rgba(0,0,0,.55)';
    context.lineWidth = 2;
    context.stroke();
  }

  // Where your stone would go, if it is your turn and the point is free.
  if (hovered >= 0 && myTurn() && !cells[hovered]) {
    const { x, y } = pointAt(hovered);
    drawStone(x, y, radius, state.you, 0.35);
  }
}

function adoptBoard(next) {
  // The server sends the board, not the move, so the new stone is whichever
  // point went from empty to occupied since the last time we looked.
  const placed = next.findIndex((value, index) => value !== 0 && cells[index] === 0);
  if (placed >= 0) lastPlaced = placed;
  cells = next;
}

/* --------------------------------------------------------------- chrome -- */

function seat(color, name) {
  // Names are other people's text, so they are written as text, never markup.
  const el = seatEls[color];
  const captures = color === 1 ? state.capturedByBlack : state.capturedByWhite;
  el.querySelector('.seat-name').textContent = name || 'open seat';
  el.querySelector('.seat-you').textContent = state.you === color ? '(you)' : '';
  // A player who has captured nothing gets no badge rather than a zero.
  el.querySelector('.seat-captures').textContent = captures ? '+' + captures : '';
  el.classList.toggle('is-turn', state.status === 'playing' && state.turn === color);
  el.classList.toggle('is-open', !name);
}

function clockOf(at) {
  if (!at) return '';
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function bubble(message, previous) {
  const mine = message.color === state.you;
  const line = document.createElement('li');
  line.className = 'chat-line' + (mine ? ' is-mine' : '');

  const body = document.createElement('div');
  body.className = 'bubble';

  // The name earns its place only when the speaker just changed, and never on
  // your own messages — those are the ones sitting on the right.
  if (!mine && (!previous || previous.color !== message.color)) {
    const who = document.createElement('span');
    who.className = 'bubble-who';
    who.textContent = nameOf(message.color);
    body.append(who);
  }

  const said = document.createElement('span');
  said.className = 'bubble-text';
  // Messages are other people's text, so they are written as text.
  said.textContent = message.text;

  const at = document.createElement('time');
  at.className = 'bubble-at';
  at.textContent = clockOf(message.at);

  body.append(said, at);
  line.append(body);
  return line;
}

function renderChat() {
  const messages = state.messages || [];
  // Rebuilding every second would fight the reader's scroll and selection, so
  // the log is only redrawn when it actually changed.
  const newest = messages.length ? messages[messages.length - 1] : null;
  if (lastChatAt !== null && newest && newest.at > lastChatAt) {
    playChime(newest.color !== state.you);
  }
  lastChatAt = newest ? newest.at : 0;

  const signature = messages.length + ':' + (newest ? newest.at : '');
  chatPanel.hidden = false;
  chatForm.hidden = state.you === 0;
  chatEmpty.hidden = messages.length > 0;
  if (signature === chatShown) return;
  chatShown = signature;

  // Only follow the conversation down if the reader was already at the bottom.
  const atBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 24;

  chatLog.textContent = '';
  messages.forEach((message, index) => {
    chatLog.append(bubble(message, messages[index - 1]));
  });

  if (atBottom) chatLog.scrollTop = chatLog.scrollHeight;
}

function say(text, lead) {
  statusLine.textContent = '';
  if (lead) {
    const strong = document.createElement('b');
    strong.textContent = lead;
    statusLine.append(strong, text ? ' ' + text : '');
  } else {
    statusLine.textContent = text;
  }
}

function render() {
  if (!state) {
    draw();
    return;
  }
  soundMoves();
  adoptBoard(state.board.split(',').map(Number));
  draw();

  const you = state.you;
  seatsRow.hidden = false;
  seat(1, state.blackName);
  seat(2, state.whiteName);

  if (state.status === 'waiting') {
    say(you === 0
      ? 'This game is waiting for a second player.'
      : 'Waiting for the other player to join.');
  } else if (state.status === 'finished') {
    const black = state.blackScore, white = state.whiteScore;
    say(black === white ? 'A draw.' : (black > white ? state.blackName : state.whiteName) + ' wins.',
        'Game over.');
  } else {
    // Whose turn it is already shows on the seats. A line here would appear
    // and vanish every turn, shoving the chat up and down with it.
    say('');
  }

  scoreLine.textContent = state.status === 'finished'
    ? 'Final score — Black ' + state.blackScore + ' · White ' + state.whiteScore
    : 'move ' + state.moves;

  renderChat();
  canvas.classList.toggle('is-playable', myTurn());
  passButton.disabled = !myTurn();
  joinForm.hidden = !(state.status === 'waiting' && you === 0);
  inviteRow.hidden = !(state.status === 'waiting' && you !== 0);
  inviteField.value = location.href;
}

/* ---------------------------------------------------------------- server -- */

async function call(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'request failed');
  return data;
}

async function poll() {
  try {
    state = await call('/api/games/' + gameId, { headers: headers() });
    errorLine.textContent = '';
    render();
  } catch (failure) {
    errorLine.textContent = failure.message;
  }
}

async function send(body) {
  try {
    state = await call('/api/games/' + gameId + '/move', {
      method: 'POST',
      headers: { ...headers(), 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    errorLine.textContent = '';
    render();
  } catch (failure) {
    errorLine.textContent = failure.message;
  }
}

/* ------------------------------------------------------------ interaction -- */

function indexAt(event) {
  const rect = canvas.getBoundingClientRect();
  const scale = canvas.width / rect.width;
  const { pad, step } = geometry();
  const col = Math.round(((event.clientX - rect.left) * scale - pad) / step);
  const row = Math.round(((event.clientY - rect.top) * scale - pad) / step);
  if (col < 0 || col >= SIZE || row < 0 || row >= SIZE) return -1;
  return row * SIZE + col;
}

canvas.addEventListener('pointermove', (event) => {
  const index = indexAt(event);
  if (index === hovered) return;
  hovered = index;
  draw();
});

canvas.addEventListener('pointerleave', () => {
  if (hovered === -1) return;
  hovered = -1;
  draw();
});

canvas.addEventListener('click', (event) => {
  if (!myTurn()) return;
  const index = indexAt(event);
  if (index >= 0) send('idx=' + index);
});

passButton.addEventListener('click', () => send('pass=true'));

joinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  joinButton.disabled = true;
  try {
    const taken = await call('/api/games/' + gameId + '/join', {
      method: 'POST',
      headers: { ...headers(), 'content-type': 'application/x-www-form-urlencoded' },
      body: 'name=' + encodeURIComponent(joinName.value),
    });
    token = taken.token;
    localStorage.setItem(storageKey, token);
    await poll();
  } catch (failure) {
    errorLine.textContent = failure.message;
  }
  joinButton.disabled = false;
});

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const said = chatText.value;
  if (!said.trim()) return;
  chatText.value = '';
  try {
    state = await call('/api/games/' + gameId + '/chat', {
      method: 'POST',
      headers: { ...headers(), 'content-type': 'application/x-www-form-urlencoded' },
      body: 'text=' + encodeURIComponent(said),
    });
    errorLine.textContent = '';
    render();
    chatLog.scrollTop = chatLog.scrollHeight;
  } catch (failure) {
    // Put the message back so a refusal does not eat what was typed.
    chatText.value = said;
    errorLine.textContent = failure.message;
  }
});

document.getElementById('copy').addEventListener('click', () => {
  navigator.clipboard?.writeText(location.href);
  inviteField.select();
});

draw();
poll();
setInterval(poll, 1000);
