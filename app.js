// ─── Storage ───
const DB_NAME = "ironlog", STORE_NAME = "data";

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE_NAME);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function dbGet(k, fb) {
  try {
    const db = await openDB();
    return new Promise(res => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const r = tx.objectStore(STORE_NAME).get(k);
      r.onsuccess = () => res(r.result !== undefined ? r.result : fb);
      r.onerror = () => res(fb);
    });
  } catch { return fb; }
}

async function dbSet(k, v) {
  try {
    const db = await openDB();
    return new Promise(res => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(v, k);
      tx.oncomplete = () => res();
    });
  } catch (e) { console.error("Save failed:", e); }
}

// ─── Defaults ───
const DEFAULT_PROGRAMS = [
  { id: "push", name: "Push", exercises: [{ id: "bench", name: "Bench Press" }, { id: "ohp", name: "Overhead Press" }, { id: "incline-db", name: "Incline DB Press" }, { id: "lateral-raise", name: "Lateral Raises" }, { id: "tricep-push", name: "Tricep Pushdowns" }] },
  { id: "pull", name: "Pull", exercises: [{ id: "deadlift", name: "Deadlift" }, { id: "pullup", name: "Pull-ups" }, { id: "barbell-row", name: "Barbell Row" }, { id: "face-pull", name: "Face Pulls" }, { id: "bicep-curl", name: "Bicep Curls" }] },
  { id: "legs", name: "Legs", exercises: [{ id: "squat", name: "Squat" }, { id: "rdl", name: "Romanian Deadlift" }, { id: "leg-press", name: "Leg Press" }, { id: "leg-curl", name: "Leg Curls" }, { id: "calf-raise", name: "Calf Raises" }] }
];

// ─── State ───
let state = {
  view: "weight", liftSub: "log",
  programs: DEFAULT_PROGRAMS, activeProgram: 0,
  sessionSets: {}, history: {}, bodyWeight: [], runs: [],
  loaded: false, saveIndicator: false,
  timer: { duration: 60, remaining: null, running: false, interval: null }
};
let audioCtx = null;

// ─── Helpers ───
function playBeep() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.frequency.value = 880; g.gain.value = 0.3;
    o.start(); o.stop(audioCtx.currentTime + 0.15);
  } catch {}
}
function todayStr() { return new Date().toISOString().split("T")[0]; }
function fmtDate(d) { return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }
function fmtTime(s) { const m = Math.floor(s / 60); return `${m}:${(s % 60).toString().padStart(2, "0")}`; }

// ─── Session ───
function initSession() {
  const p = state.programs[state.activeProgram];
  if (!p) return;
  const ss = {};
  p.exercises.forEach(ex => {
    const h = state.history[ex.id] || [];
    const l = h.length > 0 ? h[h.length - 1] : null;
    ss[ex.id] = l ? l.sets.map(s => ({ ...s })) : [{ weight: "", reps: "" }, { weight: "", reps: "" }, { weight: "", reps: "" }];
  });
  state.sessionSets = ss;
}

function clearSession() {
  const p = state.programs[state.activeProgram];
  if (!p) return;
  p.exercises.forEach(ex => {
    state.sessionSets[ex.id] = [{ weight: "", reps: "" }, { weight: "", reps: "" }, { weight: "", reps: "" }];
  });
}

// ─── Data Actions ───
async function loadAll() {
  state.programs = await dbGet("programs", DEFAULT_PROGRAMS);
  state.history = await dbGet("history", {});
  state.bodyWeight = await dbGet("bodyweight", []);
  state.runs = await dbGet("runs", []);
  state.loaded = true;
  initSession();
  render();
}

async function logBodyWeight(w) {
  const date = todayStr();
  const idx = state.bodyWeight.findIndex(e => e.date === date);
  const entry = { date, weight: parseFloat(w) };
  if (idx >= 0) state.bodyWeight[idx] = entry; else state.bodyWeight.push(entry);
  state.bodyWeight.sort((a, b) => a.date.localeCompare(b.date));
  await dbSet("bodyweight", state.bodyWeight);
  render();
}

