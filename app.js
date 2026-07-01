/* ============================================================
   CalendarioGym — app.js
   - Estado persistido en localStorage
   - 5 vistas: Hoy / Semana / Rutinas / Ejercicios / Ajustes
   - Notificaciones: push API + service worker
   - Export/Import JSON
   ============================================================ */

const STORAGE_KEY = "calendariogym.v1";
const SCHEMA_VERSION = 1;
// Mirror del dataset (el repo upstream quitó las imágenes por copyright el 30/06/2026;
// usamos un fork espejo que aún conserva las 1324 imágenes + GIFs).
const GITHUB_RAW = "https://raw.githubusercontent.com/ievenight/exercises-dataset/main/";

const CATEGORY_LABELS = {
  back: "Espalda",
  cardio: "Cardio",
  chest: "Pecho",
  "lower arms": "Antebrazo",
  "lower legs": "Gemelos",
  neck: "Cuello",
  shoulders: "Hombros",
  "upper arms": "Brazos",
  "upper legs": "Piernas",
  waist: "Core",
};

const EQUIPMENT_LABELS = {
  "body weight": "Peso corporal",
  dumbbell: "Mancuerna",
  barbell: "Barra",
  cable: "Cable",
  band: "Banda",
  "leverage machine": "Máquina",
  "smith machine": "Smith",
  kettlebell: "Kettlebell",
  "ez barbell": "Barra Z",
  weighted: "Lastrado",
  "stability ball": "Fitball",
  assisted: "Asistido",
  "bosu ball": "BOSU",
  "elliptical machine": "Elíptica",
  hammer: "Martillo",
  "medicine ball": "Balón medicinal",
  "olympic barbell": "Barra olímpica",
  roller: "Rueda",
  rope: "Cuerda",
  "wheel roller": "Rueda abdominal",
  other: "Otro",
};

const DAYS_ES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const DAYS_LONG_ES = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];

// ============================================================
// Autorutina — Push / Legs / Arms / Pull (4 días × 4 semanas)
// Días: Lunes (Pecho) · Martes (Piernas) · Miércoles (Brazos)
//       Jueves (Espalda). Viernes a domingo descanso.
// ============================================================

const AUTO_ROUTINE = {
  weeks: 4,
  days: [
    {
      dow: 1,
      label: "Pecho",
      exercises: [
        { eid: "0025", sets: 4, reps: "6-8" }, // barbell bench press
        { eid: "0047", sets: 3, reps: "8-10" }, // barbell incline bench press
        { eid: "3545", sets: 3, reps: "10-12" }, // dumbbell incline alternate press
        { eid: "0154", sets: 3, reps: "12-15" }, // cable cross-over revers fly
      ],
    },
    {
      dow: 2,
      label: "Piernas",
      exercises: [
        { eid: "0043", sets: 4, reps: "6-8" }, // barbell full squat
        { eid: "0032", sets: 4, reps: "5-6" }, // barbell deadlift
        { eid: "2287", sets: 3, reps: "10-12" }, // lever alternate leg press
        { eid: "0586", sets: 3, reps: "12-15" }, // lever lying leg curl
      ],
    },
    {
      dow: 3,
      label: "Brazos",
      exercises: [
        { eid: "0294", sets: 3, reps: "10-12" }, // dumbbell biceps curl
        { eid: "2404", sets: 3, reps: "8-10" }, // ez-bar biceps curl
        { eid: "1721", sets: 3, reps: "10-12" }, // barbell reverse grip skullcrusher
        { eid: "2406", sets: 3, reps: "12-15" }, // cable triceps pushdown
      ],
    },
    {
      dow: 4,
      label: "Espalda",
      exercises: [
        { eid: "0652", sets: 4, reps: "al fallo" }, // pull-up
        { eid: "0027", sets: 4, reps: "6-8" }, // barbell bent over row
        { eid: "0293", sets: 3, reps: "8-10" }, // dumbbell bent over row
        { eid: "0007", sets: 3, reps: "10-12" }, // alternate lateral pulldown
      ],
    },
  ],
};

function autoRoutineId(label) {
  return "auto-" + label.toLowerCase();
}

// Devuelve el label del músculo si ese día viene de la autorutina (todos sus items
// comparten el mismo fromRoutine auto-*). Devuelve null si no es día de autorutina.
function getDayMuscleLabel(isoDate) {
  const items = state.data.schedule[isoDate];
  if (!items || items.length === 0) return null;
  const rid = items[0].fromRoutine;
  if (!rid || !rid.startsWith("auto-")) return null;
  // todos los items deben tener el mismo fromRoutine
  for (const it of items) if (it.fromRoutine !== rid) return null;
  // Capitaliza el segmento tras "auto-"
  const tail = rid.slice(5); // "pecho"
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}

// Devuelve la lista de fechas (YYYY-MM-DD) que la autorutina cubriría desde hoy
// dows: array de dow (0..6) ya ordenados cronológicamente
function autoRoutineDatesFor(weeks, dows) {
  const today = todayISO();
  const dow = parseISO(today).getDay(); // 0..6
  const daysToMonday = (8 - dow) % 7; // si hoy es lunes -> 0
  const startMonday = addDays(today, daysToMonday);
  const out = [];
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < dows.length; d++) {
      const targetDow = dows[d];
      // offset dentro de la semana: targetDow - 1 (lunes=0) o targetDow si lunes=1
      const dowOffset = targetDow === 0 ? 6 : targetDow - 1;
      const isoDate = addDays(startMonday, w * 7 + dowOffset);
      out.push({ isoDate, dow: targetDow, slotIndex: d });
    }
  }
  return out;
}

// Cuenta cuántos días del plan ya tienen ejercicios del usuario
function autoRoutineOverlapFor(dows, weeks) {
  const list = autoRoutineDatesFor(weeks, dows);
  return list.filter((x) => {
    const existing = state.data.schedule[x.isoDate];
    return existing && existing.length > 0;
  });
}

// (legacy) para compatibilidad con código anterior
function autoRoutineDates(weeks) {
  return autoRoutineDatesFor(weeks, AUTO_ROUTINE.days.map((d) => d.dow));
}
function autoRoutineOverlap(weeks) {
  return autoRoutineOverlapFor(AUTO_ROUTINE.days.map((d) => d.dow), weeks);
}

// ============================================================
// Estado global
// ============================================================

const state = {
  /** @type {Array} */ exercises: [],
  exercisesById: new Map(),
  /** Vista activa */ view: "today",
  /** Fecha seleccionada (YYYY-MM-DD) */ selectedDate: todayISO(),
  /** Semana mostrada en el calendario (inicio lunes) */ weekAnchor: weekStart(todayISO()),
  /** Filtros biblioteca */ library: {
    q: "",
    category: "",
    visible: 60,
  },
  /** Idioma de instrucciones */ instLang: "es", // dataset tiene EN/IT/TR; traduciremos al español con instrucciones resumidas si fuera necesario
  /** Datos */ data: loadData(),
  /** Set de timeouts de notificaciones */ reminderTimers: [],
};

