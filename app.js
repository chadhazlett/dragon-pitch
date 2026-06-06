/* ============================================================
   Dragon Pitch — absolute-pitch trainer for Ronin
   Vanilla JS + Tone.js. No backend; localStorage per player.
   ============================================================ */

"use strict";

/* ---------- note model ---------- */
// pitch classes in semitone order; sharps flagged for styling
// Each black key is shown with ONE fixed name (a mix of sharps and flats) so Ronin
// learns both symbols without the confusion of one key having two names. `name` is the
// canonical id used for logic/playback; `label` is what he sees on the button.
const PITCHES = [
  { name: "C",  label: "C",  sharp: false },
  { name: "C#", label: "C♯", sharp: true  },
  { name: "D",  label: "D",  sharp: false },
  { name: "D#", label: "E♭", sharp: true  },
  { name: "E",  label: "E",  sharp: false },
  { name: "F",  label: "F",  sharp: false },
  { name: "F#", label: "F♯", sharp: true  },
  { name: "G",  label: "G",  sharp: false },
  { name: "G#", label: "A♭", sharp: true  },
  { name: "A",  label: "A",  sharp: false },
  { name: "A#", label: "B♭", sharp: true  },
  { name: "B",  label: "B",  sharp: false },
];
const idxOf = (n) => PITCHES.findIndex((p) => p.name === n);
const WHITE  = ["C", "D", "E", "F", "G", "A", "B"];
const ALL12  = PITCHES.map((p) => p.name);
// black-key horizontal positions (% from left) over a 7-white-key octave,
// each centered on the gap between the two white keys it sits between
const BLACK_LAYOUT = [
  { name: "C#", left: 9.9 },
  { name: "D#", left: 24.2 },
  { name: "F#", left: 52.7 },
  { name: "G#", left: 67.0 },
  { name: "A#", left: 81.3 },
];

/* ---------- boss ladder (difficulty stages) ---------- */
// notes: pitch classes available;  octaves: which octaves the mystery note may play in
// hp: correct answers needed to defeat;  clock: beat-the-clock on?
const BOSSES = [
  { name: "Ender Dragon",        key: "ender",    emoji: "🐉", color: "#9b5cff", notes: ["C","E","G"],                 octaves: [4],        hp: 6,  clock: false },
  { name: "Mother Wither Storm", key: "wither",   emoji: "🌪️", color: "#8a8a8a", notes: ["C","D","E","G","A"],         octaves: [4],        hp: 8,  clock: false },
  { name: "God Dragon",          key: "god",      emoji: "🐲", color: "#ffd23f", notes: WHITE,                          octaves: [4],        hp: 10, clock: false },
  { name: "Titan Dragon",        key: "titan",    emoji: "🦖", color: "#7ad36b", notes: WHITE,                          octaves: [3,4],      hp: 10, clock: false },
  { name: "Water Dragon",        key: "water",    emoji: "🐉", color: "#4fc3ff", notes: [...WHITE, "F#", "A#"],          octaves: [3,4],      hp: 12, clock: false }, // first black keys: 1 sharp (F♯) + 1 flat (B♭)
  { name: "Soulfire Dragon",     key: "soulfire", emoji: "🔥", color: "#ff7a3f", notes: [...WHITE, "F#", "A#", "C#", "D#"], octaves: [3,4],   hp: 12, clock: false }, // + C♯ and E♭ (now 4 black keys)
  { name: "Glacier Dragon",      key: "glacier",  emoji: "🧊", color: "#9af0ff", notes: ALL12,                          octaves: [3,4,5],    hp: 14, clock: false },
  { name: "Gold Dragon",         key: "gold",     emoji: "🐉", color: "#ffcf33", notes: ALL12,                          octaves: [2,3,4,5],  hp: 16, clock: true  },
];
const dragonArt = (key) => `assets/dragons/${key}.svg`;
const MAX_HEARTS = 5;
const CLOCK_MS = 12000; // beat-the-clock window

/* ---------- persistence ---------- */
const LS_PLAYERS = "dragonpitch.players";
const LS_LAST = "dragonpitch.lastPlayer";
const playerKey = (name) => "dragonpitch.player." + name;