async function logRun(distance, duration) {
  const date = todayStr();
  const idx = state.runs.findIndex(e => e.date === date);
  const entry = { date, distance: parseFloat(distance) || 0, duration: parseInt(duration) || 0 };
  if (idx >= 0) state.runs[idx] = entry; else state.runs.push(entry);
  state.runs.sort((a, b) => a.date.localeCompare(b.date));
  await dbSet("runs", state.runs);
  render();
}

async function saveSession() {
  const date = todayStr();
  const prog = state.programs[state.activeProgram];
  prog.exercises.forEach(ex => {
    const sets = (state.sessionSets[ex.id] || []).filter(s => s.weight && s.reps);
    if (!sets.length) return;
    if (!state.history[ex.id]) state.history[ex.id] = [];
    const idx = state.history[ex.id].findIndex(h => h.date === date);
    const entry = { date, sets: sets.map(s => ({ weight: s.weight, reps: s.reps })) };
    if (idx >= 0) state.history[ex.id][idx] = entry; else state.history[ex.id].push(entry);
  });
  await dbSet("history", state.history);
  clearSession();
  state.saveIndicator = true;
  render();
  setTimeout(() => { state.saveIndicator = false; render(); }, 2000);
}

async function savePrograms(ed) {
  state.programs = ed;
  state.activeProgram = 0;
  state.view = "lifting";
  await dbSet("programs", ed);
  initSession();
  render();
}

// ─── Timer ───
function startTimer() {
  state.timer.remaining = state.timer.duration;
  state.timer.running = true;
  clearInterval(state.timer.interval);
  state.timer.interval = setInterval(() => {
    state.timer.remaining--;
    if (state.timer.remaining <= 0) {
      state.timer.remaining = 0;
      state.timer.running = false;
      clearInterval(state.timer.interval);
      playBeep();
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    }
    render();
  }, 1000);
  render();
}

function stopTimer() {
  state.timer.running = false;
  state.timer.remaining = null;
  clearInterval(state.timer.interval);
  render();
}

// ─── DOM Helper ───
const $ = s => document.querySelector(s);
const app = () => $("#app");

function h(tag, attrs, ...ch) {
  const el = document.createElement(tag);
  if (attrs) Object.entries(attrs).forEach(([k, v]) => {
    if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "className") el.className = v;
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v);
  });
  ch.flat().forEach(c => {
    if (c == null) return;
    el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  });
  return el;
}

// ─── Charts ───
function drawLineChart(canvas, values, labels, color, height) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr; canvas.height = height * dpr;
  canvas.style.width = rect.width + "px"; canvas.style.height = height + "px";
  ctx.scale(dpr, dpr);
  const W = rect.width, H = height, pad = { top: 10, right: 10, bottom: 24, left: 40 };
  const cW = W - pad.left - pad.right, cH = H - pad.top - pad.bottom;
  const span = Math.max(...values) - Math.min(...values);
  const minV = Math.min(...values) - span * 0.15 - 0.5, maxV = Math.max(...values) + span * 0.15 + 0.5;
  const range = maxV - minV || 1;
  const pts = values.map((v, i) => ({ x: pad.left + (i / (values.length - 1 || 1)) * cW, y: pad.top + cH - ((v - minV) / range) * cH }));
  ctx.strokeStyle = "#e0e0e6"; ctx.lineWidth = 0.5;
  for (let i = 0; i < 4; i++) { const y = pad.top + (i / 3) * cH; ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke(); }
  ctx.fillStyle = "#71717a"; ctx.font = "10px -apple-system,sans-serif"; ctx.textAlign = "right";
  for (let i = 0; i < 4; i++) { const y = pad.top + (i / 3) * cH; const val = maxV - (i / 3) * range; ctx.fillText(val < 10 ? val.toFixed(1) : Math.round(val), pad.left - 6, y + 3); }
  ctx.textAlign = "center"; const step = Math.max(1, Math.floor(values.length / 5));
  for (let i = 0; i < values.length; i += step) ctx.fillText(labels[i], pts[i].x, H - 4);
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.beginPath();
  pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)); ctx.stroke();
  const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
  const grad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
  grad.addColorStop(0, `rgba(${r},${g},${b},0.1)`); grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad; ctx.beginPath(); ctx.moveTo(pts[0].x, H - pad.bottom);
  pts.forEach(p => ctx.lineTo(p.x, p.y)); ctx.lineTo(pts[pts.length - 1].x, H - pad.bottom); ctx.fill();
  pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); });
}