// ============================================================
// Datos — persistencia
// ============================================================

function defaultData() {
  return {
    version: SCHEMA_VERSION,
    schedule: {}, // { 'YYYY-MM-DD': [ { id, eid, sets, reps, weight, rest, notes, done } ] }
    routines: {}, // { rid: { name, items: [ { eid, sets, reps, weight } ] } }
    settings: {
      reminders: false,
      reminderTime: "18:00",
      reminderDays: [1, 2, 3, 4, 5], // L-V
    },
  };
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    const obj = JSON.parse(raw);
    if (!obj.version) obj.version = SCHEMA_VERSION;
    if (!obj.schedule) obj.schedule = {};
    if (!obj.routines) obj.routines = {};
    if (!obj.settings) obj.settings = defaultData().settings;
    return obj;
  } catch (e) {
    console.warn("loadData fallback", e);
    return defaultData();
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
}

// ============================================================
// Utilidades fecha
// ============================================================

function todayISO() {
  const d = new Date();
  return toISODate(d);
}
function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function parseISO(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function weekStart(iso) {
  const d = parseISO(iso);
  const dow = d.getDay(); // 0..6 (dom..sab)
  const offset = dow === 0 ? -6 : 1 - dow; // lunes como inicio
  d.setDate(d.getDate() + offset);
  return toISODate(d);
}
function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}
function fmtShort(iso) {
  const d = parseISO(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function fmtLong(iso) {
  const d = parseISO(iso);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  return `${DAYS_LONG_ES[d.getDay()]}, ${d.getDate()} de ${monthName(d.getMonth())} ${d.getFullYear()}`;
}
function monthName(m) {
  return [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ][m];
}
function isSameDay(a, b) {
  return a === b;
}
function diffDays(a, b) {
  const da = parseISO(a);
  const db = parseISO(b);
  return Math.round((db - da) / 86400000);
}

// ============================================================
// Carga dataset
// ============================================================

async function loadExercises() {
  try {
    const r = await fetch("assets/exercises.json", { cache: "force-cache" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const data = await r.json();
    state.exercises = data;
    state.exercisesById = new Map(data.map((e) => [e.id, e]));
    console.log(`[CalendarioGym] ${data.length} ejercicios cargados`);
    return true;
  } catch (e) {
    console.error("Error cargando exercises.json", e);
    toast("No se pudo cargar la biblioteca de ejercicios");
    return false;
  }
}

// Devuelve URL absoluta a la imagen / gif del dataset original
function remoteUrl(path) {
  return GITHUB_RAW + path;
}

// Emoji por categoría de músculo — usado como fallback visual cuando la
// imagen remota del dataset falla en cargar (dataset upstream quitó las
// imágenes en junio 2026 por un aviso de copyright).
const CATEGORY_EMOJI = {
  back: "🔙",
  cardio: "🏃",
  chest: "💪",
  "lower arms": "🦾",
  "lower legs": "🦵",
  neck: "🧎",
  shoulders: "🏋️",
  "upper arms": "💪",
  "upper legs": "🦵",
  waist: "🧘",
};
function emojiForCategory(cat) {
  return CATEGORY_EMOJI[cat] || "🏋️";
}

// Si una imagen falla al cargar, la sustituimos por un placeholder con el
// emoji del músculo. Usamos event delegation para cubrir TODAS las <img>
// que generamos en la app (thumb, ex-card, gif de detalle, picker…).
document.addEventListener(
  "error",
  (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLImageElement)) return;
    if (t.dataset.fallbackDone === "1") return;
    t.dataset.fallbackDone = "1";

    // Determinar el emoji apropiado para el fallback
    let emoji = "🏋️";
    const id = t.dataset.detail;
    if (id && state.exercisesById && state.exercisesById.has(id)) {
      emoji = emojiForCategory(state.exercisesById.get(id).category);
    } else {
      const dayItem = t.closest(".day-item");
      if (dayItem) {
        const idx = Number(dayItem.dataset.idx);
        const items = state.data.schedule[state.selectedDate] || [];
        const it = items[idx];
        if (it && state.exercisesById) {
          const ex = state.exercisesById.get(it.eid);
          if (ex) emoji = emojiForCategory(ex.category);
        }
      } else {
        const card = t.closest(".ex-card");
        if (card) {
          const cardId = card.dataset.id;
          const ex = state.exercisesById && state.exercisesById.get(cardId);
          if (ex) emoji = emojiForCategory(ex.category);
        }
      }
    }

    // Sustituir el <img> por un <div> con el emoji. No podemos usar
    // ::before/::after en <img> (void element), así que cambiamos el nodo.
    const placeholder = document.createElement("div");
    placeholder.className = t.className + " img-fallback";
    placeholder.setAttribute("data-fallback", emoji);
    if (t.dataset.detail) placeholder.dataset.detail = t.dataset.detail;
    t.parentNode.replaceChild(placeholder, t);
  },
  true, // capture: error no burbujea, hay que escuchar en captura
);

// ============================================================
// Renderizado — vista HOY
// ============================================================

function renderToday() {
  const date = state.selectedDate;
  document.getElementById("topbar-date").textContent = fmtLong(date);
  const muscle = getDayMuscleLabel(date);
  const subEl = document.getElementById("topbar-sub");
  if (muscle) {
    subEl.innerHTML = `<span class="muscle-pill">💪 ${escapeHTML(muscle)}</span>`;
  } else {
    subEl.textContent =
      diffDays(date, todayISO()) === 0
        ? "Hoy"
        : diffDays(date, todayISO()) > 0
          ? `En ${diffDays(date, todayISO())} días`
          : `Hace ${-diffDays(date, todayISO())} días`;
  }

  const items = state.data.schedule[date] || [];
  const summary = document.getElementById("day-summary");
  const list = document.getElementById("day-list");
  const empty = document.getElementById("day-empty");
  const fab = document.getElementById("fab");

  // FAB sólo en vistas con contenido del día
  fab.hidden = false;

  if (items.length === 0) {
    summary.hidden = true;
    list.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  summary.hidden = false;

  const totalSets = items.reduce((s, it) => s + (Number(it.sets) || 0), 0);
  const done = items.filter((i) => i.done).length;
  summary.innerHTML = `
    <div class="big">${items.length}</div>
    <div>
      <div>ejercicios</div>
      <div class="label">${totalSets} series · ${done} hechos</div>
    </div>
    <div class="right">
      <div class="big">${Math.round((done / items.length) * 100)}%</div>
      <div class="label">completado</div>
    </div>
  `;

  list.innerHTML = items
    .map((it, idx) => {
      const ex = state.exercisesById.get(it.eid);
      const name = ex ? ex.name : "Ejercicio eliminado";
      const cat = ex ? (CATEGORY_LABELS[ex.category] || ex.category) : "";
      const eq = ex ? (EQUIPMENT_LABELS[ex.equipment] || ex.equipment) : "";
      const img = ex
        ? `<img class="thumb" loading="lazy" src="${remoteUrl(ex.image)}" alt="" data-detail="${ex.id}" />`
        : `<div class="thumb"></div>`;
      const notes = it.notes
        ? `<div class="notes">📝 ${escapeHTML(it.notes)}</div>`
        : "";
      const weightPill = it.weight
        ? `<span class="pill">${escapeHTML(it.weight)}</span>`
        : "";
      return `
        <div class="day-item ${it.done ? "done" : ""}" data-idx="${idx}">
          ${img}
          <div class="info">
            <div class="name" data-detail="${ex ? ex.id : ""}">${escapeHTML(name)}</div>
            <div class="meta">
              <span class="pill">${it.sets || 0}×${escapeHTML(it.reps || "")}</span>
              ${weightPill}
              ${cat ? `<span class="pill">${escapeHTML(cat)}</span>` : ""}
              ${eq ? `<span class="pill">${escapeHTML(eq)}</span>` : ""}
            </div>
            ${notes}
          </div>
          <div class="actions">
            <button class="mini-btn done-btn ${it.done ? "active" : ""}" data-act="toggle-done" title="Marcar">
              ✓
            </button>
            <button class="mini-btn" data-act="edit" title="Editar">✎</button>
            <button class="mini-btn del" data-act="del" title="Quitar">×</button>
          </div>
        </div>
      `;
    })
    .join("");

  list.querySelectorAll("[data-detail]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.getAttribute("data-detail");
      if (id) openExerciseDetail(id);
    });
  });
  list.querySelectorAll(".day-item").forEach((el) => {
    const idx = Number(el.getAttribute("data-idx"));
    el.querySelector('[data-act="toggle-done"]').addEventListener(
      "click",
      () => toggleDone(idx),
    );
    el.querySelector('[data-act="edit"]').addEventListener("click", () =>
      editDayItem(idx),
    );
    el.querySelector('[data-act="del"]').addEventListener("click", () =>
      removeDayItem(idx),
    );
  });
}