function listPlayers() {
  try { return JSON.parse(localStorage.getItem(LS_PLAYERS)) || []; }
  catch { return []; }
}
function savePlayersList(arr) { localStorage.setItem(LS_PLAYERS, JSON.stringify(arr)); }

function newPlayerData(name) {
  return {
    name,
    stars: 0,
    bossIndex: 0,      // dragon currently selected to play
    maxBoss: 0,        // furthest dragon unlocked (highest reached)
    bestStreak: 0,
    stats: {},           // pitchName -> { attempts, correct }
    history: [],         // recent { played, guess, correct, t }
    settings: { free: false, notes: WHITE.slice(), octaves: [4], clock: false, noise: false },
  };
}
function loadPlayer(name) {
  try {
    const d = JSON.parse(localStorage.getItem(playerKey(name)));
    if (d) {
      const merged = Object.assign(newPlayerData(name), d);
      merged.maxBoss = Math.max(merged.maxBoss || 0, merged.bossIndex || 0); // migrate older saves
      // backfill any settings keys added in later versions (e.g. noise)
      merged.settings = Object.assign({ free: false, notes: WHITE.slice(), octaves: [4], clock: false, noise: false }, merged.settings);
      return merged;
    }
  } catch {}
  return newPlayerData(name);
}
function savePlayer(d) { localStorage.setItem(playerKey(d.name), JSON.stringify(d)); }

/* ---------- runtime state ---------- */
let player = null;       // current player data
let sampler = null;      // Tone.Sampler
let audioReady = false;
let round = null;        // { note, octave, answered }
let bossHpLeft = 0;
let hearts = MAX_HEARTS;
let streak = 0;
let clockTimer = null;
let clockRAF = null;
let justBeatLast = false;
let sessCorrect = 0;     // correct answers this play session
let sessWrong = 0;       // mistakes this play session (drives Bravery)
let lastNote = null;     // previous note name, to avoid immediate repeats

/* ---------- DOM helpers ---------- */
const $ = (id) => document.getElementById(id);
const screens = ["splash", "profiles", "game"];
function showScreen(id) {
  screens.forEach((s) => $(s).classList.toggle("active", s === id));
}
function openModal(id) { $(id).classList.add("open"); }
function closeModal(id) { $(id).classList.remove("open"); }

/* ============================================================
   AUDIO
   ============================================================ */
function buildSampler() {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    sampler = new Tone.Sampler({
      urls: {
        "C2": "C2.mp3", "D#2": "Ds2.mp3", "F#2": "Fs2.mp3", "A2": "A2.mp3",
        "C3": "C3.mp3", "D#3": "Ds3.mp3", "F#3": "Fs3.mp3", "A3": "A3.mp3",
        "C4": "C4.mp3", "D#4": "Ds4.mp3", "F#4": "Fs4.mp3", "A4": "A4.mp3",
        "C5": "C5.mp3", "D#5": "Ds5.mp3", "F#5": "Fs5.mp3", "A5": "A5.mp3",
        "C6": "C6.mp3",
      },
      baseUrl: "assets/piano/",
      release: 0.8,
      onload: () => { audioReady = true; done(); },
      onerror: (e) => { console.warn("piano sample load error", e); done(); },
    }).toDestination();
    // Belt-and-suspenders: Tone.loaded() resolves when every buffer is ready,
    // and a timeout guarantees we never hang the splash forever.
    if (Tone.loaded) Tone.loaded().then(() => { audioReady = true; done(); }).catch(() => {});
    setTimeout(done, 8000);
  });
}
function playNote(pitch, octave, dur) {
  if (!audioReady || !sampler) return;
  try {
    const ctx = Tone.getContext();
    if (ctx.state !== "running") ctx.resume();   // recover if the browser throttled/suspended audio
    sampler.releaseAll();                          // single-note game: don't let voices pile up over time
    sampler.triggerAttackRelease(pitch + octave, dur || 1.3);
  } catch (e) { console.warn("playNote", e); }
}