// ─── Components ───
function renderTimer() {
  const t = state.timer, rem = t.remaining, dur = t.duration, pct = rem !== null ? rem / dur : 1;
  const color = rem === 0 ? "var(--success)" : (rem !== null && rem < 10) ? "var(--warning)" : "var(--accent)";
  const circ = 2 * Math.PI * 22;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "52"); svg.setAttribute("height", "52"); svg.style.transform = "rotate(-90deg)";
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  bg.setAttribute("cx", "26"); bg.setAttribute("cy", "26"); bg.setAttribute("r", "22"); bg.setAttribute("fill", "none"); bg.setAttribute("stroke", "var(--border)"); bg.setAttribute("stroke-width", "4");
  const fg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  fg.setAttribute("cx", "26"); fg.setAttribute("cy", "26"); fg.setAttribute("r", "22"); fg.setAttribute("fill", "none"); fg.setAttribute("stroke", color); fg.setAttribute("stroke-width", "4");
  fg.setAttribute("stroke-dasharray", circ); fg.setAttribute("stroke-dashoffset", circ * (1 - pct)); fg.setAttribute("stroke-linecap", "round"); fg.style.transition = "stroke-dashoffset 0.3s,stroke 0.3s";
  svg.append(bg, fg);
  return h("div", { className: "timer-card" },
    h("div", { className: "timer-ring" }, svg, h("span", { className: "timer-display", style: { color } }, rem !== null ? fmtTime(rem) : fmtTime(dur))),
    h("div", { style: { flex: "1", display: "flex", flexDirection: "column", gap: "6px" } },
      h("span", { className: "timer-label" }, "Rest Timer"),
      h("div", { className: "timer-presets" }, ...[60, 180].map(s => h("button", { className: "preset-btn" + (dur === s ? " active" : ""), onClick: () => { state.timer.duration = s; if (!t.running) state.timer.remaining = null; render(); } }, `${s / 60}m`)))
    ),
    h("button", { className: "btn-timer" + (t.running ? " running" : ""), onClick: () => t.running ? stopTimer() : startTimer() }, rem === 0 ? "Reset" : t.running ? "Stop" : "Start")
  );
}

function renderSetRow(exId, set, index) {
  return h("div", { className: "set-row" },
    h("span", { className: "set-num" }, String(index + 1)),
    h("div", { className: "set-input-wrap" },
      h("input", { type: "number", inputMode: "decimal", className: "set-input has-unit", value: set.weight, placeholder: "kg", onInput: (e) => { state.sessionSets[exId][index].weight = e.target.value; } }),
      h("span", { className: "set-unit" }, "kg")
    ),
    h("div", {},
      h("input", { type: "number", inputMode: "numeric", className: "set-input", value: set.reps, placeholder: "reps", onInput: (e) => { state.sessionSets[exId][index].reps = e.target.value; } })
    ),
    h("button", { className: "btn-remove-set", onClick: () => { state.sessionSets[exId].splice(index, 1); render(); } }, "×")
  );
}

function renderExerciseCard(ex) {
  const sets = state.sessionSets[ex.id] || [];
  const hist = state.history[ex.id] || [];
  const last = hist.length > 0 ? hist[hist.length - 1] : null;
  return h("div", { className: "card" },
    h("div", { className: "card-header" },
      h("h3", {}, ex.name),
      last ? h("span", { className: "last" }, "Last: " + last.sets.map(s => `${s.weight}×${s.reps}`).join(" / ")) : null
    ),
    h("div", { className: "set-labels" }, h("span", {}, "Set"), h("span", {}, "Weight"), h("span", {}, "Reps"), h("span", {})),
    ...sets.map((s, i) => renderSetRow(ex.id, s, i)),
    h("button", { className: "btn-add-set", onClick: () => { const l = sets.length > 0 ? sets[sets.length - 1] : { weight: "", reps: "" }; state.sessionSets[ex.id].push({ weight: l.weight, reps: l.reps }); render(); } }, "+ Add Set")
  );
}