// ============================================================
// Renderizado — vista CALENDARIO (semana)
// ============================================================

function renderCalendar() {
  const start = state.weekAnchor;
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const rangeEnd = days[6];
  document.getElementById("cal-range").textContent =
    `${fmtShort(start)} – ${fmtShort(rangeEnd)} ${parseISO(start).getFullYear()}`;

  const today = todayISO();
  const grid = document.getElementById("week-grid");
  grid.innerHTML = days
    .map((iso) => {
      const d = parseISO(iso);
      const items = state.data.schedule[iso] || [];
      const isToday = iso === today ? "is-today" : "";
      const isSel = iso === state.selectedDate ? "is-selected" : "";
      const has = items.length ? "has-workout" : "";
      const muscle = getDayMuscleLabel(iso);
      const muscleTag = muscle
        ? `<div class="muscle-tag">💪 ${escapeHTML(muscle)}</div>`
        : "";
      return `
      <div class="week-day ${isToday} ${isSel} ${has} ${muscle ? "is-auto" : ""}" data-date="${iso}">
        <div class="dow">${DAYS_ES[d.getDay()]}</div>
        <div class="dom">${d.getDate()}</div>
        <div class="count">${items.length > 0 ? items.length + " ej" : "—"}</div>
        ${muscleTag}
      </div>`;
    })
    .join("");

  grid.querySelectorAll(".week-day").forEach((el) => {
    el.addEventListener("click", () => {
      const iso = el.getAttribute("data-date");
      state.selectedDate = iso;
      switchView("today");
      renderToday();
    });
  });

  // Resumen semanal
  const counts = {};
  days.forEach((iso) => {
    (state.data.schedule[iso] || []).forEach((it) => {
      const ex = state.exercisesById.get(it.eid);
      if (!ex) return;
      const cat = ex.category;
      counts[cat] = (counts[cat] || 0) + 1;
    });
  });
  const totalEx = Object.values(counts).reduce((s, n) => s + n, 0);
  const totalSets = days.reduce(
    (s, iso) =>
      s + (state.data.schedule[iso] || []).reduce((x, it) => x + (Number(it.sets) || 0), 0),
    0,
  );

  const ws = document.getElementById("week-summary");
  ws.innerHTML = `
    <div class="muscle-stat"><div class="lbl">Ejercicios</div><div class="val">${totalEx}</div></div>
    <div class="muscle-stat"><div class="lbl">Series</div><div class="val">${totalSets}</div></div>
    ${Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(
        ([cat, n]) =>
          `<div class="muscle-stat"><div class="lbl">${escapeHTML(CATEGORY_LABELS[cat] || cat)}</div><div class="val">${n}</div></div>`,
      )
      .join("")}
  `;

  // topbar fecha
  document.getElementById("topbar-date").textContent =
    `Semana del ${fmtShort(start)}`;
  document.getElementById("topbar-sub").textContent = `${totalEx} ejercicios programados`;
}

// ============================================================
// Renderizado — vista RUTINAS
// ============================================================