// "Pitch cleanser": a quick scramble of random notes that wipes short-term pitch
// memory between trials, so Ronin must name the target note cold (absolute pitch)
// instead of judging it relative to the previous one. Calls onDone after it finishes.
function playScramble(onDone) {
  if (!audioReady || !sampler) { onDone(); return; }
  try {
    const ctx = Tone.getContext();
    if (ctx.state !== "running") ctx.resume();
    const t0 = Tone.now();
    const step = 0.06, K = 10;        // ~0.6s of rapid notes
    for (let i = 0; i < K; i++) {
      const n = ALL12[Math.floor(Math.random() * 12)] + [3, 4, 5][Math.floor(Math.random() * 3)];
      sampler.triggerAttackRelease(n, step * 1.2, t0 + i * step, 0.5); // softer velocity
    }
    setTimeout(onDone, (K * step + 0.2) * 1000); // short gap, then the target note
  } catch (e) { console.warn("scramble", e); onDone(); }
}

/* ============================================================
   PROFILES
   ============================================================ */
function renderProfiles() {
  const ul = $("profileList");
  ul.innerHTML = "";
  const names = listPlayers();
  if (!names.length) {
    ul.innerHTML = '<li class="muted small">No players yet — add one below!</li>';
  }
  names.forEach((name) => {
    const d = loadPlayer(name);
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.innerHTML = `<span>${escapeHtml(name)}</span><span class="pstars">⭐ ${d.stars}</span>`;
    b.onclick = () => startWithPlayer(name);
    li.appendChild(b);
    ul.appendChild(li);
  });
}
function addProfile() {
  const inp = $("newName");
  const name = inp.value.trim();
  if (!name) return;
  const names = listPlayers();
  if (!names.includes(name)) { names.push(name); savePlayersList(names); savePlayer(newPlayerData(name)); }
  inp.value = "";
  startWithPlayer(name);
}
function startWithPlayer(name) {
  player = loadPlayer(name);
  localStorage.setItem(LS_LAST, name);
  $("playerName").textContent = name;
  sessCorrect = 0; sessWrong = 0;
  updateScorebar();
  showScreen("game");
  loadBoss();
}
// Bravery = frustration tolerance: +1 for every mistake, only ever goes up — so
// making mistakes always feels rewarding (helps Ronin not fear getting it wrong).
function updateScorebar() {
  $("scCorrect").textContent = sessCorrect;
  $("scBrave").textContent = sessWrong;
}
// noise toggle is mirrored on the play page and in the menu — keep both in sync
function setNoise(on) {
  player.settings.noise = on;
  savePlayer(player);
  $("noiseToggle").checked = on;
  $("menuNoise").checked = on;
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

/* ============================================================
   GAME SETUP PER BOSS / PRACTICE
   ============================================================ */
function activeConfig() {
  if (player.settings.free) {
    return {
      name: "Free Practice", key: "ender", emoji: "🎹", color: "#7c4dff",
      notes: player.settings.notes.length ? player.settings.notes : WHITE.slice(),
      octaves: player.settings.octaves.length ? player.settings.octaves : [4],
      hp: Infinity, clock: player.settings.clock,
    };
  }
  return BOSSES[Math.min(player.bossIndex, BOSSES.length - 1)];
}
function loadBoss() {
  const cfg = activeConfig();
  bossHpLeft = cfg.hp;
  hearts = MAX_HEARTS;
  streak = 0;
  $("bossNum").textContent = player.settings.free ? "★" : (player.bossIndex + 1);
  $("bossName").textContent = cfg.name;
  $("bossSprite").src = dragonArt(cfg.key);
  $("bossSprite").alt = cfg.name;
  $("bossSprite").style.filter = `drop-shadow(0 6px 16px ${cfg.color}cc)`;
  // tint the blocky wallpaper + show a big faint dragon to match the current boss
  $("bgTint").style.background = `radial-gradient(circle at 50% 30%, ${cfg.color}55, rgba(0,0,0,0) 62%)`;
  $("bgDragon").style.backgroundImage = `url(${dragonArt(cfg.key)})`;
  $("starCount").textContent = player.stars;
  $("noiseToggle").checked = !!player.settings.noise;
  renderNoteButtons(cfg);
  updateBossUI();
  newRound();
}
function updateBossUI() {
  const cfg = activeConfig();
  const pct = cfg.hp === Infinity ? 100 : Math.max(0, (bossHpLeft / cfg.hp) * 100);
  $("bossHp").style.width = pct + "%";
  $("hearts").textContent = "❤️".repeat(hearts) + "🖤".repeat(MAX_HEARTS - hearts);
  $("starCount").textContent = player.stars;
}
function renderNoteButtons(cfg) {
  const wrap = $("noteButtons");
  wrap.innerHTML = "";
  wrap.className = "piano";
  const active = new Set(cfg.notes);
  // white keys in a row
  const row = document.createElement("div");
  row.className = "white-row";
  WHITE.forEach((n) => row.appendChild(makeKey(n, active.has(n), false)));
  wrap.appendChild(row);
  // black keys positioned on top
  BLACK_LAYOUT.forEach((bk) => {
    const key = makeKey(bk.name, active.has(bk.name), true);
    key.style.left = bk.left + "%";
    wrap.appendChild(key);
  });
}
// Build one piano key. In-use notes are labeled + clickable; unused ones are greyed and inert.
function makeKey(name, isActive, isBlack) {
  const p = PITCHES[idxOf(name)];
  const el = document.createElement("button");
  el.className = "note-key " + (isBlack ? "black" : "white") + (isActive ? " note-btn" : " inactive");
  if (isActive) {
    el.dataset.note = name;
    el.innerHTML = `<span class="klabel">${p.label}</span>`;
    el.onclick = () => guess(name, el);
  } else {
    el.disabled = true;
    el.tabIndex = -1;
  }
  return el;
}

/* ============================================================
   ROUND LOOP
   ============================================================ */
function newRound() {
  const cfg = activeConfig();
  // avoid immediately repeating the same note name (still random among the rest)
  const pool = cfg.notes.length > 1 ? cfg.notes.filter((n) => n !== lastNote) : cfg.notes;
  const note = pool[Math.floor(Math.random() * pool.length)];
  lastNote = note;
  const octave = cfg.octaves[Math.floor(Math.random() * cfg.octaves.length)];
  round = { note, octave, answered: false };
  clearButtonStates();
  setFeedback("", "");
  $("hearBtn").textContent = "🔊 Hear the note";
  $("hearBtn").classList.remove("replay");
  // small delay, then (optionally) the pitch-cleanser scramble, then the target note
  setTimeout(() => {
    const playTarget = () => { playNote(note, octave); startClock(cfg); };
    if (player.settings.noise) playScramble(playTarget);
    else playTarget();
  }, 350);
}
function clearButtonStates() {
  document.querySelectorAll(".note-btn").forEach((b) => b.classList.remove("correct", "wrong", "disabled"));
}
function setFeedback(text, kind) {
  const f = $("feedback");
  f.textContent = text || " ";
  f.className = "feedback" + (kind ? " " + kind : "");
}

function guess(noteName, btn) {
  if (!round || round.answered) return;
  round.answered = true;
  stopClock();
  const correctName = round.note;
  const isRight = noteName === correctName;

  // stats
  const st = player.stats[correctName] || (player.stats[correctName] = { attempts: 0, correct: 0 });
  st.attempts++; if (isRight) st.correct++;
  player.history.unshift({ played: correctName, guess: noteName, correct: isRight, oct: round.octave });
  if (player.history.length > 100) player.history.pop();

  // mark buttons
  document.querySelectorAll(".note-btn").forEach((b) => b.classList.add("disabled"));
  const correctBtn = document.querySelector(`.note-btn[data-note="${cssEsc(correctName)}"]`);
  if (isRight) {
    if (btn) btn.classList.add("correct");
    onCorrect();
  } else {
    if (btn) btn.classList.add("wrong");
    if (correctBtn) correctBtn.classList.add("correct");
    onWrong(noteName, correctName);
  }
  // replay the correct note so the ear links sound -> name
  setTimeout(() => playNote(correctName, round.octave, 1.2), 250);

  savePlayer(player);
  // leave the "what it was" message up a bit longer after a miss so it sinks in
  setTimeout(nextOrEnd, isRight ? 1500 : 2500);
}
function cssEsc(n) { return n.replace("#", "\\#"); }

function onCorrect() {
  sessCorrect++; updateScorebar();
  streak++;
  if (streak > player.bestStreak) player.bestStreak = streak;
  let gained = 1;
  if (streak > 0 && streak % 5 === 0) gained += 1; // streak bonus
  player.stars += gained;
  bossHpLeft -= 1;
  const msgs = ["Nice! 🎵", "Got it! ⭐", "Perfect pitch! 🎯", "Yes! 🐉💥", "Boom! 💥"];
  let txt = msgs[Math.floor(Math.random() * msgs.length)];
  if (streak >= 3) txt += `  🔥 ${streak} streak`;
  setFeedback(txt, "good");
  const s = $("bossSprite"); s.classList.remove("hit"); void s.offsetWidth; s.classList.add("hit");
  updateBossUI();
}
function onWrong(guessName, correctName) {
  sessWrong++; updateScorebar();
  streak = 0;
  hearts -= 1;
  setFeedback(closeMessage(guessName, correctName), "bad");
  const s = $("bossSprite"); s.classList.remove("attack"); void s.offsetWidth; s.classList.add("attack");
  updateBossUI();
}
// how-close feedback by semitone distance (pitch-class, circular, nearest direction)
function closeMessage(guessName, correctName) {
  let diff = idxOf(correctName) - idxOf(guessName);     // + means correct is higher
  while (diff > 6) diff -= 12;
  while (diff < -6) diff += 12;
  const steps = Math.abs(diff);
  const correctLabel = PITCHES[idxOf(correctName)].label;
  if (steps === 0) return "So close!";
  const dir = diff > 0 ? "low" : "high";
  const stepWord = steps === 1 ? "step" : "steps";
  return `It was ${correctLabel} — just ${steps} ${stepWord} too ${dir}!`;
}

function nextOrEnd() {
  const cfg = activeConfig();
  if (!player.settings.free && bossHpLeft <= 0) { winBoss(); return; }
  if (!player.settings.free && hearts <= 0) { loseBoss(); return; }
  newRound();
}

/* ---------- beat the clock ---------- */
function startClock(cfg) {
  if (!cfg.clock) { $("timerWrap").classList.add("hidden"); return; }
  $("timerWrap").classList.remove("hidden");
  const fill = $("timerFill");
  const start = Tone.now();
  const tick = () => {
    if (!round || round.answered) return;
    const elapsed = (Tone.now() - start) * 1000;
    const pct = Math.max(0, 100 - (elapsed / CLOCK_MS) * 100);
    fill.style.width = pct + "%";
    if (pct <= 0) { timeUp(); return; }
    clockRAF = requestAnimationFrame(tick);
  };
  clockRAF = requestAnimationFrame(tick);
}
function stopClock() {
  if (clockRAF) cancelAnimationFrame(clockRAF);
  $("timerWrap").classList.add("hidden");
}
function timeUp() {
  if (!round || round.answered) return;
  round.answered = true;
  document.querySelectorAll(".note-btn").forEach((b) => b.classList.add("disabled"));
  const correctBtn = document.querySelector(`.note-btn[data-note="${cssEsc(round.note)}"]`);
  if (correctBtn) correctBtn.classList.add("correct");
  streak = 0; hearts -= 1;
  setFeedback(`Time! It was ${PITCHES[idxOf(round.note)].label} ⏰`, "bad");
  setTimeout(() => playNote(round.note, round.octave, 1.2), 200);
  sessWrong++; updateScorebar();
  updateBossUI();
  savePlayer(player);
  setTimeout(nextOrEnd, 2500);
}

/* ---------- win / lose boss ---------- */
function winBoss() {
  const cfg = BOSSES[player.bossIndex];
  player.stars += 5; // boss bonus
  const isLast = player.bossIndex >= BOSSES.length - 1;
  justBeatLast = isLast;
  // unlock the next dragon the first time this one is cleared (replays never lose progress)
  if (!isLast && player.bossIndex === player.maxBoss) {
    player.maxBoss = Math.min(BOSSES.length - 1, player.maxBoss + 1);
  } else if (isLast) {
    player.maxBoss = BOSSES.length - 1;
  }
  $("winSprite").src = dragonArt(cfg.key);
  $("winTitle").textContent = isLast ? "🏆 You beat them ALL!" : `${cfg.name} defeated! 🎉`;
  $("winText").textContent = isLast
    ? "Every dragon is slain. You are a Pitch Master, Ronin! ⭐ +5"
    : `+5 ⭐ bonus!  Next up: ${BOSSES[player.bossIndex + 1].name}`;
  $("nextBossBtn").textContent = isLast ? "Choose a dragon 🗺️" : "Next dragon →";
  if (!isLast) player.bossIndex += 1; // advance to the next (now-unlocked) dragon
  savePlayer(player);
  openModal("winModal");
}

/* ---------- dragon select (replay any cleared dragon) ---------- */
function renderBossSelect() {
  const wrap = $("dragonSelect");
  wrap.innerHTML = "";
  for (let i = 0; i <= player.maxBoss; i++) {
    const b = BOSSES[i];
    const btn = document.createElement("button");
    const now = i === player.bossIndex ? '<span class="cur">▶ now</span>' : "";
    btn.innerHTML = `<span>${b.emoji} ${i + 1}. ${escapeHtml(b.name)}</span>${now}`;
    btn.onclick = () => {
      player.bossIndex = i;
      savePlayer(player);
      closeModal("selectModal");
      closeModal("menuModal");
      loadBoss();
    };
    wrap.appendChild(btn);
  }
}
function openBossSelect() { renderBossSelect(); openModal("selectModal"); }
function loseBoss() {
  setFeedback("The dragon flew off… try again! 🐉", "bad");
  setTimeout(() => loadBoss(), 1200); // restart same boss, stars kept
}

/* ============================================================
   MENU / SETTINGS / EXPORT
   ============================================================ */
function openMenu() {
  renderStats();
  $("freePractice").checked = player.settings.free;
  $("menuNoise").checked = !!player.settings.noise;
  $("practiceClock").checked = player.settings.clock;
  $("practiceOpts").classList.toggle("hidden", !player.settings.free);
  renderPracticePickers();
  openModal("menuModal");
}
function renderStats() {
  const total = Object.values(player.stats).reduce((a, s) => a + s.attempts, 0);
  const right = Object.values(player.stats).reduce((a, s) => a + s.correct, 0);
  const pct = total ? Math.round((right / total) * 100) : 0;
  let html = `<div><b>${escapeHtml(player.name)}</b> · ⭐ ${player.stars} · best streak ${player.bestStreak}</div>`;
  html += `<div>Answered ${total} notes · ${pct}% correct</div>`;
  html += `<div class="notegrid">`;
  PITCHES.forEach((p) => {
    const s = player.stats[p.name];
    if (!s || !s.attempts) return;
    const a = Math.round((s.correct / s.attempts) * 100);
    html += `<span>${p.label}<br>${a}%</span>`;
  });
  html += `</div>`;
  $("statBlock").innerHTML = html;
}
function renderPracticePickers() {
  const nWrap = $("practiceNotes"); nWrap.innerHTML = "";
  PITCHES.forEach((p) => {
    const b = document.createElement("button");
    b.textContent = p.label;
    b.className = player.settings.notes.includes(p.name) ? "on" : "";
    b.onclick = () => {
      const arr = player.settings.notes;
      const i = arr.indexOf(p.name);
      if (i >= 0) arr.splice(i, 1); else arr.push(p.name);
      b.className = arr.includes(p.name) ? "on" : "";
      savePlayer(player);
    };
    nWrap.appendChild(b);
  });
  const oWrap = $("practiceOctaves"); oWrap.innerHTML = "";
  [2, 3, 4, 5, 6].forEach((oc) => {
    const b = document.createElement("button");
    b.textContent = oc;
    b.className = player.settings.octaves.includes(oc) ? "on" : "";
    b.onclick = () => {
      const arr = player.settings.octaves;
      const i = arr.indexOf(oc);
      if (i >= 0) arr.splice(i, 1); else arr.push(oc);
      b.className = arr.includes(oc) ? "on" : "";
      savePlayer(player);
    };
    oWrap.appendChild(b);
  });
}
function exportProgress() {
  const data = JSON.stringify(player, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `dragonpitch-${player.name}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function importProgress(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      if (!d.name) throw new Error("bad file");
      player = Object.assign(newPlayerData(d.name), d);
      const names = listPlayers();
      if (!names.includes(d.name)) { names.push(d.name); savePlayersList(names); }
      savePlayer(player);
      localStorage.setItem(LS_LAST, d.name);
      $("playerName").textContent = d.name;
      closeModal("menuModal");
      loadBoss();
    } catch { alert("Sorry, that file could not be read."); }
  };
  reader.readAsText(file);
}

/* ============================================================
   WIRING
   ============================================================ */
function wire() {
  $("startBtn").onclick = async () => {
    $("startBtn").disabled = true;            // prevent a confusing double-tap
    $("loadingMsg").textContent = "Loading piano…";
    try { await Tone.start(); } catch {}
    // make sure the audio context is actually running (browser autoplay rules)
    try { const ctx = Tone.getContext(); if (ctx.state !== "running") await ctx.resume(); } catch {}
    if (!sampler) await buildSampler();
    // if buffers aren't ready yet, give them a moment (never block forever)
    if (!audioReady && Tone.loaded) {
      try { await Promise.race([Tone.loaded(), new Promise((r) => setTimeout(r, 5000))]); } catch {}
      audioReady = audioReady || (sampler && sampler.loaded);
    }
    $("loadingMsg").textContent = audioReady ? "" : "Piano still loading — sound will start in a moment…";
    $("startBtn").disabled = false;
    const last = localStorage.getItem(LS_LAST);
    renderProfiles();
    if (last && listPlayers().includes(last)) startWithPlayer(last);
    else showScreen("profiles");
  };

  $("addProfileBtn").onclick = addProfile;
  $("newName").addEventListener("keydown", (e) => { if (e.key === "Enter") addProfile(); });

  $("hearBtn").onclick = () => {
    if (round && !round.answered) {
      playNote(round.note, round.octave);
      $("hearBtn").textContent = "🔁 Hear again";
      $("hearBtn").classList.add("replay");
    }
  };

  $("menuBtn").onclick = openMenu;
  $("closeMenuBtn").onclick = () => { closeModal("menuModal"); loadBoss(); };
  $("freePractice").onchange = (e) => {
    player.settings.free = e.target.checked;
    $("practiceOpts").classList.toggle("hidden", !e.target.checked);
    savePlayer(player);
  };
  $("practiceClock").onchange = (e) => { player.settings.clock = e.target.checked; savePlayer(player); };
  $("noiseToggle").onchange = (e) => setNoise(e.target.checked);
  $("menuNoise").onchange = (e) => setNoise(e.target.checked);
  $("switchPlayerBtn").onclick = () => { closeModal("menuModal"); renderProfiles(); showScreen("profiles"); };
  $("resetBossBtn").onclick = () => { closeModal("menuModal"); loadBoss(); };
  $("exportBtn").onclick = exportProgress;
  $("importBtn").onclick = () => $("importFile").click();
  $("importFile").onchange = (e) => { if (e.target.files[0]) importProgress(e.target.files[0]); };

  // resume audio if the browser throttled/suspended it while the tab was away
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { try { const ctx = Tone.getContext(); if (ctx.state !== "running") ctx.resume(); } catch {} }
  });

  $("nextBossBtn").onclick = () => { closeModal("winModal"); if (justBeatLast) openBossSelect(); else loadBoss(); };
  $("chooseDragonBtn").onclick = openBossSelect;
  $("closeSelectBtn").onclick = () => closeModal("selectModal");

  // Register the service worker for offline play (network-first: always fresh when
  // online, cached for the car). reset.html stays as a manual cache-buster if needed.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

wire();