function renderProgressChart(ex) {
  const hist = state.history[ex.id] || [];
  if (hist.length < 2) return null;
  const data = hist.slice(-20).map(h => ({ date: fmtDate(h.date), weight: Math.max(...h.sets.map(s => parseFloat(s.weight) || 0)) }));
  const card = h("div", { className: "progress-card" },
    h("div", { className: "progress-title" }, ex.name, h("span", { className: "progress-subtitle" }, "Max Weight (kg)")),
    h("div", { className: "chart-container" }, h("canvas", { id: "chart-" + ex.id }))
  );
  requestAnimationFrame(() => { const c = document.getElementById("chart-" + ex.id); if (c) drawLineChart(c, data.map(d => d.weight), data.map(d => d.date), "#2563eb", 120); });
  return card;
}

// ─── Tab: Weight ───
function renderWeightTab() {
  const sorted = [...state.bodyWeight].sort((a, b) => a.date.localeCompare(b.date));
  const recent = sorted.length > 0 ? sorted[sorted.length - 1] : null;
  const frag = document.createDocumentFragment();
  if (sorted.length >= 2) {
    const data = sorted.slice(-30);
    const card = h("div", { className: "progress-card", style: "margin-bottom:12px;" },
      h("div", { className: "progress-title" }, "Body Weight", h("span", { className: "progress-subtitle" }, "kg")),
      h("div", { className: "chart-container" }, h("canvas", { id: "chart-bw" }))
    );
    frag.append(card);
    requestAnimationFrame(() => { const c = document.getElementById("chart-bw"); if (c) drawLineChart(c, data.map(d => d.weight), data.map(d => fmtDate(d.date)), "#16a34a", 160); });
  } else {
    frag.append(h("div", { className: "empty-state" }, "Log at least 2 weigh-ins to see the chart."));
  }
  let inp;
  frag.append(h("div", { className: "card" },
    h("div", { className: "card-header" }, h("h3", {}, "Log Weight"), recent ? h("span", { className: "last" }, `Latest: ${recent.weight} kg`) : null),
    h("div", { className: "input-row" },
      inp = h("input", { type: "number", inputMode: "decimal", className: "input-field", placeholder: "kg" }),
      h("button", { className: "btn-log btn-log-weight", onClick: () => { if (inp.value) { logBodyWeight(inp.value); inp.value = ""; } } }, "Log")
    ),
    sorted.length > 0 ? h("div", { style: "display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;" },
      ...sorted.slice(-10).reverse().map(e => h("div", { className: "tag" }, `${fmtDate(e.date)}: ${e.weight}`,
        h("button", { className: "tag-remove", onClick: () => { state.bodyWeight = state.bodyWeight.filter(x => x.date !== e.date); dbSet("bodyweight", state.bodyWeight); render(); } }, "×")
      ))
    ) : null
  ));
  return frag;
}

// ─── Tab: Lifting ───
function renderLiftingTab() {
  const frag = document.createDocumentFragment();
  const prog = state.programs[state.activeProgram];
  if (!prog) return frag;
  frag.append(h("div", { className: "program-bar" },
    ...state.programs.map((p, i) => h("button", { className: "prog-btn" + (i === state.activeProgram ? " active" : ""), onClick: () => { state.activeProgram = i; initSession(); render(); } }, p.name))
  ));
  frag.append(h("div", { className: "tabs", style: "margin-bottom:12px;" },
    ...["log", "progress"].map(v => h("button", { className: "tab" + (state.liftSub === v ? " active" : ""), onClick: () => { state.liftSub = v; render(); } }, v.charAt(0).toUpperCase() + v.slice(1)))
  ));
  if (state.liftSub === "log") {
    frag.append(renderTimer());
    prog.exercises.forEach(ex => frag.append(renderExerciseCard(ex)));
    frag.append(h("button", { className: "btn-save" + (state.saveIndicator ? " saved" : ""), onClick: saveSession }, state.saveIndicator ? "✓ Saved!" : "Save Session"));
  }
  if (state.liftSub === "progress") {
    let has = false;
    prog.exercises.forEach(ex => { const c = renderProgressChart(ex); if (c) { frag.append(c); has = true; } });
    if (!has) frag.append(h("div", { className: "empty-state" }, "Log at least 2 sessions to see progression charts."));
  }
  return frag;
}