function renderRoutines() {
  const list = document.getElementById("routine-list");
  const empty = document.getElementById("routine-empty");
  const routines = Object.entries(state.data.routines);
  document.getElementById("fab").hidden = true;
  if (routines.length === 0) {
    list.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  list.innerHTML = routines
    .map(([rid, r]) => {
      const itemsHtml = (r.items || [])
        .slice(0, 6)
        .map((it) => {
          const ex = state.exercisesById.get(it.eid);
          return `<span class="rex">${escapeHTML(ex ? ex.name : "?")} · ${it.sets || 0}×${escapeHTML(it.reps || "")}</span>`;
        })
        .join("");
      const more =
        r.items && r.items.length > 6
          ? `<span class="rex">+${r.items.length - 6} más</span>`
          : "";
      return `
      <div class="routine-card" data-rid="${rid}">
        <div class="rname">${escapeHTML(r.name || "(sin nombre)")}</div>
        <div class="rmeta">${(r.items || []).length} ejercicios</div>
        <div class="rex-list">${itemsHtml}${more}</div>
        <div class="ractions">
          <button class="btn primary" data-act="apply">Aplicar al día</button>
          <button class="btn" data-act="edit">Editar</button>
          <button class="btn ghost" data-act="dup">Duplicar</button>
          <button class="btn danger ghost" data-act="del">Borrar</button>
        </div>
      </div>
    `;
    })
    .join("");

  list.querySelectorAll(".routine-card").forEach((card) => {
    const rid = card.getAttribute("data-rid");
    card.querySelector('[data-act="apply"]').addEventListener("click", () =>
      applyRoutineToToday(rid),
    );
    card.querySelector('[data-act="edit"]').addEventListener("click", () =>
      openRoutineEditor(rid),
    );
    card.querySelector('[data-act="dup"]').addEventListener("click", () =>
      duplicateRoutine(rid),
    );
    card.querySelector('[data-act="del"]').addEventListener("click", () =>
      deleteRoutine(rid),
    );
  });
}

function applyRoutineToToday(rid) {
  const r = state.data.routines[rid];
  if (!r) return;
  const date = state.selectedDate;
  if (!state.data.schedule[date]) state.data.schedule[date] = [];
  r.items.forEach((it) => {
    state.data.schedule[date].push({
      eid: it.eid,
      sets: it.sets ?? 3,
      reps: it.reps ?? "8-12",
      weight: it.weight ?? "",
      rest: it.rest ?? 90,
      notes: "",
      done: false,
      fromRoutine: rid,
    });
  });
  saveData();
  toast(`Rutina "${r.name}" aplicada`);
  renderToday();
}

// ============================================================
// Renderizado — vista BIBLIOTECA
// ============================================================

function renderLibrary() {
  document.getElementById("fab").hidden = true;

  // Chips de categoría
  const cats = Array.from(new Set(state.exercises.map((e) => e.category))).sort();
  const chipWrap = document.getElementById("filter-chips");
  chipWrap.innerHTML =
    `<div class="chip ${state.library.category === "" ? "active" : ""}" data-cat="">Todas</div>` +
    cats
      .map(
        (c) =>
          `<div class="chip ${state.library.category === c ? "active" : ""}" data-cat="${escapeHTML(c)}">${escapeHTML(CATEGORY_LABELS[c] || c)}</div>`,
      )
      .join("");
  chipWrap.querySelectorAll(".chip").forEach((c) => {
    c.addEventListener("click", () => {
      state.library.category = c.getAttribute("data-cat");
      state.library.visible = 60;
      renderLibrary();
    });
  });

  const q = state.library.q.trim().toLowerCase();
  const filtered = state.exercises.filter((e) => {
    if (state.library.category && e.category !== state.library.category)
      return false;
    if (!q) return true;
    return (
      e.name.toLowerCase().includes(q) ||
      (e.target || "").toLowerCase().includes(q) ||
      (e.muscle_group || "").toLowerCase().includes(q) ||
      (e.equipment || "").toLowerCase().includes(q)
    );
  });

  const slice = filtered.slice(0, state.library.visible);
  const grid = document.getElementById("exercise-grid");
  grid.innerHTML = slice
    .map((e) => {
      const tags = [
        CATEGORY_LABELS[e.category] || e.category,
        EQUIPMENT_LABELS[e.equipment] || e.equipment,
        e.target,
      ]
        .filter(Boolean)
        .slice(0, 2)
        .map((t) => `<span class="tag">${escapeHTML(t)}</span>`)
        .join("");
      return `
      <div class="ex-card" data-id="${e.id}">
        <img loading="lazy" src="${remoteUrl(e.image)}" alt="${escapeHTML(e.name)}" />
        <div class="ex-info">
          <div class="ex-name">${escapeHTML(e.name)}</div>
          <div class="ex-tags">${tags}</div>
        </div>
      </div>
    `;
    })
    .join("");

  grid.querySelectorAll(".ex-card").forEach((el) => {
    el.addEventListener("click", () =>
      openExerciseDetail(el.getAttribute("data-id")),
    );
  });

  // Infinite scroll
  const loading = document.getElementById("loading-more");
  loading.hidden = slice.length >= filtered.length;
  if (loading.hidden) {
    const sentinel = loading;
    if (sentinel._io) sentinel._io.disconnect();
    sentinel._io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          state.library.visible += 60;
          renderLibrary();
        }
      },
      { rootMargin: "200px" },
    );
    sentinel._io.observe(sentinel);
  }
}

// ============================================================
// Renderizado — vista AJUSTES
// ============================================================

function renderSettings() {
  document.getElementById("fab").hidden = true;
  const s = state.data.settings;
  document.getElementById("set-reminders").checked = !!s.reminders;
  document.getElementById("set-reminder-time").value = s.reminderTime || "18:00";

  const dp = document.getElementById("set-reminder-days");
  dp.innerHTML = DAYS_ES.map(
    (d, i) =>
      `<div class="day-pill ${s.reminderDays.includes(i) ? "active" : ""}" data-i="${i}">${d}</div>`,
  ).join("");
  dp.querySelectorAll(".day-pill").forEach((p) => {
    p.addEventListener("click", () => {
      const i = Number(p.getAttribute("data-i"));
      const arr = s.reminderDays;
      const idx = arr.indexOf(i);
      if (idx >= 0) arr.splice(idx, 1);
      else arr.push(i);
      arr.sort();
      saveData();
      renderSettings();
      scheduleAllReminders();
    });
  });

  updateNotifStatusText();
}

function updateNotifStatusText() {
  const el = document.getElementById("notif-status");
  if (!("Notification" in window)) {
    el.textContent = "Notificaciones no soportadas en este navegador.";
    return;
  }
  const p = Notification.permission;
  if (p === "granted") el.textContent = "Permiso concedido ✓";
  else if (p === "denied") el.textContent =
    "Permiso bloqueado. Actívalo en los ajustes del navegador.";
  else el.textContent = "Permiso no solicitado todavía.";
}

// ============================================================
// Modales
// ============================================================

function openModal(id) {
  document.getElementById(id).hidden = false;
  document.body.style.overflow = "hidden";
}
function closeModal(id) {
  document.getElementById(id).hidden = true;
  document.body.style.overflow = "";
}
function closeAllModals() {
  document.querySelectorAll(".modal").forEach((m) => (m.hidden = true));
  document.body.style.overflow = "";
}

// Modal: detalle ejercicio
function openExerciseDetail(id) {
  const ex = state.exercisesById.get(id);
  if (!ex) return;
  const body = document.getElementById("modal-exercise-body");
  body.classList.add("ex-detail-body");
  body.innerHTML = `
    <div class="ex-detail">
      <img class="gif" loading="lazy" src="${remoteUrl(ex.gif_url)}" alt="${escapeHTML(ex.name)}" />
      <div class="ex-info-side">
        <div class="ex-title">${escapeHTML(ex.name)}</div>
        <div class="ex-tags">
          <span class="tag acc">${escapeHTML(CATEGORY_LABELS[ex.category] || ex.category)}</span>
          <span class="tag">${escapeHTML(EQUIPMENT_LABELS[ex.equipment] || ex.equipment)}</span>
          <span class="tag">Target: ${escapeHTML(ex.target || "—")}</span>
          ${ex.muscle_group ? `<span class="tag">${escapeHTML(ex.muscle_group)}</span>` : ""}
        </div>
        ${renderSteps(ex)}
        <div class="btn-row right" style="margin-top: 16px;">
          <button class="btn ghost" data-close>Cerrar</button>
          <button class="btn primary" id="detail-add">+ Añadir a ${fmtShort(state.selectedDate)}</button>
        </div>
      </div>
    </div>
  `;
  body.querySelectorAll("[data-close]").forEach((b) =>
    b.addEventListener("click", () => closeModal("modal-exercise")),
  );
  body.querySelector("#detail-add")?.addEventListener("click", () => {
    closeModal("modal-exercise");
    openAddModal(ex.id);
  });
  openModal("modal-exercise");
}

