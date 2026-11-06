const {lessons, chars, words} = DATA;
const {groups: sGroups, lex, items: sents} = SENT;
const C = Object.fromEntries(chars.map(c => [c.c, c]));
const W = Object.fromEntries(words.map(w => [w.id, w]));
const ST = Object.fromEntries(sents.map(s => [s.id, s]));
const DAY = 864e5, INTERVALS = [0, 1, 2, 4, 8, 16, 32, 64];
const NEW_PER_SESSION = 5, GOAL = 30;
const SCHOOL_H = 10, PAST_APP_H = 2, IDLE_MS = 60e3; // hours in class; estimated app hours before the timer existed; idle cutoff
const NEW_SENT_ROUND = 5, NEW_SENT_DAY = 15, MIX_WINDOW = 30, TRIP = new Date(2027, 2, 28);

// ---------- state ----------
const S = Object.assign({srs: {}, xp: 0, streak: 0, last: "", today: "", done: 0, best: 0, ach: {}, crowns: {},
  freeze: 0, chest: "", maxCombo: 0, perfects: 0, mute: false, speedRuns: 0, drawn: 0, drawPerfect: 0, noListenUntil: 0, studySecs: 0},
  JSON.parse(localStorage.getItem("hanzi-kscx01") || "{}"));
// one-time fix: drop items saved by the old bug (marked learned but never tested => due still 0)
if (!S.fixUntested) { for (const k in S.srs) if (S.srs[k].due === 0) delete S.srs[k]; S.fixUntested = 1; localStorage.setItem("hanzi-kscx01", JSON.stringify(S)); }
// merge a backup/other state into S (keeps the better of both, never loses progress)
function mergeState(o) {
  for (const k in o.srs || {}) { const a = S.srs[k], b = o.srs[k]; if (!a || b.box > a.box || (b.box === a.box && b.due > a.due)) S.srs[k] = b; }
  for (const k of ["xp", "best", "maxCombo", "perfects", "speedRuns", "drawn", "drawPerfect", "freeze", "noListenUntil", "studySecs"]) S[k] = Math.max(S[k] || 0, o[k] || 0);
  for (const k of ["ach", "crowns"]) S[k] = Object.assign({}, o[k], S[k]);
  for (const k of ["last", "chest"]) if ((o[k] || "") > (S[k] || "")) S[k] = o[k];
  if (o.last === S.last) S.streak = Math.max(S.streak, o.streak);
  if (o.today === S.today) S.done = Math.max(S.done, o.done);
}
// one-time restore of progress lost by a stale tab overwrite (re-applies itself if a stale tab overwrites again)
if (typeof RESTORE !== "undefined" && !S.restored1) { mergeState(RESTORE); S.restored1 = 1; localStorage.setItem("hanzi-kscx01", JSON.stringify(S)); }
const save = () => localStorage.setItem("hanzi-kscx01", JSON.stringify(S));
// multiple tabs (new tab + app window): adopt changes saved by other tabs so a stale tab never overwrites progress
window.addEventListener("storage", e => {
  if (e.key !== "hanzi-kscx01" || !e.newValue) return;
  const o = JSON.parse(e.newValue);
  if (!o.restored1) { mergeState(o); S.restored1 = 1; save(); return; } // written by an old, not-refreshed tab: merge, don't trust
  for (const k in S) if (!(k in o)) delete S[k]; Object.assign(S, o);
});
const dayStr = (off = 0) => new Date(Date.now() + off * DAY).toLocaleDateString("sv");
function rollDay() { if (S.today !== dayStr()) { S.today = dayStr(); S.done = 0; save(); } }
function liveStreak() {
  if (S.last === dayStr() || S.last === dayStr(-1)) return S.streak;
  if (S.last === dayStr(-2) && S.freeze > 0) return S.streak;
  return 0;
}
// answer log for later analysis: [unix secs, item key, exercise type, 1 = right / 0 = wrong / 2 = "neviem"], separate key so tab merging stays simple
const LOG_KEY = "hanzi-kscx01-log", LOG_MAX = 30000;
function logAnswer(k, type, res) {
  try {
    const L = JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
    L.push([Math.round(Date.now() / 1000), k, type, res]);
    localStorage.setItem(LOG_KEY, JSON.stringify(L.slice(-LOG_MAX)));
  } catch (e) {}
}
function exportProgress() {
  let log = []; try { log = JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); } catch (e) {}
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify({exported: new Date().toISOString(), state: S, log})], {type: "application/json"}));
  a.download = `hanzi-kscx01-${dayStr()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function answered(ok, k, type, idk) {
  if (k) logAnswer(k, type, idk ? 2 : ok ? 1 : 0);
  rollDay(); S.done++;
  if (S.done === GOAL && S.last !== S.today) {
    if (S.last === dayStr(-1)) S.streak++;
    else if (S.last === dayStr(-2) && S.freeze > 0) { S.freeze--; S.streak++; toast("❄️", "Zmrazenie série použité", "Séria zachránená!"); }
    else S.streak = 1;
    S.last = S.today;
    if (S.streak % 7 === 0 && S.freeze < 2) { S.freeze++; setTimeout(() => toast("❄️", "Získal si zmrazenie série", "Jeden vynechaný deň ti neodpáli sériu"), 1500); }
    goalModal = true;
  }
  save();
}
let goalModal = false;
const known = k => k in S.srs;
const charKnown = c => known("c:" + c);
const due = () => Object.keys(S.srs).filter(k => S.srs[k].due <= Date.now()).sort((a, b) => S.srs[a].due - S.srs[b].due);
// step: 0 = guessed (keep box), 1 = knew it, 2 = easy (skip a box)
const nextBox = (k, step) => Math.max(1, Math.min((S.srs[k]?.box || 0) + step, INTERVALS.length - 1));
// guessed: new cards come back in 10 min, others at half the interval
const ivalMs = (k, step) => { const b = nextBox(k, step); return step === 0 ? (b <= 1 ? 600e3 : INTERVALS[b] * DAY / 2) : INTERVALS[b] * DAY; };
const fmtIval = ms => { const d = Math.round(ms / DAY); return ms < DAY / 2 ? Math.round(ms / 60e3) + " min" : d <= 1 ? "1 deň" : d < 5 ? d + " dni" : d + " dní"; };
function grade(k, ok, step = 1) {
  const r = S.srs[k] || (S.srs[k] = {box: 0, due: 0});
  const ms = ok ? ivalMs(k, step) : 0;
  r.box = ok ? nextBox(k, step) : 0;
  r.due = Date.now() + (ok ? ms : -1);
  save();
}
const tier = k => !known(k) ? 0 : S.srs[k].box >= 6 ? 4 : S.srs[k].box >= 4 ? 3 : S.srs[k].box >= 2 ? 2 : 1;
const hanzi = s => [...s].filter(ch => C[ch]);
const wordUnlocked = w => hanzi(w.zh).every(charKnown);
function unlockWords() {
  const out = [];
  for (const w of words) if (!known("w:" + w.id) && wordUnlocked(w)) { S.srs["w:" + w.id] = {box: 0, due: 0}; out.push(w); }
  save(); return out;
}
const nextNew = l => {
  const list = chars.filter(c => !charKnown(c.c) && (l == null || c.l === l));
  if (l != null) return list;
  // characters you already met in your sentences come first
  const met = new Set(sents.filter(s => known("s:" + s.id)).flatMap(s => [...s.zh]));
  return [...list.filter(c => met.has(c.c)), ...list.filter(c => !met.has(c.c))];
};
const countKnownSents = () => sents.filter(s => known("s:" + s.id)).length;
// ---------- sentences ----------
function knownTokens() {
  const set = new Set();
  for (const s of sents) if (known("s:" + s.id)) s.t.forEach(t => set.add(t));
  for (const w of words) if (known("w:" + w.id)) set.add(w.zh.replace(/[！？。，…]/g, ""));
  for (const c of chars) if (charKnown(c.c)) set.add(c.c);
  return set;
}
const newTokens = (s, kn) => [...new Set(s.t)].filter(t => !kn.has(t));
// next sentences, i+1 style: fewest unknown words first, ties broken at random; mostly top-1000 words, mixed with trip and textbook phrases
function nextSents(n, g) {
  const kn = knownTokens(), out = [];
  let pool = sents.filter(s => !known("s:" + s.id) && (!g || s.g === g));
  const kind = Object.fromEntries(sGroups.map(x => [x.id, x.k]));
  for (let i = 0; i < n && pool.length; i++) {
    const want = ["freq", "trip", "freq", "book", "freq"][i % 5];
    // slang stays last; trip topics mix freely, top-1000 and textbook keep their rough order
    const clean = pool.filter(s => s.g !== "x1"), base = clean.length ? clean : pool;
    const match = base.filter(s => kind[s.g] === want);
    const sub = match.length ? match : base;
    const costs = sub.map(s => newTokens(s, kn).length), min = Math.min(...costs), first = costs.indexOf(min);
    const best = pick(sub.filter((_, j) => costs[j] === min && (want === "trip" || j < first + MIX_WINDOW)));
    out.push(best); best.t.forEach(t => kn.add(t));
    pool = pool.filter(s => s !== best);
  }
  return out;
}
const sNewToday = () => S.sDay === dayStr() ? S.sNew || 0 : 0;
const daysToTrip = () => Math.max(0, Math.ceil((TRIP - Date.now()) / DAY));
const sentType = k => {
  const s = ST[k.slice(2)], box = S.srs[k]?.box || 0, n = s.t.length;
  const opts = box <= 1 ? ["s-read", "s-ear", n > 1 ? "s-cloze" : "s-read", n > 2 ? "s-build" : "s-speak"]
    : box <= 3 ? [n > 2 ? "s-build" : "s-read", n > 1 ? "s-cloze" : "s-ear", "s-ear", "s-speak"]
    : [n > 2 ? "s-build-ear" : "s-speak", "s-speak", n > 2 ? "s-build" : "s-ear"];
  return pick(opts);
};
const countKnownChars = () => chars.filter(c => charKnown(c.c)).length;
const countKnownWords = () => words.filter(w => known("w:" + w.id)).length;
// best single character to learn next: unlocks most words
function teaser() {
  const m = {};
  for (const w of words) {
    if (known("w:" + w.id)) continue;
    const miss = [...new Set(hanzi(w.zh).filter(ch => !charKnown(ch)))];
    if (miss.length === 1) (m[miss[0]] = m[miss[0]] || []).push(w);
  }
  const best = Object.entries(m).sort((a, b) => b[1].length - a[1].length)[0];
  return best && {c: C[best[0]], ws: best[1]};
}

// ---------- levels ----------
function LV(xp) { let l = 1, need = 80; while (xp >= need) { xp -= need; l++; need = Math.round(need * 1.2); } return {l, x: xp, need}; }
const RANKS = ["Nováčik", "Žiak", "Študent", "Pisár", "Učenec", "Majster štetca", "Mudrc", "Cisársky úradník", "Drak"];
const rank = l => RANKS[Math.min(RANKS.length - 1, Math.floor((l - 1) / 3))];
function gainXP(n, el) {
  const before = LV(S.xp).l;
  S.xp += n; save();
  if (el) floatText("+" + n, el);
  const after = LV(S.xp).l;
  if (after > before) {
    sfx.lvl(); burst(innerWidth / 2, innerHeight / 3, 90);
    toast("⬆️", `Level ${after}!`, rank(after));
  }
}

// ---------- achievements ----------
const ACH = [
  ["first", "🌱", "Prvý znak", "Nauč sa prvý znak", () => countKnownChars() >= 1],
  ["c10", "📜", "Desiatka", "10 znakov", () => countKnownChars() >= 10],
  ["c50", "🖌️", "Päťdesiat", "50 znakov", () => countKnownChars() >= 50],
  ["c100", "🏯", "Stovka", "100 znakov", () => countKnownChars() >= 100],
  ["call", "🐉", "Všetky znaky", `Všetkých ${chars.length} znakov`, () => countKnownChars() >= chars.length],
  ["s10", "🗣️", "Prvé vety", "10 viet", () => countKnownSents() >= 10],
  ["s50", "💬", "Dokážem sa dohovoriť", "50 viet", () => countKnownSents() >= 50],
  ["s150", "🧳", "Pripravený na cestu", "150 viet", () => countKnownSents() >= 150],
  ["sall", "🇨🇳", "Celá kniha viet", `Všetkých ${sents.length} viet`, () => countKnownSents() >= sents.length],
  ["w1", "🔓", "Prvé slovo", "Odomkni slovo z Anki", () => countKnownWords() >= 1],
  ["w50", "📇", "Slovník", "50 slov z Anki", () => countKnownWords() >= 50],
  ["wall", "📚", "Celý deck", `Všetkých ${words.length} slov`, () => countKnownWords() >= words.length],
  ["k10", "🔥", "V ráži", "10 správne za sebou", () => S.maxCombo >= 10],
  ["k25", "☄️", "Nezastaviteľný", "25 správne za sebou", () => S.maxCombo >= 25],
  ["perfect", "💯", "Bez chyby", "Kolo bez jedinej chyby", () => S.perfects >= 1],
  ["s15", "⚡", "Rýchlik", "15 bodov v 60 sekundách", () => S.best >= 15],
  ["s30", "🚀", "Blesk", "30 bodov v 60 sekundách", () => S.best >= 30],
  ["d3", "📅", "3 dni v rade", "Séria 3 dni", () => S.streak >= 3],
  ["d7", "🗓️", "Týždeň", "Séria 7 dní", () => S.streak >= 7],
  ["d30", "🏆", "Mesiac", "Séria 30 dní", () => S.streak >= 30],
  ["crown", "👑", "Prvá korunka", "Zvládni majstrovskú skúšku", () => Object.keys(S.crowns).length >= 1],
  ["crowns", "🤴", "Cisár", "Korunky zo všetkých lekcií", () => lessons.every((_, i) => S.crowns[i])],
  ["gold", "⭐", "Zlatý znak", "Dostaň znak na zlato", () => chars.some(c => tier("c:" + c.c) === 4)],
  ["draw1", "✍️", "Prvý ťah", "Nakresli prvý znak", () => S.drawn >= 1],
  ["draw25", "🖋️", "Pisár", "Nakresli 25 znakov", () => S.drawn >= 25],
  ["draw10p", "🎨", "Kaligraf", "10 znakov nakreslených bez chyby", () => S.drawPerfect >= 10],
  ["night", "🦉", "Nočná sova", "Uč sa po 23:00", () => new Date().getHours() >= 23],
  ["early", "🐓", "Ranné vtáča", "Uč sa pred 7:00", () => new Date().getHours() < 7 && S.done > 0],
];
function checkAch() {
  let d = 0;
  for (const [id, i, t, desc, test] of ACH) if (!S.ach[id] && test()) {
    S.ach[id] = dayStr(); save();
    setTimeout(() => { sfx.ach(); toast(i, "Odznak: " + t, desc); burst(innerWidth / 2, 60, 40); }, 400 + d++ * 900);
  }
}

// ---------- juice: sound, confetti, toasts ----------
let ac;
function tone(f, d = .12, type = "sine", v = .12, when = 0) {
  if (S.mute) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + when;
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.001, t + d);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + d + .02);
  } catch {}
}
const sfx = {
  ok: c => { const b = 523 * 2 ** (Math.min(c, 14) / 12); tone(b, .1, "triangle"); tone(b * 1.5, .16, "triangle", .1, .07); },
  bad: () => { tone(180, .18, "square", .05); tone(120, .25, "square", .05, .08); },
  lvl: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, .22, "triangle", .12, i * .08)),
  ach: () => [784, 988, 1319, 1568].forEach((f, i) => tone(f, .25, "sine", .12, i * .07)),
  coin: () => { tone(988, .08, "square", .05); tone(1319, .2, "square", .05, .07); },
  tick: () => tone(880, .04, "sine", .05),
};
const fx = document.getElementById("fx"), ctx = fx.getContext("2d");
let parts = [], raf = 0;
function burst(x, y, n = 40, colors = ["#c8361f", "#c99a2e", "#2f7d4f", "#1d1a16", "#f0b429"]) {
  fx.width = innerWidth; fx.height = innerHeight;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 7;
    parts.push({x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 4, r: 3 + Math.random() * 4, c: colors[i % colors.length], life: 60 + Math.random() * 40, rot: Math.random() * 6});
  }
  if (!raf) raf = requestAnimationFrame(stepFx);
}
function stepFx() {
  ctx.clearRect(0, 0, fx.width, fx.height);
  parts = parts.filter(p => p.life-- > 0);
  for (const p of parts) {
    p.x += p.vx; p.y += p.vy; p.vy += .25; p.vx *= .99; p.rot += .2;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalAlpha = Math.min(1, p.life / 30);
    ctx.fillStyle = p.c; ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.restore();
  }
  raf = parts.length ? requestAnimationFrame(stepFx) : 0;
}
function burstAt(el, n) { const r = el.getBoundingClientRect(); burst(r.left + r.width / 2, r.top + r.height / 2, n); }
function floatText(t, el) {
  const r = el.getBoundingClientRect(), s = document.createElement("div");
  s.className = "float"; s.textContent = t; s.style.left = r.left + r.width / 2 - 20 + "px"; s.style.top = r.top - 10 + "px";
  document.body.appendChild(s); setTimeout(() => s.remove(), 1000);
}
function toast(i, t, sub = "") {
  const d = document.createElement("div");
  d.className = "toast"; d.innerHTML = `<span class="i">${i}</span><div><b>${esc(t)}</b><small>${esc(sub)}</small></div>`;
  toasts.appendChild(d);
  setTimeout(() => { d.classList.add("out"); setTimeout(() => d.remove(), 300); }, 3200);
}
function modal(html, onClose) {
  const m = document.createElement("div");
  m.className = "modal"; m.innerHTML = `<div class="panel pop">${html}<div class="next"><button class="btn red" id="mok">Pokračovať</button></div></div>`;
  document.body.appendChild(m);
  const prev = keyHandler;
  const close = () => { m.remove(); keyHandler = prev; onClose && onClose(); };
  m.querySelector("#mok").onclick = close;
  keyHandler = e => (e.key === " " || e.key === "Enter" || e.key === "Escape") && (e.preventDefault(), close());
}

// ---------- stroke drawing ----------
const canDraw = ch => typeof HanziWriter !== "undefined" && STROKES[ch];
const loader = (ch, onLoad) => onLoad(STROKES[ch]);
function writer(el, ch, o = {}) {
  const size = el.clientWidth || 280;
  return HanziWriter.create(el, ch, Object.assign({width: size, height: size, padding: 10, charDataLoader: loader,
    strokeColor: "#1d1a16", radicalColor: "#c8361f", outlineColor: "#e3dacb", drawingColor: "#c8361f", highlightColor: "#c99a2e",
    drawingWidth: 22, strokeAnimationSpeed: 1.3, delayBetweenStrokes: 180, showHintAfterMisses: 2}, o));
}

// ---------- utils ----------
const $ = h => { app.innerHTML = h; window.scrollTo(0, 0); };
const esc = s => String(s).replace(/[&<>"]/g, m => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[m]));
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = a => a[Math.random() * a.length | 0];
let audio;
const noListen = () => Date.now() < S.noListenUntil;
const fmtDur = secs => { const m = Math.floor(secs / 60), h = Math.floor(m / 60); return (h ? h + " h " : "") + m % 60 + " min"; };
const timeLine = () => `⏱️ Spolu ${fmtDur((SCHOOL_H + PAST_APP_H) * 3600 + S.studySecs)} · ${SCHOOL_H} h v škole · ${PAST_APP_H} h v appke predtým (odhad) · ${fmtDur(S.studySecs)} odvtedy`;
const hhmm = t => new Date(t).toLocaleTimeString("sk", {hour: "2-digit", minute: "2-digit"});
function setNoListen(on) {
  S.noListenUntil = on ? Date.now() + 3600e3 : 0; save();
  toast(on ? "🙉" : "🎧", on ? "Bez počúvania do " + hhmm(S.noListenUntil) : "Počúvanie zapnuté", on ? "Žiadne otázky na počúvanie a zvuk sa neprehrá sám" : "");
}
function play(file, delay = 0, force = false, rate = 1) {
  if (!force && noListen()) return;
  setTimeout(() => { try { audio && audio.pause(); audio = new Audio("audio/" + file); audio.playbackRate = rate; audio.play().catch(() => {}); } catch {} }, delay);
}
const examples = c => words.filter(w => w.zh.includes(c)).sort((a, b) => a.zh.length - b.zh.length).slice(0, 4);
let keyHandler = null;
document.addEventListener("keydown", e => keyHandler && keyHandler(e));
const wordList = ws => `<div class="ex">${ws.map(w => `<button data-a="${w.a}"><span class="zh">${esc(w.zh)}</span><span class="p">${esc(w.py)}</span><span class="e">${esc(w.en)}</span></button>`).join("")}</div>`;
function wirePlays() {
  document.querySelectorAll("[data-a]").forEach(b => b.onclick = () => play(b.dataset.a, 0, true, b.dataset.slow ? .65 : 1));
  document.querySelectorAll("[data-anim]").forEach(b => b.onclick = () => {
    const el = document.getElementById("anim");
    if (el.classList.contains("on")) return;
    el.classList.add("on"); writer(el, b.dataset.anim, {showCharacter: false}).loopCharacterAnimation();
  });
}

// ---------- home ----------
function home() {
  rollDay(); keyHandler = null;
  const kc = countKnownChars(), kw = countKnownWords();
  const d = due().length, nn = nextNew().length, ks = countKnownSents();
  const sLeft = sents.length - ks, sToday = sNewToday(), dt = daysToTrip();
  const finish = new Date(Date.now() + Math.ceil(sLeft / NEW_SENT_DAY) * DAY).toLocaleDateString("sk", {day: "numeric", month: "numeric"});
  const st = liveStreak(), lv = LV(S.xp);
  const left = Math.max(0, GOAL - S.done);
  const atRisk = st > 0 && S.last !== S.today;
  const cta = sLeft ? (d ? `▶ Začať: ${Math.min(d, 8)} opakovaní + ${Math.min(sLeft, NEW_SENT_ROUND)} nových viet` : `▶ Začať: ${Math.min(sLeft, NEW_SENT_ROUND)} nových viet`)
    : d ? `▶ Zopakovať ${Math.min(d, 20)}` : nn ? "Naučiť sa 5 nových znakov" : "Všetko hotové ✨";
  const tz = teaser();
  const nextL = chars.find(c => !charKnown(c.c))?.l;
  $(`
  <header>
    <div class="seal">汉</div>
    <div><h1>Znaky KSCX01</h1><div class="sub">${ks}/${sents.length} viet · ${kc}/${chars.length} znakov · ${kw}/${words.length} slov</div></div>
    <div class="stats">
      <span class="pill ${st ? "hot" : ""}" title="dni v rade">🔥 ${st}${S.freeze ? ` <span title="zmrazenie série">❄️${S.freeze}</span>` : ""}</span>
      <span class="pill xp">✦ ${S.xp}</span>
      <button class="pill ${noListen() ? "hot" : ""}" id="nlt" title="${noListen() ? "Bez počúvania – klikni pre zapnutie" : "Teraz nemôžem počúvať (na 1 hodinu)"}">${noListen() ? "🙉 do " + hhmm(S.noListenUntil) : "🎧"}</button>
      <button class="pill" id="mute" title="zvukové efekty">${S.mute ? "🔇" : "🔊"}</button>
    </div>
  </header>
  <div class="lvl"><b>Lv ${lv.l}</b> ${rank(lv.l)}<div class="bar"><i style="width:${lv.x / lv.need * 100}%"></i></div>${lv.x}/${lv.need} XP</div>
  ${S.chest !== S.today ? `<button class="chest" id="chest"><span class="ic">🎁</span><div><b>Denná truhlica</b><br><small>Otvor si dnešnú odmenu</small></div></button>` : ""}
  <div class="panel hero">
    <div class="txt">
      <h2>${S.done >= GOAL ? "Dnešný cieľ splnený 🎉" : "Dnes: " + S.done + " / " + GOAL}</h2>
      <p class="${atRisk ? "warn" : ""}">${atRisk ? `🔥 Ešte ${left} odpovedí a zachrániš ${st}-dňovú sériu!` : S.done >= GOAL ? "Séria pokračuje. Ďalšie kolo = viac XP." : `${d} na zopakovanie · zajtra ${Object.values(S.srs).filter(x => x.due > Date.now() && x.due < Date.now() + DAY).length} · dnes nových viet ${sToday}/${NEW_SENT_DAY}`}</p>
      <div class="bar"><i style="width:${Math.min(100, S.done / GOAL * 100)}%"></i></div>
    </div>
    <button class="btn red" id="go" ${!d && !nn && !sLeft ? "disabled" : ""}>${cta}</button>
  </div>
  <p class="trip">🇨🇳 Do Číny ${dt} dní${sLeft ? ` · pri ${NEW_SENT_DAY} nových vetách denne máš všetky do ${finish}` : " · všetky vety máš za sebou"}</p>
  <p class="trip" id="timeTotal">${timeLine()}</p>
  ${tz ? `<button class="tease" id="tease"><span class="zh">${tz.c.c}</span><div><b>Nauč sa ${tz.c.c} a odomkneš ${tz.ws.length} ${tz.ws.length === 1 ? "slovo" : tz.ws.length < 5 ? "slová" : "slov"}</b><br><small>${tz.ws.slice(0, 4).map(w => esc(w.zh)).join(" · ")}</small></div></button>` : ""}

  <h3>Vety</h3>
  <div class="sgroups">${sGroups.map(g => {
    const all = sents.filter(s => s.g === g.id), k = all.filter(s => known("s:" + s.id)).length;
    return `<button class="sgroup ${k === all.length ? "done" : ""}" data-g="${g.id}">${S.crowns["s:" + g.id] ? `<span class="crown">👑</span>` : ""}<span class="gi">${g.i}</span><div class="gt"><b>${esc(g.t)}</b><small>${k}/${all.length} viet</small><div class="bar"><i style="width:${k / all.length * 100}%"></i></div></div></button>`;
  }).join("")}</div>

  <h3>Hry</h3>
  <div class="modes">
    <button class="mode" id="m-build"><b>🧩 Skladanie viet</b><span>Slovensky zadanie, ty poskladáš čínsku vetu</span></button>
    <button class="mode" id="m-shadow"><b>🎙️ Tieňovanie</b><span>Vety idú samy, ty opakuješ nahlas</span></button>
    <button class="mode" id="m-speed"><b>⚡ 60 sekúnd</b><span>Správne +1 s, chyba −3 s. Rekord: ${S.best}</span></button>
    <button class="mode" id="m-words"><b>📇 Slová z Anki</b><span>${kw ? `Kvíz z ${kw} odomknutých slov` : "Kvíz zo všetkých slov"}</span></button>
    <button class="mode" id="m-ear"><b>👂 Počúvanie</b><span>${noListen() ? "🙉 Vypnuté do " + hhmm(S.noListenUntil) : "Počuješ slovo, vyber znaky"}</span></button>
    <button class="mode" id="m-blind"><b>🫥 Naslepo</b><span>Prázdne plátno, žiadny obrys – len ty a štetec</span></button>
    <button class="mode" id="m-draw"><b>✍️ Písanie</b><span>Nakresli znak prstom alebo myšou · ${S.drawn} nakreslených</span></button>
    <button class="mode" id="m-col"><b>🀄 Zbierka</b><span>${chars.filter(c => tier("c:" + c.c) === 4).length} zlatých · ${Object.keys(S.ach).length}/${ACH.length} odznakov</span></button>
  </div>

  <h3>Znaky podľa lekcií</h3>
  <div class="lessons">${lessons.map((t, i) => {
    const cs = chars.filter(c => c.l === i), k = cs.filter(c => charKnown(c.c)).length;
    return `<button class="lesson ${k === cs.length ? "done" : ""} ${i === nextL ? "cur" : ""}" data-l="${i}">
      ${S.crowns[i] ? `<span class="crown">👑</span>` : ""}
      <div class="n">Lekcia ${i + 1} · ${k}/${cs.length}</div><div class="t">${esc(t)}</div>
      <div class="pv">${cs.slice(0, 8).map(c => c.c).join("")}</div>
      <div class="bar"><i style="width:${k / cs.length * 100}%"></i></div></button>`;
  }).join("")}</div>
  <p class="hint" style="margin-top:30px"><button id="export" style="text-decoration:underline;color:var(--muted)">📤 exportovať postup a log</button> · <button id="reset" style="text-decoration:underline;color:var(--muted)">vymazať postup</button></p>`);
  go.onclick = smartSession;
  mute.onclick = () => { S.mute = !S.mute; save(); home(); };
  nlt.onclick = () => { setNoListen(!noListen()); home(); };
  if (window.chest && S.chest !== S.today) chest.onclick = openChest;
  if (tz) tease.onclick = () => learnFlow([tz.c]);
  document.querySelectorAll(".lesson").forEach(b => b.onclick = () => lessonView(+b.dataset.l));
  document.querySelectorAll(".sgroup").forEach(b => b.onclick = () => groupView(b.dataset.g));
  const spool = () => { const k = sents.filter(s => known("s:" + s.id) && s.t.length > 2); return k.length >= 5 ? k : nextSents(10).filter(s => s.t.length > 2); };
  document.getElementById("m-build").onclick = () => quiz(shuffle(spool()).slice(0, 12).map(s => ({k: "s:" + s.id, type: "s-build"})), {free: true});
  document.getElementById("m-shadow").onclick = () => shadow(shuffle(sents.filter(s => known("s:" + s.id))).slice(0, 30));
  document.getElementById("m-speed").onclick = speed;
  const wpool = () => { const k = words.filter(w => known("w:" + w.id)); return k.length >= 6 ? k : words; };
  document.getElementById("m-words").onclick = () => quiz(shuffle(wpool()).slice(0, 15).map(w => ({k: "w:" + w.id, type: pick(["w-en2zh", "w-zh2en"])})), {free: true});
  document.getElementById("m-ear").onclick = () => quiz(shuffle(wpool()).slice(0, 12).map(w => ({k: "w:" + w.id, type: "w-ear"})), {free: true});
  document.getElementById("m-col").onclick = collection;
  const drawMode = blind => { const k = chars.filter(c => charKnown(c.c)); quiz(shuffle(k.length >= 5 ? k : chars.filter(c => c.l === 0)).slice(0, 10).map(c => ({k: "c:" + c.c, type: "draw", blind})), {free: !k.length}); };
  document.getElementById("m-draw").onclick = () => drawMode(false);
  document.getElementById("m-blind").onclick = () => drawMode(true);
  document.getElementById("export").onclick = exportProgress;
  reset.onclick = () => { if (confirm("Naozaj vymazať celý postup?")) { clearInterval(studyTimer); localStorage.removeItem("hanzi-kscx01"); localStorage.removeItem(LOG_KEY); location.reload(); } };
  keyHandler = e => { if (e.key === "Enter" && !go.disabled) go.click(); };
  checkAch();
}

function openChest() {
  const r = Math.random();
  const xp = r < .05 ? 250 : r < .2 ? 100 : r < .55 ? 50 : 25;
  const freeze = r > .97 && S.freeze < 2;
  S.chest = S.today; if (freeze) S.freeze++; save();
  sfx.coin(); burst(innerWidth / 2, innerHeight / 2, xp >= 100 ? 140 : 60);
  modal(`<div class="huge">${xp >= 250 ? "💎" : xp >= 100 ? "💰" : "🪙"}</div><h2>+${xp} XP</h2><p>${xp >= 250 ? "JACKPOT! 🎰" : xp >= 100 ? "Super úlovok!" : "Zajtra je tu ďalšia."}${freeze ? "<br>❄️ Bonus: zmrazenie série!" : ""}</p>`, () => { gainXP(xp); home(); });
}

// ---------- collection ----------
function collection() {
  keyHandler = e => e.key === "Escape" && home();
  const cnt = [0, 0, 0, 0, 0]; chars.forEach(c => cnt[tier("c:" + c.c)]++);
  $(`<div class="top"><button class="x" id="back">←</button><b>Zbierka</b></div>
  <div class="legend">
    <span><i style="border-color:var(--line)"></i>neznáme ${cnt[0]}</span>
    <span><i style="border-color:var(--line);background:var(--card)"></i>nové ${cnt[1]}</span>
    <span><i style="border-color:var(--bronze)"></i>bronz ${cnt[2]}</span>
    <span><i style="border-color:var(--silver)"></i>striebro ${cnt[3]}</span>
    <span><i style="border-color:var(--gold);background:var(--gold-soft)"></i>zlato ${cnt[4]}</span>
  </div>
  <div class="grid">${chars.map(c => { const t = tier("c:" + c.c); return `<button class="cell ${t ? "t" + t : "lock"}" data-c="${c.c}"><span class="zh">${c.c}</span><small>${t ? esc(c.py) : "?"}</small></button>`; }).join("")}</div>
  <h3>Odznaky ${Object.keys(S.ach).length}/${ACH.length}</h3>
  <div class="achs">${ACH.map(([id, i, t, d]) => `<div class="ach ${S.ach[id] ? "" : "off"}"><span class="i">${i}</span><div><b>${t}</b><small>${d}</small></div></div>`).join("")}</div>`);
  back.onclick = home;
  document.querySelectorAll(".cell").forEach(b => b.onclick = () => detail(C[b.dataset.c], collection));
}

// ---------- lesson browser ----------
function lessonView(l) {
  const cs = chars.filter(c => c.l === l), nn = cs.filter(c => !charKnown(c.c));
  keyHandler = e => e.key === "Escape" && home();
  $(`<div class="top"><button class="x" id="back">←</button><b>Lekcia ${l + 1}: ${esc(lessons[l])} ${S.crowns[l] ? "👑" : ""}</b></div>
  <div class="grid">${cs.map(c => { const t = tier("c:" + c.c); return `<button class="cell ${t ? "t" + t : ""}" data-c="${c.c}"><span class="zh">${c.c}</span><small>${esc(c.py)}</small></button>`; }).join("")}</div>
  <div class="next row" style="margin-top:24px">
    ${nn.length ? `<button class="btn red" id="learn">Naučiť sa ${Math.min(nn.length, NEW_PER_SESSION)} nových</button>` : ""}
    <button class="btn ghost" id="drill">Precvičiť lekciu</button>
    <button class="btn ghost" id="lreset" ${cs.some(c => charKnown(c.c)) ? "" : "disabled"}>↺ Resetovať lekciu</button>
    <button class="btn gold" id="boss" ${nn.length ? "disabled" : ""}>👑 Majstrovská skúška</button>
  </div>
  <p class="hint">${nn.length ? `Skúška sa odomkne, keď sa naučíš všetky znaky (ešte ${nn.length}).` : S.crowns[l] ? "Korunku už máš. Skús to znova bez chyby!" : "3 životy. Prejdi všetky znaky lekcie a získaj korunku."}</p>`);
  back.onclick = home;
  document.querySelectorAll(".cell").forEach(b => b.onclick = () => detail(C[b.dataset.c], () => lessonView(l)));
  if (nn.length) learn.onclick = () => learnFlow(nn.slice(0, NEW_PER_SESSION));
  lreset.onclick = () => {
    if (!confirm(`Resetovať lekciu ${l + 1}? Znaky aj slová z nich budú znova nenaučené.`)) return;
    cs.forEach(c => delete S.srs["c:" + c.c]);
    words.forEach(w => { if (!wordUnlocked(w)) delete S.srs["w:" + w.id]; });
    delete S.crowns[l]; save(); lessonView(l);
  };
  drill.onclick = () => quiz(shuffle(cs).slice(0, 15).map(c => ({k: "c:" + c.c, type: charType()})), {free: true});
  boss.onclick = () => quiz(shuffle(cs).map(c => ({k: "c:" + c.c, type: pick(["c2m", "m2c", "c2py", "ear"])})), {boss: l, hearts: 3});
}

function charCard(c) {
  const t = tier("c:" + c.c);
  return `<div class="big pop">${c.c}</div>
  <div class="center"><button class="play" data-a="${c.a}">🔊 prehrať</button> ${canDraw(c.c) ? `<button class="play" data-anim="${c.c}">✍️ poradie ťahov</button>` : ""} ${t ? `<span class="pill">${["", "nové", "🥉 bronz", "🥈 striebro", "🥇 zlato"][t]}</span>` : ""}</div>
  <div class="anim" id="anim"></div>
  <div class="py" style="margin-top:10px">${esc(c.py)}</div>
  <div class="mean">${esc(c.m)}</div>
  <dl class="kv">
    <dt>Skladá sa z</dt><dd class="zh">${esc(c.p)}</dd>
    <dt>Pomôcka</dt><dd>${esc(c.n)}</dd>
  </dl>
  ${examples(c.c).length ? wordList(examples(c.c)) : ""}
  ${charSents(c.c).length ? `<div class="ex">${charSents(c.c).map(s => `<button data-a="${s.a}"><span class="l"><span class="zh">${esc(s.zh)}</span><span class="p">${esc(s.py)}</span></span><span class="e">${esc(s.sk)}${trEn(s)}</span></button>`).join("")}</div>` : ""}`;
}
const charSents = c => sents.filter(s => s.zh.includes(c)).sort((a, b) => a.zh.length - b.zh.length).slice(0, 3);
function detail(c, back) {
  keyHandler = e => { if (e.key === "Escape") back(); if (e.key === "p") play(c.a, 0, true); };
  $(`<div class="top"><button class="x" id="bk">←</button></div><div class="panel">${charCard(c)}</div>`);
  bk.onclick = back; wirePlays(); play(c.a);
}

// ---------- learn new ----------
function learnFlow(list) {
  let i = 0;
  const show = () => {
    const c = list[i];
    $(`<div class="top"><button class="x" id="q">×</button><div class="bar"><i style="width:${i / list.length * 100}%"></i></div><span class="pill">nový ${i + 1}/${list.length}</span></div>
    <p class="hint">Zdroj: ${esc(lessons[c.l])}</p>
    <div class="panel">${charCard(c)}</div>
    <div class="next"><button class="btn red" id="nx">${i + 1 < list.length ? "Ďalší znak →" : "Otestuj ma →"}</button></div>
    <p class="hint">medzerník = ďalej · P = prehrať</p>`);
    wirePlays(); play(c.a);
    q.onclick = home;
    nx.onclick = () => { sfx.tick(); if (++i < list.length) show(); else finishLearn(); };
    keyHandler = e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); nx.click(); } if (e.key === "p") play(c.a, 0, true); if (e.key === "Escape") home(); };
  };
  const finishLearn = () => {
    // nothing is saved as learned until the test is finished
    const items = list.map(c => ({k: "c:" + c.c, type: "c2m"}));
    for (const c of shuffle(list)) items.push({k: "c:" + c.c, type: pick(["m2c", "c2py", "ear", "draw", "draw"])});
    const fresh = new Set(list.map(c => c.c));
    const ws = words.filter(w => !known("w:" + w.id) && hanzi(w.zh).every(ch => charKnown(ch) || fresh.has(ch)));
    for (const w of ws.slice(0, 5)) items.push({k: "w:" + w.id, type: "w-zh2en"});
    quiz(items, {defer: items.map(x => x.k)});
  };
  show();
}
const itemFor = k => ({k, type: k[0] === "c" ? charType() : k[0] === "s" ? sentType(k) : pick(["w-en2zh", "w-zh2en", "w-ear"])});
function smartSession() {
  const ns = nextSents(NEW_SENT_ROUND);
  const d = due().slice(0, ns.length ? 8 : 20);
  const items = shuffle(d).map(itemFor);
  if (ns.length) return items.length ? quiz(items, {then: () => learnSents(ns)}) : learnSents(ns);
  const nn = nextNew();
  if (d.length < 10 && nn.length) {
    if (!items.length) return learnFlow(nn.slice(0, NEW_PER_SESSION));
    return quiz(items, {then: () => learnFlow(nn.slice(0, NEW_PER_SESSION))});
  }
  if (items.length) quiz(items);
}

// ---------- sentences: learn, browse, shadow ----------
const sSource = s => { const g = sGroups.find(x => x.id === s.g); return `${g.i} ${esc(g.t)}${s.p ? ` · učebnica ${esc(s.p)}` : ""}`; };
const trEn = s => `<span class="en">${esc(s.en)}</span>`;
const tokRow = (s, kn) => `<div class="toks">${s.t.map(t => `<span class="tok ${kn && !kn.has(t) ? "new" : ""}"><b class="zh">${esc(t)}</b><i>${esc(lex[t][0])}</i><small>${esc(lex[t][1])}</small><small class="en">${esc(lex[t][2])}</small></span>`).join("")}</div>`;
const sPlays = s => `<button class="play" data-a="${s.a}">🔊 prehrať</button> <button class="play" data-a="${s.a}" data-slow="1">🐢 pomaly</button>`;
function learnSents(list, back = home) {
  let i = 0;
  const kn = knownTokens();
  const show = () => {
    const s = list[i], fresh = newTokens(s, kn);
    $(`<div class="top"><button class="x" id="q">×</button><div class="bar"><i style="width:${i / list.length * 100}%"></i></div><span class="pill">nová veta ${i + 1}/${list.length}</span></div>
    <p class="hint">Zdroj: ${sSource(s)}</p>
    <div class="panel pop">
      <div class="szh zh">${esc(s.zh)}</div>
      <div class="py spy">${esc(s.py)}</div>
      <div class="mean">${esc(s.sk)}${trEn(s)}</div>
      <div class="center">${sPlays(s)}</div>
      ${tokRow(s, kn)}
      <p class="hint">${fresh.length ? `🆕 Nové slová: ${fresh.map(esc).join(" · ")} · ` : ""}Povedz to nahlas aspoň dvakrát.</p>
    </div>
    <div class="next"><button class="btn red" id="nx">${i + 1 < list.length ? "Ďalšia veta →" : "Otestuj ma →"}</button></div>
    <p class="hint">medzerník = ďalej · P = prehrať · S = pomaly</p>`);
    wirePlays(); play(s.a);
    q.onclick = back;
    nx.onclick = () => { sfx.tick(); s.t.forEach(t => kn.add(t)); if (++i < list.length) show(); else test(); };
    keyHandler = e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); nx.click(); } if (e.key === "p") play(s.a, 0, true); if (e.key === "s") play(s.a, 0, true, .65); if (e.key === "Escape") back(); };
  };
  const test = () => {
    const first = shuffle(list).map(s => ({k: "s:" + s.id, type: pick(["s-read", "s-ear"])}));
    const second = shuffle(list).map(s => ({k: "s:" + s.id, type: s.t.length > 2 ? "s-build" : s.t.length > 1 ? "s-cloze" : "s-speak"}));
    const items = [...first, ...second];
    quiz(items, {defer: items.map(x => x.k), onCommit: n => { if (S.sDay !== dayStr()) { S.sDay = dayStr(); S.sNew = 0; } S.sNew = (S.sNew || 0) + n; save(); }});
  };
  show();
}
function groupView(g) {
  const grp = sGroups.find(x => x.id === g), all = sents.filter(s => s.g === g), kn = all.filter(s => known("s:" + s.id));
  keyHandler = e => e.key === "Escape" && home();
  const left = all.length - kn.length, crownKey = "s:" + g;
  $(`<div class="top"><button class="x" id="back">←</button><b>${grp.i} ${esc(grp.t)} ${S.crowns[crownKey] ? "👑" : ""}</b><span class="pill" style="margin-left:auto">${kn.length}/${all.length}</span></div>
  <div class="next row" style="margin:0 0 16px">
    ${left ? `<button class="btn red" id="learn">Naučiť sa ${Math.min(left, NEW_SENT_ROUND)} nových</button>` : ""}
    <button class="btn ghost" id="drill" ${kn.length ? "" : "disabled"}>Precvičiť</button>
    <button class="btn ghost" id="shad" ${kn.length ? "" : "disabled"}>🎙️ Tieňovanie</button>
    <button class="btn gold" id="exam" ${kn.length >= 5 ? "" : "disabled"}>📝 Skúška</button>
  </div>
  <p class="hint" style="margin-bottom:12px">${kn.length >= 5 ? `Skúška: 3 životy, ${Math.min(kn.length, 20)} viet z tých, čo už vieš.${left ? " Korunka až za celú sadu." : ""}` : "Skúška sa odomkne po 5 naučených vetách."}</p>
  <div class="ex slist">${all.map(s => `<button data-a="${s.a}" class="${known("s:" + s.id) ? "kn" : ""}"><span class="st">${known("s:" + s.id) ? "✓" : "○"}</span><span class="zh">${esc(s.zh)}</span><span class="m"><span class="p">${esc(s.py)}</span><span class="e">${esc(s.sk)}${s.p ? " · " + esc(s.p) : ""}${trEn(s)}</span></span></button>`).join("")}</div>`);
  wirePlays();
  back.onclick = home;
  if (left) learn.onclick = () => learnSents(nextSents(NEW_SENT_ROUND, g), () => groupView(g));
  drill.onclick = () => quiz(shuffle(kn).slice(0, 15).map(s => ({k: "s:" + s.id, type: sentType("s:" + s.id)})), {free: true});
  shad.onclick = () => shadow(shuffle(kn).slice(0, 30), () => groupView(g));
  const startExam = () => quiz(shuffle(kn).slice(0, 20).map(s => ({k: "s:" + s.id, type: s.t.length > 2 ? pick(["s-build", "s-build", "s-ear", "s-speak"]) : pick(["s-read", "s-ear", "s-speak"])})),
    {boss: crownKey, hearts: 3, bossTitle: grp.t, retry: startExam, noCrown: !!left});
  exam.onclick = startExam;
}
function shadow(list, back = home) {
  if (!list.length) return toast("🎙️", "Najprv sa nauč pár viet", "Tieňovanie ide z viet, ktoré už poznáš");
  if (noListen()) setNoListen(false);
  let i = 0, run = true, timer;
  const stop = () => { run = false; clearTimeout(timer); audio && audio.pause(); back(); };
  const say = (s, then) => {
    audio && audio.pause();
    audio = new Audio("audio/" + s.a);
    let fired = false;
    const go = () => { if (fired || !run) return; fired = true; then((audio.duration || 2) * 1000); };
    audio.onended = go; audio.onerror = go;
    audio.play().catch(go);
  };
  const show = () => {
    if (!run) return;
    if (i >= list.length) { run = false; toast("🎙️", "Hotovo!", list.length + " viet nahlas"); gainXP(list.length * 2); return back(); }
    const s = list[i];
    $(`<div class="top"><button class="x" id="q">×</button><div class="bar"><i style="width:${i / list.length * 100}%"></i></div><span class="pill">${i + 1}/${list.length}</span></div>
    <div class="panel pop"><div class="szh zh">${esc(s.zh)}</div><div class="py spy">${esc(s.py)}</div><div class="mean">${esc(s.sk)}${trEn(s)}</div>
    <p class="hint" id="sh">🔊 Počúvaj…</p></div>
    <div class="next"><button class="btn ghost" id="nx">Preskočiť →</button></div>`);
    q.onclick = stop;
    nx.onclick = () => { clearTimeout(timer); i++; show(); };
    keyHandler = e => { if (e.key === "Escape") stop(); if (e.key === " " || e.key === "Enter") { e.preventDefault(); nx.click(); } };
    const turn = (ms, then) => { const el = document.getElementById("sh"); if (el) el.textContent = "🗣️ Teraz ty – nahlas!"; timer = setTimeout(then, ms + 700); };
    const listen = then => { const el = document.getElementById("sh"); if (el) el.textContent = "🔊 Počúvaj…"; say(s, ms => turn(ms, then)); };
    listen(() => listen(() => { i++; show(); }));
  };
  show();
}
const charType = () => pick(["c2m", "c2m", "m2c", "c2py", "ear", "draw"]);

// ---------- quiz engine ----------
function distractors(item, n = 3) {
  const id = item.k.slice(2);
  if (item.k[0] === "c") {
    const c = C[id], pool = shuffle(chars.filter(x => x.c !== c.c)), same = pool.filter(x => x.l === c.l);
    const field = item.type === "c2py" ? "py" : item.type === "c2m" ? "m" : "c";
    const seen = new Set([c[field]]), out = [];
    for (const x of [...same.slice(0, 2), ...pool]) { if (out.length >= n) break; if (!seen.has(x[field])) { seen.add(x[field]); out.push(x); } }
    return out;
  }
  const w = W[id], pool = shuffle(words.filter(x => x.id !== w.id));
  const close = pool.filter(x => Math.abs(hanzi(x.zh).length - hanzi(w.zh).length) <= 1 && [...x.zh].some(ch => C[ch] && w.zh.includes(ch)));
  const seen = new Set([w.zh, w.en]), out = [];
  for (const x of [...close.slice(0, 2), ...pool]) { if (out.length >= n) break; if (!seen.has(x.zh) && !seen.has(x.en)) { seen.add(x.zh); seen.add(x.en); out.push(x); } }
  return out;
}
const bigPlay = q => `<div class="center" style="margin:40px 0 10px"><button class="play" id="rep" style="font-size:22px;padding:14px 26px">🔊 ešte raz</button></div><p class="hint">${q}</p>
  <p class="center"><button class="play" id="nolisten">🙉 Teraz nemôžem počúvať</button></p>`;
const sFb = s => `<span class="zh">${esc(s.zh)}</span><br><b style="color:var(--red)">${esc(s.py)}</b><br>${esc(s.sk)}${trEn(s)}<br><span class="fbp">${sPlays(s)}</span><br><small>${s.t.map(t => `${esc(t)} ${esc(lex[t][1])} / ${esc(lex[t][2])}`).join(" · ")}</small>`;
function sentDistractors(s, n = 3) {
  const pool = shuffle(sents.filter(x => x.id !== s.id && x.sk !== s.sk));
  const near = pool.filter(x => Math.abs(x.t.length - s.t.length) <= 2);
  const seen = new Set([s.sk]), out = [];
  for (const x of [...near.filter(y => y.g === s.g).slice(0, 2), ...near, ...pool]) { if (out.length >= n) break; if (!seen.has(x.sk)) { seen.add(x.sk); out.push(x); } }
  return out;
}
function renderSent(item) {
  const s = ST[item.k.slice(2)];
  if (noListen() && item.type === "s-ear") item.type = "s-read";
  if (noListen() && item.type === "s-build-ear") item.type = "s-build";
  const t = item.type, base = {audio: s.a, fb: sFb(s), s: true};
  if (t === "s-read" || t === "s-ear") {
    const opts = shuffle([s, ...sentDistractors(s)]);
    return {...base, autoplay: t === "s-ear",
      q: t === "s-ear" ? bigPlay("Čo tá veta znamená?") : `<div class="szh zh">${esc(s.zh)}</div><p class="hint">Čo to znamená?</p>`,
      opts: opts.map(x => ({html: esc(x.sk), ok: x === s, small: true}))};
  }
  if (t === "s-cloze") {
    const idx = Math.random() * s.t.length | 0, tok = s.t[idx];
    const others = shuffle(Object.keys(lex).filter(x => !s.t.includes(x) && [...x].length === [...tok].length && x !== "Wi-Fi")).slice(0, 3);
    let pos = 0, seen = 0;
    for (let j = 0; j < idx; j++) if (s.t[j] === tok) seen++;
    for (let j = 0; j <= seen; j++) pos = s.zh.indexOf(tok, j ? pos + tok.length : 0);
    const shown = esc(s.zh.slice(0, pos)) + `<span class="blank">${"＿".repeat([...tok].length)}</span>` + esc(s.zh.slice(pos + tok.length));
    return {...base, q: `<div class="prompt ssk">${esc(s.sk)}${trEn(s)}</div><div class="szh zh">${shown}</div><p class="hint">Doplň slovo</p>`,
      opts: shuffle([tok, ...others]).map(x => ({html: esc(x), ok: x === tok, zh: true}))};
  }
  if (t === "s-build" || t === "s-build-ear") {
    const box = S.srs[item.k]?.box || 0;
    const extra = box >= 3 ? shuffle(Object.keys(lex).filter(x => !s.t.includes(x) && x !== "Wi-Fi")).slice(0, 2) : [];
    const ear = t === "s-build-ear";
    return {...base, opts: [], build: {tiles: shuffle([...s.t, ...extra]), need: s.t.length, ok: [s.t.join(""), s.alt].filter(Boolean)}, custom: true, autoplay: ear,
      q: `${ear ? `<div class="center" style="margin:18px 0 6px"><button class="play" id="rep" style="font-size:20px;padding:12px 22px">🔊 ešte raz</button></div><p class="hint">Poskladaj, čo počuješ</p>` : `<div class="prompt ssk">${esc(s.sk)}${trEn(s)}</div><p class="hint">Poskladaj vetu po čínsky</p>`}
        <div class="slots zh" id="slots"></div><div class="tiles" id="tiles"></div>
        <p class="center" style="margin:12px 0 0"><button class="btn" id="chk" disabled>Skontrolovať</button></p>`};
  }
  // s-speak: say it out loud, then reveal and rate yourself
  return {...base, opts: [], speak: true, custom: true,
    q: `<div class="prompt ssk">${esc(s.sk)}${trEn(s)}</div><p class="hint">🗣️ Povedz to nahlas po čínsky</p>
      <p class="center"><button class="btn" id="reveal">Ukáž odpoveď</button></p>`};
}
function render(item) {
  if (item.k[0] === "s") return renderSent(item);
  if (noListen() && item.type === "ear") item.type = pick(["c2m", "m2c"]);
  if (noListen() && item.type === "w-ear") item.type = pick(["w-zh2en", "w-en2zh"]);
  const id = item.k.slice(2), t = item.type;
  if (item.k[0] === "c") {
    const c = C[id];
    if (t === "draw" && canDraw(c.c)) return {draw: c, opts: [], audio: c.a, autoplay: true,
      q: `<div class="prompt" style="margin:6px 0 2px">${esc(c.m)}</div><div class="py">${esc(c.py)}</div>
        <div class="draw" id="draw"></div>
        <div class="tools"><button class="play" id="rep">🔊</button><button class="play" id="dhint">💡 nápoveda</button><button class="play" id="dshow">👀 neviem, ukáž</button></div>
        <p class="hint">${item.blind ? "Naslepo – bez obrysu" : "Nakresli znak ťah po ťahu" + ((S.srs["c:" + c.c]?.box || 0) < 2 ? " – zatiaľ môžeš obkresľovať" : "")}</p>`,
      fb: `<span class="zh">${c.c}</span> <b style="color:var(--red)">${esc(c.py)}</b> — ${esc(c.m)}<br><small>${esc(c.p)} · ${esc(c.n)}</small>`};
    if (t === "draw") item.type = "m2c";
    const opts = shuffle([c, ...distractors(item)]);
    const label = x => t === "c2m" ? esc(x.m) : t === "c2py" ? esc(x.py) : x.c;
    const q = t === "c2m" ? `<div class="big">${c.c}</div><p class="hint">Čo to znamená?</p>`
      : t === "c2py" ? `<div class="big">${c.c}</div><p class="hint">Ako sa to číta?</p>`
      : t === "m2c" ? `<div class="prompt">${esc(c.m)}</div><p class="hint">Ktorý znak?</p>`
      : bigPlay("Ktorý znak počuješ?");
    return {q, opts: opts.map(x => ({html: label(x), ok: x === c, zh: !["c2m", "c2py"].includes(t)})), audio: c.a, autoplay: t === "ear",
      fb: `<span class="zh">${c.c}</span> <b style="color:var(--red)">${esc(c.py)}</b> — ${esc(c.m)}<br><small>${esc(c.p)} · ${esc(c.n)}</small>`};
  }
  const w = W[id], opts = shuffle([w, ...distractors(item)]);
  const q = t === "w-en2zh" ? `<div class="prompt">${esc(w.en)}</div><p class="hint">Vyber po čínsky</p>`
    : t === "w-zh2en" ? `<div class="mid">${esc(w.zh)}</div><p class="hint">Čo to znamená?</p>`
    : bigPlay("Čo počuješ?");
  const zhOpt = t !== "w-zh2en";
  return {q, opts: opts.map(x => ({html: esc(zhOpt ? x.zh : x.en), ok: x === w, zh: zhOpt})), audio: w.a, autoplay: t === "w-ear",
    fb: `<span class="zh">${esc(w.zh)}</span> <b style="color:var(--red)">${esc(w.py)}</b> — ${esc(w.en)}<br><small>${hanzi(w.zh).map(ch => `${ch} ${esc(C[ch].m)}`).join(" · ")}</small>`};
}
const mult = combo => combo >= 20 ? 3 : combo >= 10 ? 2 : combo >= 5 ? 1.5 : 1;

function quiz(items, opt = {}) {
  let i = 0, right = 0, wrong = 0, xp = 0, combo = 0, hearts = opt.hearts || 0;
  let total = items.length;
  const retry = new Set(), graded = new Set();
  // learning quiz: collect results, persist only when the quiz is completed
  const defer = new Set(opt.defer || []), pend = {};
  const doGrade = (k, ok, step = 1) => {
    if (!defer.has(k)) return grade(k, ok, step);
    pend[k] = !ok || pend[k] === false ? false : step;
  };
  const commit = () => {
    const ks = Object.keys(pend);
    for (const k of ks) if (k[0] === "c") S.srs[k] = {box: 0, due: 0};
    opt.unlocked = unlockWords();
    for (const k of ks) { if (!S.srs[k]) S.srs[k] = {box: 0, due: 0}; grade(k, pend[k] !== false, pend[k] || 1); }
    if (opt.onCommit) opt.onCommit(ks.length);
    save();
  };
  const comboHtml = () => combo >= 3 ? `<span class="combo ${combo >= 10 ? "fire" : ""}">${combo >= 10 ? "🔥" : ""}×${combo}${mult(combo) > 1 ? ` · ${mult(combo)}× XP` : ""}</span>` : "";
  const show = () => {
    if (i >= items.length) return end();
    const item = items[i], r = render(item);
    window.__ok = r.opts.findIndex(o => o.ok);
    $(`<div class="top"><button class="x" id="q">×</button><div class="bar"><i style="width:${Math.min(i, total) / total * 100}%"></i></div>
      <span id="cb">${comboHtml()}</span>${opt.boss != null ? `<span class="hearts">${"❤️".repeat(hearts)}${"🤍".repeat(opt.hearts - hearts)}</span>` : ""}</div>
    <div class="panel pop" id="card">${r.q}
      <div class="opts">${r.opts.map((o, j) => `<button class="opt ${o.zh ? "zh" : ""} ${o.small ? "small" : ""}" data-j="${j}"><kbd>${j + 1}</kbd>${o.html}</button>`).join("")}</div>
      ${r.draw ? "" : `<p class="center" style="margin:12px 0 0"><button class="play" id="idk">🤷 Neviem <kbd style="font-size:11px;color:var(--muted)">0</kbd></button></p>`}
      <div class="fb" id="fb"></div>
    </div>
    <div class="next" id="nxw" style="visibility:hidden"><button class="btn" id="nx">Ďalej →</button></div>`);
    q.onclick = home;
    const rep = document.getElementById("rep"); if (rep) rep.onclick = () => play(r.audio, 0, true);
    const nl = document.getElementById("nolisten"); if (nl) nl.onclick = () => { setNoListen(true); show(); };
    if (r.autoplay) play(r.audio);
    let done = false;
    const answer = (j, drawOk) => {
      if (done) return; done = true;
      const custom = r.draw || r.custom, btns = document.querySelectorAll(".opt"), idk = j === -1, ok = idk ? false : custom ? drawOk : r.opts[j].ok;
      document.getElementById("idk")?.remove();
      const el = r.draw ? document.getElementById("draw") : r.build ? document.getElementById("slots") : r.speak ? document.getElementById("card") : btns[j];
      if (r.draw) { el.classList.add(ok ? "ok" : "bad"); S.drawn++; }
      if (r.build) { el.classList.add(ok ? "ok" : "bad"); document.getElementById("chk")?.remove(); document.getElementById("tiles").remove(); }
      if (r.speak) document.getElementById("reveal")?.parentElement.remove();
      btns.forEach((b, x) => { b.disabled = true; if (r.opts[x].ok) b.classList.add("ok"); });
      let rate = false;
      if (!opt.free || known(item.k)) if (!graded.has(item.k) || !ok) { graded.add(item.k); if (ok) rate = true; else doGrade(item.k, false); }
      answered(ok, item.k, item.type + (item.blind ? "-blind" : ""), idk);
      if (ok) {
        right++; combo++; S.maxCombo = Math.max(S.maxCombo, combo);
        const lucky = Math.random() < .08;
        const g = Math.round((r.draw ? 20 : 10) * mult(combo) * (lucky ? 2 : 1)); xp += g;
        gainXP(g, el); sfx.ok(combo); burstAt(el, r.draw ? 40 : combo >= 10 ? 30 : 14);
        if (lucky) toast("🍀", "Šťastie! 2× XP", "+" + g + " XP");
        if (combo > 0 && combo % 10 === 0) toast("🔥", combo + " v rade!", "Násobič " + mult(combo) + "× XP");
      } else {
        wrong++; combo = 0; if (!idk) { sfx.bad(); card.classList.add("shake"); } if (!custom && !idk) btns[j].classList.add("bad");
        if (opt.boss != null) hearts--;
        else if (!retry.has(item.k)) { retry.add(item.k); items.push({...item}); }
      }
      cb.innerHTML = comboHtml();
      fb.className = "fb show " + (r.speak && ok ? "" : ok ? "ok" : "bad"); fb.innerHTML = (r.speak && ok ? "" : ok ? "✓ " : idk ? "🤷 Správne je: " : "✗ ") + r.fb;
      if (r.s) wirePlays();
      play(r.audio, 180);
      checkAch();
      if (opt.boss != null && hearts <= 0) { setTimeout(fail, 1300); return; }
      if (rate) {
        const opts = [[-1, "😶", "Neviem"], [0, "🤏", "Skoro viem"], [1, "🙂", "Dobre viem"], [2, "😎", "Mega easy"]];
        nxw.innerHTML = `<div class="rate">${opts.map(([st, e, t], x) => `<button class="rbtn" data-st="${st}"><kbd>${x + 1}</kbd>${e} ${t}<small>${st < 0 ? "znova teraz" : fmtIval(ivalMs(item.k, st))}</small></button>`).join("")}</div>`;
        nxw.style.visibility = "visible";
        rateFn = st => { rateFn = null; doGrade(item.k, st >= 0, Math.max(st, 0));
          if (st < 0 && !retry.has(item.k)) { retry.add(item.k); items.push({...item}); } if (st === 2) { floatText("😎", nxw); for (let x = items.length - 1; x > i; x--) if (items[x].k === item.k) { items.splice(x, 1); total--; } } next(); };
        nxw.querySelectorAll(".rbtn").forEach(b => b.onclick = () => rateFn && rateFn(+b.dataset.st));
        return;
      }
      nxw.style.visibility = "visible";
      if (ok && !r.s) setTimeout(() => { if (items[i] === item && document.body.contains(nx)) next(); }, r.draw ? 1600 : 1000);
    };
    let rateFn = null;
    const next = () => { i++; show(); };
    document.querySelectorAll(".opt").forEach(b => b.onclick = () => answer(+b.dataset.j));
    const idkB = document.getElementById("idk"); if (idkB) idkB.onclick = () => answer(-1);
    if (r.speak) document.getElementById("reveal").onclick = () => answer(null, true);
    let buildKey = null;
    if (r.build) {
      const tilesEl = document.getElementById("tiles"), slotsEl = document.getElementById("slots"), chk = document.getElementById("chk");
      const placed = [];
      const draw = () => {
        slotsEl.innerHTML = placed.map((j, x) => `<button class="tile on" data-x="${x}">${esc(r.build.tiles[j])}</button>`).join("") || `<span class="hint">sem klikaj slová…</span>`;
        tilesEl.innerHTML = r.build.tiles.map((t, j) => `<button class="tile zh" data-j="${j}" ${placed.includes(j) ? "disabled" : ""}>${j < 9 ? `<kbd>${j + 1}</kbd>` : ""}${esc(t)}</button>`).join("");
        chk.disabled = placed.length !== r.build.need;
        slotsEl.querySelectorAll(".tile").forEach(b => b.onclick = () => { placed.splice(+b.dataset.x, 1); draw(); });
        tilesEl.querySelectorAll(".tile").forEach(b => b.onclick = () => { if (placed.length < r.build.need + 2) { placed.push(+b.dataset.j); draw(); } });
      };
      draw();
      const check = () => answer(null, r.build.ok.includes(placed.map(j => r.build.tiles[j]).join("")));
      chk.onclick = check;
      buildKey = e => {
        if (e.key >= "1" && e.key <= "9") { const j = +e.key - 1; if (j < r.build.tiles.length && !placed.includes(j)) { placed.push(j); draw(); } }
        else if (e.key === "Backspace") { placed.pop(); draw(); }
        else if (e.key === "Enter" && !chk.disabled) { e.preventDefault(); check(); }
      };
    }
    if (r.draw) {
      const box = S.srs[item.k]?.box || 0;
      const wr = writer(document.getElementById("draw"), r.draw.c, {showCharacter: false, showOutline: !item.blind && box < 2});
      let hinted = false;
      window.__wr = wr;
      wr.quiz({onComplete: s => {
        const n = STROKES[r.draw.c].strokes.length, good = !(hinted && (box >= 2 || item.blind)) && s.totalMistakes <= Math.max(1, Math.floor(n / 4));
        if (good && !hinted && s.totalMistakes === 0) S.drawPerfect++;
        answer(null, good);
      }});
      document.getElementById("dhint").onclick = () => { hinted = true; wr.showOutline(); };
      document.getElementById("dshow").onclick = () => { if (done) return; wr.cancelQuiz(); answer(null, false); wr.hideOutline(); wr.animateCharacter(); };
    }
    nx.onclick = next;
    keyHandler = e => {
      if (!done && buildKey && (e.key === "Backspace" || e.key === "Enter" || (e.key >= "1" && e.key <= "9"))) buildKey(e);
      else if (!done && r.speak && (e.key === " " || e.key === "Enter")) { e.preventDefault(); answer(null, true); }
      else if (rateFn && e.key >= "1" && e.key <= "4") rateFn(+e.key - 2);
      else if (rateFn && (e.key === " " || e.key === "Enter")) { e.preventDefault(); rateFn(1); }
      else if (!done && r.opts.length && e.key >= "1" && e.key <= "4") answer(+e.key - 1);
      else if (!done && !r.draw && e.key === "0") answer(-1);
      else if (done && (e.key === " " || e.key === "Enter")) { e.preventDefault(); if (nxw.style.visibility === "visible") next(); }
      else if (e.key === "p") play(r.audio, 0, true);
      else if (e.key === "s" && r.s) play(r.audio, 0, true, .65);
      else if (e.key === "Escape") home();
    };
  };
  const fail = () => {
    keyHandler = e => (e.key === " " || e.key === "Enter") && boss();
    $(`<div class="panel end pop"><div class="huge" style="font-size:64px">💔</div><div class="score">${right}/${total}</div>
      <p>Došli životy. Korunka bola blízko!</p>
      <div class="next row"><button class="btn gold" id="again">Skúsiť znova</button><button class="btn ghost" id="hm">Domov</button></div></div>`);
    const boss = () => opt.retry ? opt.retry() : quiz(shuffle(chars.filter(c => c.l === opt.boss)).map(c => ({k: "c:" + c.c, type: pick(["c2m", "m2c", "c2py", "ear"])})), {boss: opt.boss, hearts: opt.hearts});
    again.onclick = boss; hm.onclick = home;
  };
  const end = () => {
    if (defer.size) commit();
    const perfect = wrong === 0 && total >= 5;
    if (perfect) { S.perfects++; save(); }
    let crown = false;
    if (opt.boss != null) { if (!opt.noCrown) { crown = !S.crowns[opt.boss]; S.crowns[opt.boss] = S.crowns[opt.boss] || dayStr(); } gainXP(50); xp += 50; save(); }
    if (perfect && !opt.boss) { gainXP(20); xp += 20; }
    checkAch();
    const go = () => opt.then ? opt.then() : summary();
    const after = () => goalModal ? (goalModal = false, sfx.lvl(), burst(innerWidth / 2, innerHeight / 3, 120),
      modal(`<div class="huge">🔥</div><h2>Denný cieľ splnený!</h2><p>Séria: <b>${S.streak} ${S.streak === 1 ? "deň" : S.streak < 5 ? "dni" : "dní"}</b><br>Príď zajtra, nech oheň nezhasne.</p>`, go)) : go();
    if (opt.boss != null) { sfx.ach(); burst(innerWidth / 2, innerHeight / 3, 150); modal(`<div class="huge">${opt.noCrown ? "📝" : "👑"}</div><h2>${crown ? "Korunka získaná!" : "Skúška zvládnutá!"}</h2><p>${opt.bossTitle ? esc(opt.bossTitle) : `Lekcia ${opt.boss + 1}: ${esc(lessons[opt.boss])}`}<br>+50 XP</p>`, after); }
    else after();
  };
  const summary = () => {
    keyHandler = e => (e.key === " " || e.key === "Enter") && (e.preventDefault(), more.click());
    const u = opt.unlocked || [], tz = teaser(), lv = LV(S.xp), d = due().length;
    const perfect = wrong === 0 && total >= 5;
    if (right / Math.max(1, total) > .7) setTimeout(() => burst(innerWidth / 2, 160, 70), 100);
    $(`<div class="panel end pop">
      <div class="seal" style="margin:0 auto;width:64px;height:64px;font-size:34px">${perfect ? "棒" : right >= wrong * 2 ? "好" : "加油"}</div>
      <div class="score">${right}/${right + wrong}</div>
      <p>${perfect ? "💯 Bez chyby! +20 XP bonus<br>" : ""}+${xp} XP · dnes ${S.done}/${GOAL}${S.done >= GOAL ? " ✅" : ""}</p>
      <div class="lvl" style="max-width:360px;margin:0 auto 10px"><b>Lv ${lv.l}</b><div class="bar"><i style="width:${lv.x / lv.need * 100}%"></i></div>${lv.need - lv.x} do Lv ${lv.l + 1}</div>
      ${u.length ? `<div class="unlock"><b>🔓 Odomknuté slová z Anki (${u.length})</b>${wordList(u)}</div>` : ""}
      ${tz ? `<button class="tease" id="tease"><span class="zh">${tz.c.c}</span><div><b>Ešte 1 znak → +${tz.ws.length} ${tz.ws.length === 1 ? "slovo" : tz.ws.length < 5 ? "slová" : "slov"}</b><br><small>${tz.ws.slice(0, 4).map(w => esc(w.zh)).join(" · ")}</small></div></button>` : ""}
      <div class="next row"><button class="btn red" id="more">${d ? `Ešte kolo (${Math.min(d, 20)} čaká)` : "Ešte jedno kolo"}</button><button class="btn ghost" id="hm">Domov</button></div>
    </div>`);
    wirePlays();
    hm.onclick = home;
    more.onclick = () => (due().length || nextNew().length || nextSents(1).length) ? smartSession() : speed();
    if (tz) tease.onclick = () => learnFlow([tz.c]);
  };
  show();
}

// ---------- speed ----------
function speed() {
  const pool = chars.filter(c => charKnown(c.c));
  const src = pool.length >= 8 ? pool : chars.slice(0, 40);
  let score = 0, combo = 0, t = 60, cur;
  $(`<div class="top"><button class="x" id="q">×</button><div class="bar"><i id="tb" style="width:100%;transition:width 1s linear"></i></div><span class="timer" id="tm">60</span></div>
  <div class="panel" id="card"><div class="big" id="ch"></div>
  <div class="opts" id="op"></div>
  <p class="center" style="margin-top:14px">skóre <b id="sc" style="font-size:22px">0</b> · rekord ${S.best} <span class="combo" id="cb"></span></p></div>`);
  const upd = () => { tm.textContent = t; tb.style.width = Math.min(100, t / 60 * 100) + "%"; tm.style.color = t <= 10 ? "var(--red)" : ""; };
  const timer = setInterval(() => { t--; upd(); if (t <= 10 && t > 0) sfx.tick(); if (t <= 0) stop(); }, 1000);
  const stop = () => {
    clearInterval(timer); keyHandler = null;
    const rec = score > S.best; if (rec) S.best = score; S.speedRuns++; save();
    gainXP(score * 3);
    if (rec) { sfx.ach(); burst(innerWidth / 2, innerHeight / 3, 120); }
    checkAch();
    $(`<div class="panel end pop"><div class="seal" style="margin:0 auto;width:64px;height:64px;font-size:34px">快</div>
      <div class="score">${score}</div><p>${rec ? "🏆 Nový rekord!" : `Rekord: ${S.best} · ešte ${S.best - score + 1} na prekonanie`}<br>+${score * 3} XP</p>
      <div class="next row"><button class="btn red" id="ag">Znova</button><button class="btn ghost" id="hm">Domov</button></div></div>`);
    ag.onclick = speed; hm.onclick = home;
    keyHandler = e => (e.key === " " || e.key === "Enter") && (e.preventDefault(), speed());
  };
  q.onclick = () => { clearInterval(timer); home(); };
  const nextQ = () => {
    if (t <= 0) return;
    cur = pick(src.filter(x => x !== cur));
    const seen = new Set([cur.m]), opts = [cur];
    for (const x of shuffle(src.length >= 4 ? src : chars)) { if (opts.length >= 4) break; if (!seen.has(x.m)) { seen.add(x.m); opts.push(x); } }
    const o = shuffle(opts);
    window.__ok = o.indexOf(cur);
    ch.textContent = cur.c; ch.className = "big pop";
    op.innerHTML = o.map((x, j) => `<button class="opt" data-j="${j}"><kbd>${j + 1}</kbd>${esc(x.m)}</button>`).join("");
    let locked = false;
    const ans = j => {
      if (locked) return; locked = true;
      const b = op.children[j];
      answered(o[j] === cur, "c:" + cur.c, "speed");
      if (o[j] === cur) { score++; combo++; t++; S.maxCombo = Math.max(S.maxCombo, combo); sfx.ok(combo); burstAt(b, 10); floatText("+1 s", tm); nextQ(); }
      else { combo = 0; t = Math.max(0, t - 3); sfx.bad(); card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake"); b.classList.add("bad"); op.children[o.indexOf(cur)].classList.add("ok"); floatText("−3 s", tm); setTimeout(nextQ, 600); }
      upd(); sc.textContent = score; cb.textContent = combo >= 3 ? "🔥×" + combo : "";
      if (t <= 0) stop();
    };
    op.querySelectorAll(".opt").forEach(b => b.onclick = () => ans(+b.dataset.j));
    keyHandler = e => { if (e.key >= "1" && e.key <= "4") ans(+e.key - 1); if (e.key === "Escape") { clearInterval(timer); home(); } };
  };
  nextQ();
}

// ---------- study timer: counts only while the tab is visible and in use, so an idle new tab adds nothing ----------
let lastActive = Date.now();
for (const ev of ["pointerdown", "pointermove", "keydown", "wheel", "touchmove"]) addEventListener(ev, () => lastActive = Date.now(), {passive: true});
const studyTimer = setInterval(() => {
  if (audio && !audio.paused) lastActive = Date.now(); // shadowing runs hands-free
  if (document.hidden || Date.now() - lastActive > IDLE_MS) return;
  S.studySecs++;
  if (S.studySecs % 10 === 0) save();
  if (window.timeTotal) timeTotal.textContent = timeLine();
}, 1000);

home();