// ─── Tab: Running ───
function renderRunningTab() {
  const sorted = [...state.runs].sort((a, b) => a.date.localeCompare(b.date));
  const recent = sorted.length > 0 ? sorted[sorted.length - 1] : null;
  const frag = document.createDocumentFragment();
  if (sorted.length >= 2) {
    const data = sorted.slice(-30);
    frag.append(h("div", { className: "progress-card", style: "margin-bottom:8px;" },
      h("div", { className: "progress-title" }, "Distance", h("span", { className: "progress-subtitle" }, "km")),
      h("div", { className: "chart-container" }, h("canvas", { id: "chart-run-dist" }))
    ));
    const paceData = data.filter(d => d.distance > 0 && d.duration > 0);
    if (paceData.length >= 2) {
      frag.append(h("div", { className: "progress-card", style: "margin-bottom:12px;" },
        h("div", { className: "progress-title" }, "Pace", h("span", { className: "progress-subtitle" }, "min/km")),
        h("div", { className: "chart-container" }, h("canvas", { id: "chart-run-pace" }))
      ));
    }
    requestAnimationFrame(() => {
      const c1 = document.getElementById("chart-run-dist"); if (c1) drawLineChart(c1, data.map(d => d.distance), data.map(d => fmtDate(d.date)), "#7c3aed", 140);
      if (paceData.length >= 2) { const c2 = document.getElementById("chart-run-pace"); if (c2) drawLineChart(c2, paceData.map(d => d.duration / d.distance), paceData.map(d => fmtDate(d.date)), "#7c3aed", 140); }
    });
  } else {
    frag.append(h("div", { className: "empty-state" }, "Log at least 2 runs to see charts."));
  }
  let distEl, durEl;
  frag.append(h("div", { className: "card" },
    h("div", { className: "card-header" }, h("h3", {}, "Log Run"), recent ? h("span", { className: "last" }, `Last: ${recent.distance}km in ${recent.duration}min`) : null),
    h("div", { style: "display:flex;flex-direction:column;gap:8px;" },
      h("div", { style: "display:flex;gap:8px;" },
        h("div", { className: "input-wrap" }, distEl = h("input", { type: "number", inputMode: "decimal", className: "input-field", placeholder: "distance", style: "padding-right:34px;" }), h("span", { className: "input-unit" }, "km")),
        h("div", { className: "input-wrap" }, durEl = h("input", { type: "number", inputMode: "numeric", className: "input-field", placeholder: "duration", style: "padding-right:34px;" }), h("span", { className: "input-unit" }, "min"))
      ),
      h("button", { className: "btn-log btn-log-run", style: "width:100%;padding:12px;", onClick: () => { if (distEl.value || durEl.value) { logRun(distEl.value, durEl.value); distEl.value = ""; durEl.value = ""; } } }, "Log Run")
    ),
    sorted.length > 0 ? h("div", { style: "display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;" },
      ...sorted.slice(-10).reverse().map(e => h("div", { className: "tag" }, `${fmtDate(e.date)}: ${e.distance}km ${e.duration}min`,
        h("button", { className: "tag-remove", onClick: () => { state.runs = state.runs.filter(x => x.date !== e.date); dbSet("runs", state.runs); render(); } }, "×")
      ))
    ) : null
  ));
  return frag;
}