function renderSteps(ex) {
  // El dataset tiene pasos en EN/IT/TR. Mostramos EN (los pasos más detallados);
  // usuarios hispanohablantes los entienden bien. Si están disponibles, los mostramos.
  const steps = ex.instruction_steps?.en || [];
  const fallback = ex.instructions?.en || "";
  if (steps.length) {
    return `<ol class="steps">${steps.map((s) => `<li>${escapeHTML(s)}</li>`).join("")}</ol>`;
  }
  return `<p>${escapeHTML(fallback)}</p>`;
}

// Modal: añadir/editar ejercicio al día
let addModalContext = { mode: "add", idx: -1, eid: null };

function openAddModal(eid) {
  addModalContext = { mode: "add", idx: -1, eid: eid || null };
  document.getElementById("modal-add-title").textContent = "Añadir ejercicio";
  document.getElementById("add-search").value = "";
  document.getElementById("add-sets").value = 3;
  document.getElementById("add-reps").value = "8-12";
  document.getElementById("add-weight").value = "";
  document.getElementById("add-rest").value = 90;
  document.getElementById("add-notes").value = "";
  renderPicker("");
  if (eid) {
    const ex = state.exercisesById.get(eid);
    if (ex) {
      document.getElementById("add-search").value = ex.name;
      renderPicker("", eid);
    }
  }
  openModal("modal-add");
  setTimeout(() => document.getElementById("add-search").focus(), 50);
}

function editDayItem(idx) {
  const items = state.data.schedule[state.selectedDate] || [];
  const it = items[idx];
  if (!it) return;
  addModalContext = { mode: "edit", idx, eid: it.eid };
  document.getElementById("modal-add-title").textContent = "Editar ejercicio";
  const ex = state.exercisesById.get(it.eid);
  document.getElementById("add-search").value = ex ? ex.name : "";
  renderPicker("", it.eid);
  document.getElementById("add-sets").value = it.sets ?? 3;
  document.getElementById("add-reps").value = it.reps ?? "";
  document.getElementById("add-weight").value = it.weight ?? "";
  document.getElementById("add-rest").value = it.rest ?? 90;
  document.getElementById("add-notes").value = it.notes ?? "";
  openModal("modal-add");
}

function renderPicker(query, preferId) {
  const list = document.getElementById("add-picker");
  const q = (query || "").trim().toLowerCase();
  let res;
  if (!q && preferId) {
    res = state.exercises.filter((e) => e.id === preferId);
  } else {
    res = state.exercises
      .filter((e) =>
        !q
          ? true
          : e.name.toLowerCase().includes(q) ||
            (e.target || "").toLowerCase().includes(q) ||
            (e.muscle_group || "").toLowerCase().includes(q),
      )
      .slice(0, 30);
  }
  list.innerHTML = res
    .map(
      (e) => `
      <div class="picker-item" data-id="${e.id}">
        <img loading="lazy" src="${remoteUrl(e.image)}" alt="" />
        <div>
          <div class="pi-name">${escapeHTML(e.name)}</div>
          <div class="pi-meta">${escapeHTML(CATEGORY_LABELS[e.category] || e.category)} · ${escapeHTML(EQUIPMENT_LABELS[e.equipment] || e.equipment)}</div>
        </div>
      </div>`,
    )
    .join("");
  list.querySelectorAll(".picker-item").forEach((el) => {
    el.addEventListener("click", () => {
      addModalContext.eid = el.getAttribute("data-id");
      const ex = state.exercisesById.get(addModalContext.eid);
      if (ex) {
        document.getElementById("add-search").value = ex.name;
        list.querySelectorAll(".picker-item").forEach((x) =>
          x.style.background = "",
        );
        el.style.background = "var(--accent-soft)";
      }
    });
  });
}

function saveAddModal() {
  const eid = addModalContext.eid;
  if (!eid) {
    toast("Selecciona un ejercicio de la lista");
    return;
  }
  const item = {
    eid,
    sets: Number(document.getElementById("add-sets").value) || 3,
    reps: document.getElementById("add-reps").value || "8-12",
    weight: document.getElementById("add-weight").value || "",
    rest: Number(document.getElementById("add-rest").value) || 0,
    notes: document.getElementById("add-notes").value || "",
    done: false,
  };
  if (!state.data.schedule[state.selectedDate])
    state.data.schedule[state.selectedDate] = [];
  if (addModalContext.mode === "edit") {
    const old = state.data.schedule[state.selectedDate][addModalContext.idx];
    item.done = old ? old.done : false;
    state.data.schedule[state.selectedDate][addModalContext.idx] = item;
  } else {
    state.data.schedule[state.selectedDate].push(item);
  }
  saveData();
  closeModal("modal-add");
  renderToday();
}

function removeDayItem(idx) {
  const date = state.selectedDate;
  if (!state.data.schedule[date]) return;
  if (!confirm("¿Quitar este ejercicio?")) return;
  state.data.schedule[date].splice(idx, 1);
  if (state.data.schedule[date].length === 0)
    delete state.data.schedule[date];
  saveData();
  renderToday();
}

function toggleDone(idx) {
  const date = state.selectedDate;
  if (!state.data.schedule[date]) return;
  state.data.schedule[date][idx].done =
    !state.data.schedule[date][idx].done;
  saveData();
  renderToday();
}

// ============================================================
// Editor de rutinas
// ============================================================

function newRoutine() {
  const rid = "r" + Math.random().toString(36).slice(2, 9);
  state.data.routines[rid] = { name: "Nueva rutina", items: [] };
  saveData();
  openRoutineEditor(rid);
}

function deleteRoutine(rid) {
  if (!confirm("¿Borrar esta rutina?")) return;
  delete state.data.routines[rid];
  saveData();
  renderRoutines();
}

function duplicateRoutine(rid) {
  const r = state.data.routines[rid];
  if (!r) return;
  const nid = "r" + Math.random().toString(36).slice(2, 9);
  state.data.routines[nid] = {
    name: r.name + " (copia)",
    items: JSON.parse(JSON.stringify(r.items || [])),
  };
  saveData();
  renderRoutines();
}

