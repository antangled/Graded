// Preset store. Today: built-in seeds + localStorage. Tomorrow: swap in Supabase
// behind the same loadAll() / save() / search() API and the UI doesn't change.

// Curated built-in presets. Ship the popular classes with the app so search is
// useful from day one without any backend round trip.
export const BUILTIN_PRESETS = [
  {
    id: 'builtin-math54-serganova',
    name: 'Math 54 - Serganova',
    school: 'UC Berkeley',
    structure: [
      { name: 'Quizzes',   weight: 20, outOf: 120 },
      { name: 'Midterm 1', weight: 20, outOf: 50  },
      { name: 'Midterm 2', weight: 20, outOf: 50  },
      { name: 'Final',     weight: 40, outOf: 90  },
    ],
    builtin: true,
  },
  {
    // EECS 16A — Ayazifar. Lowest-two-dropped HW rule isn't modeled here;
    // students can pre-average their kept homework scores.
    id: 'builtin-eecs16a-ayazifar',
    name: 'EECS 16A - Ayazifar',
    school: 'UC Berkeley',
    structure: [
      { name: 'Homework', weight: 10, outOf: 10  },
      { name: 'Lab',      weight: 20, outOf: 5   },
      { name: 'Exam 1',   weight: 20, outOf: 200 },
      { name: 'Exam 2',   weight: 25, outOf: 200 },
      { name: 'Exam 3',   weight: 25, outOf: 200 },
    ],
    builtin: true,
  },
  {
    // CS61B Track D — weights derived from points / 3000 total.
    id: 'builtin-cs61b-hug',
    name: 'CS 61B - Josh Hug',
    school: 'UC Berkeley',
    structure: [
      { name: 'Weekly Surveys',        weight: 2,     outOf: 60  },
      { name: 'Discussion Attendance', weight: 2.5,   outOf: 75  },
      { name: 'Homeworks',             weight: 4.67,  outOf: 140 },
      { name: 'Mini-Projects',         weight: 10,    outOf: 300 },
      { name: 'Design Projects',       weight: 26.67, outOf: 800 },
      { name: 'Midterm 1',             weight: 7.5,   outOf: 225 },
      { name: 'Midterm 2',             weight: 18.33, outOf: 550 },
      { name: 'Final Exam',            weight: 28.33, outOf: 850 },
    ],
    builtin: true,
  },
];

const USER_KEY = 'graded:user-presets';

function read() {
  if (typeof localStorage === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || '[]');
  } catch {
    return [];
  }
}

function write(presets) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(USER_KEY, JSON.stringify(presets));
}

export function loadUserPresets() {
  return read();
}

// Save (or update if name already exists) a user preset to localStorage.
// Returns the updated full list of user presets.
export function saveUserPreset({ name, structure }) {
  const cleanName = (name || '').trim();
  if (!cleanName) throw new Error('Preset name is required');
  const existing = read();
  const idx = existing.findIndex((p) => p.name.toLowerCase() === cleanName.toLowerCase());
  const preset = {
    id: idx >= 0 ? existing[idx].id : `user-${Date.now()}`,
    name: cleanName,
    structure: structure.map((s) => ({
      name: s.name,
      weight: Number(s.weight) || 0,
      outOf: Number(s.outOf) || 100,
    })),
    builtin: false,
    createdAt: idx >= 0 ? existing[idx].createdAt : new Date().toISOString(),
  };
  if (idx >= 0) existing[idx] = preset;
  else existing.push(preset);
  write(existing);
  return existing;
}

export function deleteUserPreset(id) {
  const updated = read().filter((p) => p.id !== id);
  write(updated);
  return updated;
}

// All presets (built-in + user) sorted with built-ins first.
export function allPresets() {
  return [...BUILTIN_PRESETS, ...read()];
}

// Case-insensitive substring search across name + school.
export function searchPresets(query) {
  const list = allPresets();
  if (!query || !query.trim()) return list;
  const q = query.trim().toLowerCase();
  return list.filter((p) => {
    const hay = `${p.name} ${p.school || ''}`.toLowerCase();
    return hay.includes(q);
  });
}

// -------- named saves (full state with scores) --------
// Distinct from presets: a "save" is a snapshot of the entire rows array
// (including scores, curves, clobbers). Used to switch between full class
// states, e.g. "Math 54 - my grades" vs "CS 61B - my grades".

const SAVES_KEY = 'graded:user-saves';

function readSaves() {
  if (typeof localStorage === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(SAVES_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeSaves(saves) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(SAVES_KEY, JSON.stringify(saves));
}

export function loadUserSaves() {
  return readSaves();
}

export function saveUserSave({ name, rows }) {
  const cleanName = (name || '').trim();
  if (!cleanName) throw new Error('Save name is required');
  const existing = readSaves();
  const idx = existing.findIndex((s) => s.name.toLowerCase() === cleanName.toLowerCase());
  const now = new Date().toISOString();
  const save = {
    id: idx >= 0 ? existing[idx].id : `save-${Date.now()}`,
    name: cleanName,
    rows: rows.map((r) => ({ ...r })),
    createdAt: idx >= 0 ? existing[idx].createdAt : now,
    updatedAt: now,
  };
  if (idx >= 0) existing[idx] = save;
  else existing.push(save);
  writeSaves(existing);
  return existing;
}

export function deleteUserSave(id) {
  const updated = readSaves().filter((s) => s.id !== id);
  writeSaves(updated);
  return updated;
}

// Unified search: returns both presets (structure templates) and named saves
// (full state snapshots), each tagged with `kind` so the UI can pick how to
// load them. Saves appear first since they're the most recent personal work.
export function searchAll(query) {
  const presets = allPresets().map((p) => ({ ...p, kind: 'preset' }));
  const saves = readSaves().map((s) => ({
    id: s.id,
    name: s.name,
    kind: 'save',
    rows: s.rows,
    updatedAt: s.updatedAt,
  }));
  const items = [...saves, ...presets];
  if (!query || !query.trim()) return items;
  const q = query.trim().toLowerCase();
  return items.filter((item) => {
    const hay = `${item.name} ${item.school || ''}`.toLowerCase();
    return hay.includes(q);
  });
}

// -------- auto-save (always-active current state) --------
// Single slot. Persists the live `rows` array so closing and reopening the tab
// restores exactly where the user left off, no button click required.

const CURRENT_KEY = 'graded:current';

export function loadCurrentState() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CURRENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveCurrentState(rows) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CURRENT_KEY, JSON.stringify(rows));
  } catch {}
}

export function clearCurrentState() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(CURRENT_KEY);
}