// ─── Editor ───
function renderEditor() {
  let ed = JSON.parse(JSON.stringify(state.programs));
  function rr() { const c = document.getElementById("editor-container"); if (c) { c.innerHTML = ""; c.append(buildEd()); } }
  function buildEd() {
    const frag = document.createDocumentFragment();
    ed.forEach((prog, pIdx) => {
      frag.append(h("div", { className: "card", style: { marginBottom: "12px" } },
        h("div", { style: { display: "flex", gap: "8px", alignItems: "center", marginBottom: "12px" } },
          h("input", { className: "edit-input title", value: prog.name, onInput: (e) => { ed[pIdx].name = e.target.value; } }),
          h("button", { className: "btn-remove danger", onClick: () => { if (ed.length <= 1) return; ed.splice(pIdx, 1); rr(); } }, "×")
        ),
        ...prog.exercises.map((ex, eIdx) => h("div", { className: "edit-row" },
          h("span", { className: "edit-num" }, String(eIdx + 1)),
          h("input", { className: "edit-input", value: ex.name, placeholder: "Exercise name", style: { fontSize: "13px", padding: "7px 12px" }, onInput: (e) => { ed[pIdx].exercises[eIdx].name = e.target.value; } }),
          h("button", { className: "btn-remove", onClick: () => { ed[pIdx].exercises.splice(eIdx, 1); rr(); } }, "×")
        )),
        h("button", { className: "btn-dashed", onClick: () => { ed[pIdx].exercises.push({ id: "ex-" + Date.now(), name: "" }); rr(); } }, "+ Add Exercise")
      ));
    });
    frag.append(h("button", { className: "btn-dashed-lg", onClick: () => { ed.push({ id: "prog-" + Date.now(), name: "New", exercises: [{ id: "ex-" + Date.now(), name: "" }] }); rr(); } }, "+ Add Program"));
    return frag;
  }
  return h("div", {},
    h("div", { className: "editor-header" },
      h("h2", {}, "Edit Programs"),
      h("div", { style: { display: "flex", gap: "8px" } },
        h("button", { className: "btn-cancel", onClick: () => { state.view = "lifting"; render(); } }, "Cancel"),
        h("button", { className: "btn-primary", onClick: () => savePrograms(ed) }, "Save")
      )
    ),
    h("div", { id: "editor-container" }, buildEd())
  );
}

// ─── Logo ───
function mkLogo(dateStr) {
  const d = document.createElement("div");
  d.className = "logo-area";
  d.innerHTML = `<div class="logo-badge"><svg width="20" height="14" viewBox="0 0 20 14" fill="none"><rect x="0" y="2" width="3" height="10" rx="1" fill="white"/><rect x="3" y="3.5" width="2" height="7" rx="0.5" fill="white"/><rect x="5" y="6" width="10" height="2" rx="1" fill="white"/><rect x="15" y="3.5" width="2" height="7" rx="0.5" fill="white"/><rect x="17" y="2" width="3" height="10" rx="1" fill="white"/></svg></div><div><h1>Iron <span class="logo-accent">Log</span></h1><p class="date">${dateStr}</p></div>`;
  return d;
}

// ─── Main Render ───
function render() {
  const root = app();
  root.innerHTML = "";
  const dateStr = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  root.append(h("div", { className: "header" },
    mkLogo(dateStr),
    state.view !== "edit"
      ? h("button", { className: "btn-edit", onClick: () => { state.view = "edit"; render(); } }, "⚙ Edit")
      : h("button", { className: "btn-edit", onClick: () => { state.view = "lifting"; render(); } }, "← Back")
  ));
  if (state.view === "edit") { root.append(renderEditor()); return; }
  root.append(h("div", { className: "tabs", style: "margin-bottom:16px;" },
    ...["weight", "lifting", "running"].map(v => h("button", { className: "tab" + (state.view === v ? " active" : ""), onClick: () => { state.view = v; render(); } }, v.charAt(0).toUpperCase() + v.slice(1)))
  ));
  if (state.view === "weight") root.append(renderWeightTab());
  if (state.view === "lifting") root.append(renderLiftingTab());
  if (state.view === "running") root.append(renderRunningTab());
}

loadAll();