function openRoutineEditor(rid) {
  const r = state.data.routines[rid];
  if (!r) return;
  const body = document.getElementById("modal-routine-body");
  body.innerHTML = `
    <h3>Rutina</h3>
    <div class="form-row">
      <label>Nombre</label>
      <input id="re-name" type="text" value="${escapeHTML(r.name || "")}" />
    </div>
    <div class="form-row">
      <label>Añadir ejercicio</label>
      <input id="re-search" type="search" placeholder="Buscar…" />
    </div>
    <div id="re-picker" class="picker-list"></div>
    <hr/>
    <h4>Ejercicios</h4>
    <div id="re-items"></div>
    <div class="btn-row right" style="margin-top:16px;">
      <button class="btn ghost" data-close>Cancelar</button>
      <button class="btn primary" id="re-save">Guardar</button>
    </div>
  `;
  body.querySelectorAll("[data-close]").forEach((b) =>
    b.addEventListener("click", () => closeModal("modal-routine")),
  );
  const renderItems = () => {
    const wrap = body.querySelector("#re-items");
    if (!r.items.length) {
      wrap.innerHTML = `<p class="muted">Sin ejercicios. Añade arriba.</p>`;
      return;
    }
    wrap.innerHTML = r.items
      .map(
        (it, i) => `
      <div class="day-item" data-i="${i}">
        <div class="info">
          <div class="name">${escapeHTML(state.exercisesById.get(it.eid)?.name || "?")}</div>
          <div class="meta">
            <span class="pill">${it.sets}×${escapeHTML(it.reps || "")}</span>
            ${it.weight ? `<span class="pill">${escapeHTML(it.weight)}</span>` : ""}
          </div>
        </div>
        <div class="actions">
          <button class="mini-btn del" data-act="up" title="Subir">↑</button>
          <button class="mini-btn del" data-act="down" title="Bajar">↓</button>
          <button class="mini-btn del" data-act="rm" title="Quitar">×</button>
        </div>
      </div>
    `,
      )
      .join("");
    wrap.querySelectorAll(".day-item").forEach((el) => {
      const i = Number(el.getAttribute("data-i"));
      el.querySelector('[data-act="up"]').addEventListener("click", () => {
        if (i > 0) [r.items[i - 1], r.items[i]] = [r.items[i], r.items[i - 1]];
        renderItems();
      });
      el.querySelector('[data-act="down"]').addEventListener("click", () => {
        if (i < r.items.length - 1)
          [r.items[i + 1], r.items[i]] = [r.items[i], r.items[i + 1]];
        renderItems();
      });
      el.querySelector('[data-act="rm"]').addEventListener("click", () => {
        r.items.splice(i, 1);
        renderItems();
      });
    });
  };
  const renderPicker = (q) => {
    const picker = body.querySelector("#re-picker");
    const qq = (q || "").trim().toLowerCase();
    const res = state.exercises
      .filter(
        (e) =>
          !qq ||
          e.name.toLowerCase().includes(qq) ||
          (e.target || "").toLowerCase().includes(qq),
      )
      .slice(0, 30);
    picker.innerHTML = res
      .map(
        (e) => `
        <div class="picker-item" data-id="${e.id}">
          <img src="${remoteUrl(e.image)}" loading="lazy" alt="" />
          <div>
            <div class="pi-name">${escapeHTML(e.name)}</div>
            <div class="pi-meta">${escapeHTML(CATEGORY_LABELS[e.category] || e.category)}</div>
          </div>
        </div>`,
      )
      .join("");
    picker.querySelectorAll(".picker-item").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.getAttribute("data-id");
        r.items.push({ eid: id, sets: 3, reps: "8-12", weight: "" });
        renderItems();
        toast("Añadido");
      });
    });
  };
  body.querySelector("#re-search").addEventListener("input", (ev) =>
    renderPicker(ev.target.value),
  );
  body.querySelector("#re-save").addEventListener("click", () => {
    r.name = body.querySelector("#re-name").value.trim() || "Sin nombre";
    saveData();
    closeModal("modal-routine");
    renderRoutines();
    toast("Rutina guardada");
  });
  renderItems();
  renderPicker("");
  openModal("modal-routine");
}

// ============================================================
// Notificaciones
// ============================================================

async function ensureNotifPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const p = await Notification.requestPermission();
  return p === "granted";
}

async function showNotificationNow(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  if (navigator.serviceWorker?.controller) {
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification(title, {
      body,
      icon: "assets/icons/icon-192.png",
      badge: "assets/icons/icon-192.png",
      tag: "gym-reminder",
      renotify: true,
    });
  } else {
    new Notification(title, { body, icon: "assets/icons/icon-192.png" });
  }
}

function clearAllReminders() {
  state.reminderTimers.forEach((t) => clearTimeout(t));
  state.reminderTimers = [];
}

function scheduleAllReminders() {
  clearAllReminders();
  const s = state.data.settings;
  if (!s.reminders) return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const [hh, mm] = (s.reminderTime || "18:00").split(":").map(Number);

  // Para los próximos 14 días, programa los que coincidan con día seleccionado
  const today = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    if (!s.reminderDays.includes(d.getDay())) continue;
    const target = new Date(d);
    target.setHours(hh, mm, 0, 0);
    const ms = target.getTime() - Date.now();
    if (ms < 0) continue;
    if (ms > 2147483647) continue; // setTimeout max
    const isoDate = toISODate(d);
    const t = setTimeout(async () => {
      const items = state.data.schedule[isoDate] || [];
      if (items.length === 0) {
        showNotificationNow(
          "🏋️ Hoy toca entrenar",
          "No tienes ejercicios programados. ¿Descanso activo o añadimos algo?",
        );
      } else {
        const exNames = items
          .slice(0, 3)
          .map(
            (it) => state.exercisesById.get(it.eid)?.name || "ejercicio",
          )
          .join(", ");
        const more = items.length > 3 ? ` y ${items.length - 3} más` : "";
        showNotificationNow(
          "🏋️ Hora de entrenar",
          `${items.length} ejercicios: ${exNames}${more}`,
        );
      }
    }, ms);
    state.reminderTimers.push(t);
  }
  console.log(
    `[CalendarioGym] ${state.reminderTimers.length} recordatorios programados`,
  );
}

// ============================================================
// Export / Import
// ============================================================

function exportData() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date()
    .toISOString()
    .replace(/[:T]/g, "-")
    .slice(0, 16);
  a.href = url;
  a.download = `calendariogym-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("Backup descargado");
}

function importDataFromFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const obj = JSON.parse(e.target.result);
      if (!obj.schedule || !obj.routines) throw new Error("Formato inválido");
      if (
        !confirm(
          "Esto reemplazará todos los datos actuales. ¿Continuar?",
        )
      )
        return;
      obj.version = obj.version || SCHEMA_VERSION;
      if (!obj.settings) obj.settings = defaultData().settings;
      state.data = obj;
      saveData();
      toast("Datos importados ✓");
      renderToday();
      renderRoutines();
      renderSettings();
      scheduleAllReminders();
    } catch (err) {
      alert("Archivo no válido: " + err.message);
    }
  };
  reader.readAsText(file);
}

// ============================================================
// Navegación
// ============================================================

function switchView(name) {
  state.view = name;
  document.querySelectorAll(".view").forEach((v) => {
    v.hidden = v.getAttribute("data-view") !== name;
  });
  // Sincroniza bottom-nav (móvil/tablet) y sidebar (escritorio)
  document.querySelectorAll(".nav-btn, .sidebar-link").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-nav") === name);
  });
  const fab = document.getElementById("fab");
  fab.hidden = name !== "today";

  if (name === "today") renderToday();
  else if (name === "calendar") renderCalendar();
  else if (name === "routines") renderRoutines();
  else if (name === "library") renderLibrary();
  else if (name === "settings") renderSettings();
}

// ============================================================
// Helpers
// ============================================================

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

let toastTimer = null;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2200);
}

// ============================================================
// Wire-up
// ============================================================

async function init() {
  await loadExercises();

  // Topbar navegación de día
  document.getElementById("btn-prev").addEventListener("click", () => {
    state.selectedDate = addDays(state.selectedDate, -1);
    state.weekAnchor = weekStart(state.selectedDate);
    if (state.view === "today") renderToday();
    else renderCalendar();
  });
  document.getElementById("btn-next").addEventListener("click", () => {
    state.selectedDate = addDays(state.selectedDate, 1);
    state.weekAnchor = weekStart(state.selectedDate);
    if (state.view === "today") renderToday();
    else renderCalendar();
  });
  document.getElementById("btn-today").addEventListener("click", () => {
    state.selectedDate = todayISO();
    state.weekAnchor = weekStart(state.selectedDate);
    switchView("today");
  });

  // Bottom nav + sidebar links
  document.querySelectorAll(".nav-btn, .sidebar-link").forEach((b) => {
    b.addEventListener("click", () => switchView(b.getAttribute("data-nav")));
  });

  // FAB → añadir ejercicio al día
  document.getElementById("fab").addEventListener("click", () => openAddModal());

  // Atajo sidebar: + Ejercicio hoy
  document
    .querySelector('.sidebar [data-action="add-exercise"]')
    ?.addEventListener("click", () => {
      switchView("today");
      openAddModal();
    });

  // Atajo sidebar: ✨ Autorutina
  document
    .querySelector('.sidebar [data-action="auto-routine"]')
    ?.addEventListener("click", () => openAutoRoutineModal());

  // Vista rutinas: ✨ Autorutina
  document
    .getElementById("btn-auto-routine")
    ?.addEventListener("click", () => openAutoRoutineModal());

  // Semana
  document
    .getElementById("cal-prev-week")
    .addEventListener("click", () => {
      state.weekAnchor = addDays(state.weekAnchor, -7);
      renderCalendar();
    });
  document
    .getElementById("cal-next-week")
    .addEventListener("click", () => {
      state.weekAnchor = addDays(state.weekAnchor, 7);
      renderCalendar();
    });

  // Empty state acciones
  document.querySelectorAll('[data-action="add-exercise"]').forEach((b) =>
    b.addEventListener("click", () => openAddModal()),
  );
  document.querySelectorAll('[data-action="apply-template"]').forEach((b) =>
    b.addEventListener("click", () => openTemplatePicker()),
  );

  // Biblioteca — buscador
  let searchTimer;
  document.getElementById("search-input").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.library.q = e.target.value;
      state.library.visible = 60;
      renderLibrary();
    }, 150);
  });

  // Modal add
  document.getElementById("add-search").addEventListener("input", (e) => {
    renderPicker(e.target.value);
  });
  document.getElementById("add-save").addEventListener("click", saveAddModal);

  // Cerrar modales
  document.querySelectorAll("[data-close]").forEach((el) =>
    el.addEventListener("click", () => closeAllModals()),
  );

  // Rutinas — nueva
  document
    .getElementById("btn-new-routine")
    .addEventListener("click", newRoutine);

  // Ajustes
  document
    .getElementById("set-reminders")
    .addEventListener("change", async (e) => {
      if (e.target.checked) {
        const ok = await ensureNotifPermission();
        if (!ok) {
          e.target.checked = false;
          toast("Permiso de notificaciones denegado");
          updateNotifStatusText();
          return;
        }
      }
      state.data.settings.reminders = e.target.checked;
      saveData();
      scheduleAllReminders();
      updateNotifStatusText();
    });
  document
    .getElementById("set-reminder-time")
    .addEventListener("change", (e) => {
      state.data.settings.reminderTime = e.target.value;
      saveData();
      scheduleAllReminders();
    });
  document
    .getElementById("btn-test-notif")
    .addEventListener("click", async () => {
      const ok = await ensureNotifPermission();
      if (!ok) {
        toast("Sin permiso para notificar");
        return;
      }
      showNotificationNow(
        "🏋️ CalendarioGym",
        "Notificación de prueba. ¡A por ello!",
      );
    });

  // Export / Import
  document.getElementById("btn-export").addEventListener("click", exportData);
  document.getElementById("btn-import").addEventListener("click", () =>
    document.getElementById("import-file").click(),
  );
  document
    .getElementById("import-file")
    .addEventListener("change", (e) => {
      const f = e.target.files?.[0];
      if (f) importDataFromFile(f);
      e.target.value = "";
    });
  document.getElementById("btn-clear").addEventListener("click", () => {
    if (
      !confirm(
        "¿BORRAR todos los días, rutinas y ajustes? Esta acción no se puede deshacer.",
      )
    )
      return;
    state.data = defaultData();
    saveData();
    toast("Datos borrados");
    renderToday();
    renderSettings();
    scheduleAllReminders();
  });

  // Service worker (PWA + background)
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("sw.js")
      .catch((e) => console.warn("SW register failed", e));
  }

  // Programar recordatorios si los tenía activos
  scheduleAllReminders();

  // Render inicial
  switchView("today");

  // Reprograma cada 30 min por si la app queda abierta mucho tiempo
  setInterval(scheduleAllReminders, 30 * 60 * 1000);
}

// ============================================================
// Autorutina — modal + apply
// ============================================================

function openAutoRoutineModal() {
  const weeks = AUTO_ROUTINE.weeks;
  const selectedDays = new Set(AUTO_ROUTINE.days.map((d) => d.dow)); // por defecto L-M-X-J

  const renderPreview = () => {
    // En orden cronológico
    const ordered = [...selectedDays].sort((a, b) => a - b);
    const list = ordered
      .map((dow, i) => {
        const d = AUTO_ROUTINE.days[i] || AUTO_ROUTINE.days[AUTO_ROUTINE.days.length - 1];
        const items = d.exercises
          .map((it) => {
            const ex = state.exercisesById.get(it.eid);
            return ex
              ? `<span class="rex">${escapeHTML(ex.name)} · ${it.sets}×${escapeHTML(it.reps)}</span>`
              : "";
          })
          .join("");
        const totalSets = d.exercises.reduce((s, it) => s + (it.sets || 0), 0);
        return `
          <div class="routine-card" style="margin-bottom: 10px;">
            <div class="rname">${DAYS_LONG_ES[dow]} · ${escapeHTML(d.label)}</div>
            <div class="rmeta">${d.exercises.length} ejercicios · ${totalSets} series</div>
            <div class="rex-list">${items}</div>
          </div>
        `;
      })
      .join("");
    return list || `<p class="muted">Selecciona al menos un día.</p>`;
  };

  const renderDaysPicker = () => {
    return DAYS_ES.map(
      (d, i) =>
        `<div class="day-pill ${selectedDays.has(i) ? "active" : ""}" data-dow="${i}" role="button">${d}</div>`,
    ).join("");
  };

  const renderSummary = () => {
    const ordered = [...selectedDays].sort((a, b) => a - b);
    if (ordered.length === 0)
      return `<p class="muted">Selecciona al menos un día para continuar.</p>`;
    const dates = autoRoutineDatesFor(weeks, ordered);
    const overlaps = autoRoutineOverlapFor(ordered, weeks);
    return `
      <p style="margin: 0;">
        <strong>${dates.length} sesiones</strong> programadas ·
        primer entreno: <strong>${fmtLong(dates[0].isoDate)}</strong>
      </p>
      ${
        overlaps.length
          ? `<p class="muted small" style="margin: 8px 0 0;">
              ⚠️ ${overlaps.length} de esos días ya tienen ejercicios. Se sobrescribirán.
            </p>`
          : `<p class="muted small" style="margin: 8px 0 0;">Los días están vacíos, no se pierde nada.</p>`
      }
    `;
  };

  const body = document.getElementById("modal-auto-body");
  body.innerHTML = `
    <h3>✨ Autorutina</h3>
    <p class="muted">
      Pulsa una vez y te genero las plantillas y las programo durante
      <strong>${weeks} semanas</strong> seguidas.
    </p>

    <div class="card" style="margin: 12px 0;">
      <h4 style="margin-top:0;">📅 Días de entreno</h4>
      <p class="muted small" style="margin: 4px 0 10px;">
        Selecciona los días. Se repetirán cada semana. Los músculos se
        asignan en orden cronológico: Pecho → Piernas → Brazos → Espalda.
      </p>
      <div class="day-picker" id="auto-days">${renderDaysPicker()}</div>
    </div>

    <div class="card" style="margin: 12px 0; padding: 12px;">
      <h4 style="margin-top:0;">📋 Plan semanal</h4>
      <div id="auto-preview">${renderPreview()}</div>
    </div>

    <div class="card" id="auto-summary" style="background: var(--bg-elev-2);">
      ${renderSummary()}
    </div>

    <div class="form-row">
      <label>¿Cuántas semanas?</label>
      <input type="number" id="auto-weeks" min="1" max="12" value="${weeks}" />
    </div>

    <div class="btn-row right" style="margin-top: 16px;">
      <button class="btn ghost" data-close>Cancelar</button>
      <button class="btn primary" id="auto-apply">✨ Aplicar</button>
    </div>
  `;

  body.querySelectorAll("[data-close]").forEach((b) =>
    b.addEventListener("click", () => closeModal("modal-auto")),
  );

  const refresh = () => {
    body.querySelector("#auto-preview").innerHTML = renderPreview();
    body.querySelector("#auto-summary").innerHTML = renderSummary();
    body.querySelector("#auto-days").innerHTML = renderDaysPicker();
    body.querySelectorAll("#auto-days .day-pill").forEach((p) =>
      p.addEventListener("click", onPick),
    );
    const applyBtn = body.querySelector("#auto-apply");
    applyBtn.disabled = selectedDays.size === 0;
    applyBtn.style.opacity = selectedDays.size === 0 ? "0.5" : "1";
  };

  const onPick = (ev) => {
    const dow = Number(ev.currentTarget.getAttribute("data-dow"));
    if (selectedDays.has(dow)) selectedDays.delete(dow);
    else selectedDays.add(dow);
    refresh();
  };

  body.querySelectorAll("#auto-days .day-pill").forEach((p) =>
    p.addEventListener("click", onPick),
  );

  body.querySelector("#auto-weeks").addEventListener("input", (e) => {
    AUTO_ROUTINE.weeks = Math.max(
      1,
      Math.min(12, Number(e.target.value) || 4),
    );
    refresh();
  });

  body.querySelector("#auto-apply").addEventListener("click", () => {
    const ordered = [...selectedDays].sort((a, b) => a - b);
    if (ordered.length === 0) return;
    const w = Math.max(
      1,
      Math.min(12, Number(body.querySelector("#auto-weeks").value) || weeks),
    );
    applyAutoRoutine(w, ordered);
    closeModal("modal-auto");
  });

  refresh();
  openModal("modal-auto");
}

function applyAutoRoutine(weeks, dows) {
  // dows: array de dow (0..6) ya en orden cronológico. Slots por dow.
  // 1) Crear / actualizar las 4 plantillas con el nombre estándar
  for (const d of AUTO_ROUTINE.days) {
    const rid = autoRoutineId(d.label);
    state.data.routines[rid] = {
      name: `💪 ${d.label} (Auto)`,
      items: d.exercises.map((it) => ({
        eid: it.eid,
        sets: it.sets,
        reps: it.reps,
        weight: "",
      })),
    };
  }

  // 2) Aplicar a las próximas N semanas (sobrescribiendo días previos)
  const dates = autoRoutineDatesFor(weeks, dows);
  let filled = 0;
  for (const x of dates) {
    // Cada slot (0,1,2,3...) recibe un músculo distinto del plan (Pecho, Piernas, Brazos, Espalda)
    const muscleIdx = Math.min(x.slotIndex, AUTO_ROUTINE.days.length - 1);
    const d = AUTO_ROUTINE.days[muscleIdx];
    state.data.schedule[x.isoDate] = d.exercises.map((it) => ({
      eid: it.eid,
      sets: it.sets,
      reps: it.reps,
      weight: "",
      rest: 90,
      notes: "",
      done: false,
      fromRoutine: autoRoutineId(d.label),
    }));
    filled++;
  }
  saveData();

  // 3) Re-renderizar y saltar al día actual
  renderRoutines();
  renderToday();
  renderCalendar();
  toast(`✨ ${filled} sesiones listas (${weeks} semanas × ${dows.length} días)`);
}

function openTemplatePicker() {
  const routines = Object.entries(state.data.routines);
  if (routines.length === 0) {
    toast("Crea primero una rutina en la pestaña Rutinas");
    switchView("routines");
    return;
  }
  const body = document.getElementById("modal-routine-body");
  body.innerHTML = `
    <h3>Aplicar rutina</h3>
    <p class="muted">Se añadirán los ejercicios al día ${fmtShort(state.selectedDate)}.</p>
    <div class="routine-list" style="margin-top:12px;">
      ${routines
        .map(
          ([rid, r]) => `
        <div class="routine-card" data-rid="${rid}">
          <div class="rname">${escapeHTML(r.name)}</div>
          <div class="rmeta">${(r.items || []).length} ejercicios</div>
          <div class="ractions">
            <button class="btn primary" data-pick>Aplicar</button>
          </div>
        </div>`,
        )
        .join("")}
    </div>
    <div class="btn-row right" style="margin-top:16px;">
      <button class="btn ghost" data-close>Cerrar</button>
    </div>
  `;
  body.querySelectorAll("[data-close]").forEach((b) =>
    b.addEventListener("click", () => closeModal("modal-routine")),
  );
  body.querySelectorAll(".routine-card").forEach((card) => {
    const rid = card.getAttribute("data-rid");
    card.querySelector("[data-pick]").addEventListener("click", () => {
      applyRoutineToToday(rid);
      closeModal("modal-routine");
    });
  });
  openModal("modal-routine");
}

// Boot
init().catch((e) => {
  console.error(e);
  toast("Error iniciando la app");
});
