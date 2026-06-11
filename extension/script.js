// Tunables
const AUTOSAVE_DEBOUNCE_MS = 500;
const FLUSH_DEBOUNCE_MS = 200;
const DELETE_CONFIRM_MS = 3000;
const PREVIEW_LENGTH = 50;

// Persisted document state (mirrored into browser.storage.local)
let state = {
  notes: [],
  currentNoteId: null
};

// Transient UI state & timers (never persisted)
let saveTimeout = null;
let flushTimer = null;
let deleteConfirmTimeout = null;
let localSaveState = 'saved'; // 'saving' | 'saved' | 'error'
let editEpoch = 0;
let storageReadFailed = false; // true if the initial load threw; blocks saves

// Search (transient): the sidebar filter query and whether the bar is open.
let searchQuery = '';
let isSearchOpen = false;

// Sync flags & cursors
const dirtyNotes = new Set();
const pendingDeletes = new Set();
let isSignedIn = false;
let isSyncing = false;
let syncError = false;
let needsUpgrade = false;
let lastSyncAt = null;

// DOM elements
const sidebar = document.getElementById('sidebar');
const toggleSidebarBtn = document.getElementById('toggleSidebar');
const newNoteBtn = document.getElementById('newNoteBtn');
const notesList = document.getElementById('notesList');
const noteTitle = document.getElementById('noteTitle');
const editor = document.getElementById('editor');
const charCount = document.getElementById('charCount');
const wordCount = document.getElementById('wordCount');
const saveStatus = document.getElementById('saveStatus');
const exportBtn = document.getElementById('exportBtn');
const deleteBtn = document.getElementById('deleteBtn');
const searchBtn = document.getElementById('searchBtn');
const searchBar = document.getElementById('searchBar');
const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');

// Storage functions
async function loadNotes() {
  try {
    const result = await TabMarginStorage.get([
      'notes',
      'currentNoteId',
      'dirtyNoteIds',
      'pendingDeleteIds',
      'lastSyncAt'
    ]);

    if (result.notes && result.notes.length > 0) {
      state.notes = result.notes;
      state.currentNoteId = result.currentNoteId || sortByModified(state.notes)[0].id;
    } else {
      // Create default note if none exist
      const defaultNote = createNewNote();
      state.notes = [defaultNote];
      state.currentNoteId = defaultNote.id;
      await saveNotes();
    }
    loadSyncState(result);
  } catch (error) {
    // A read hiccup is NOT an empty store. Show an in-memory note so the UI is
    // usable, but flag the failure so saveNotes() won't persist this default
    // over the user's real (unread) notes. Surface it via the status channel.
    console.error('Error loading notes:', error);
    storageReadFailed = true;
    const defaultNote = createNewNote();
    state.notes = [defaultNote];
    state.currentNoteId = defaultNote.id;
    updateSaveStatus('error');
  }
}

function loadSyncState(result) {
  dirtyNotes.clear();
  pendingDeletes.clear();
  (result.dirtyNoteIds || []).forEach(id => dirtyNotes.add(id));
  (result.pendingDeleteIds || []).forEach(id => pendingDeletes.add(id));
  lastSyncAt = result.lastSyncAt || null;
}

async function saveSyncState() {
  await TabMarginStorage.set({
    dirtyNoteIds: [...dirtyNotes],
    pendingDeleteIds: [...pendingDeletes],
    lastSyncAt
  });
}

async function saveNotes() {
  // The initial read failed, so we can't trust that state reflects what's on
  // disk — persisting now could clobber real notes. Stay in the error state.
  if (storageReadFailed) {
    updateSaveStatus('error');
    return;
  }
  try {
    await TabMarginStorage.set({
      notes: state.notes,
      currentNoteId: state.currentNoteId,
      dirtyNoteIds: [...dirtyNotes],
      pendingDeleteIds: [...pendingDeletes],
      lastSyncAt
    });
    updateSaveStatus('saved');
    scheduleFlush();
  } catch (error) {
    console.error('Error saving notes:', error);
    updateSaveStatus('error');
  }
}

// Note operations
function createNewNote() {
  return {
    // Collision-resistant id: a bare Date.now() string can repeat for notes
    // created in the same millisecond. base36 time + random suffix stays within
    // the server's id charset and works on the Firefox 79 baseline (no
    // crypto.randomUUID, which needs FF 95+).
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    title: '',
    content: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function addNewNote() {
  // A blank note won't match an active filter; clear search so it's visible.
  if (isSearchOpen) closeSearch();
  const newNote = createNewNote();
  state.notes.unshift(newNote);
  state.currentNoteId = newNote.id;
  dirtyNotes.add(newNote.id);

  renderNotesList();
  loadCurrentNote();
  saveNotes();
  noteTitle.focus();
}

function getCurrentNote() {
  return state.notes.find(note => note.id === state.currentNoteId);
}

function updateCurrentNote() {
  const currentNote = getCurrentNote();
  if (!currentNote) return;
  const nextTitle = noteTitle.value.trim();
  const nextContent = editor.value;
  if (currentNote.title === nextTitle && currentNote.content === nextContent) return;
  currentNote.title = nextTitle;
  currentNote.content = nextContent;
  currentNote.updatedAt = new Date().toISOString();
  dirtyNotes.add(currentNote.id);
  // Bump on every real edit so an in-flight pull can tell whether the user typed
  // during its await and avoid clobbering the live editor (see pullAndMerge).
  editEpoch++;
}

function switchNote(noteId) {
  updateCurrentNote();
  // Refresh the note we're leaving in the sidebar (its edits may not have been
  // flushed by the autosave debounce yet) before moving the highlight.
  updateActiveNoteListItem();
  if (deleteConfirmTimeout) resetDeleteConfirm();

  state.currentNoteId = noteId;
  loadCurrentNote();
  saveNotes();
}

function resetDeleteConfirm() {
  deleteBtn.classList.remove('confirming');
  deleteBtn.setAttribute('aria-label', 'Delete note');
  clearTimeout(deleteConfirmTimeout);
  deleteConfirmTimeout = null;
}

function performDelete() {
  resetDeleteConfirm();

  if (state.notes.length === 1) {
    const currentNote = getCurrentNote();
    currentNote.title = '';
    currentNote.content = '';
    currentNote.updatedAt = new Date().toISOString();
    dirtyNotes.add(currentNote.id);
    noteTitle.value = '';
    editor.value = '';
    updateStats();
    renderNotesList();
    saveNotes();
    return;
  }

  const deletedId = state.currentNoteId;
  // Select the note that takes the deleted one's place in the visible (sorted)
  // list, so the selection follows what the user sees.
  const slot = getVisibleNotes().findIndex(note => note.id === deletedId);
  state.notes = state.notes.filter(note => note.id !== deletedId);
  const visibleAfter = getVisibleNotes();
  const next = visibleAfter[Math.min(slot, visibleAfter.length - 1)] || state.notes[0];
  state.currentNoteId = next.id;

  pendingDeletes.add(deletedId);
  dirtyNotes.delete(deletedId);

  renderNotesList();
  loadCurrentNote();
  saveNotes();
}

function deleteCurrentNote() {
  if (deleteBtn.classList.contains('confirming')) {
    performDelete();
    return;
  }

  deleteBtn.classList.add('confirming');
  // Update the accessible name so AT users perceive the "really?" confirm state
  // (the CSS-only label swap is invisible to screen readers).
  deleteBtn.setAttribute('aria-label', 'Confirm delete note');
  deleteConfirmTimeout = setTimeout(resetDeleteConfirm, DELETE_CONFIRM_MS);
}

// UI functions

// Blank titles are stored as '' — show a placeholder in the sidebar (the title
// input has its own HTML placeholder), so a note literally named "Untitled Note"
// stays distinct from an untitled one.
function noteListTitle(note) {
  return note.title || 'Untitled';
}

function loadCurrentNote() {
  const currentNote = getCurrentNote();
  if (currentNote) {
    noteTitle.value = currentNote.title;
    editor.value = currentNote.content;
    updateStats();
    setActiveNoteItem();
  }
}

// Move the .active highlight without rebuilding the list (used on note switch).
function setActiveNoteItem() {
  for (const item of notesList.children) {
    const isActive = item.dataset.noteId === state.currentNoteId;
    item.classList.toggle('active', isActive);
    if (isActive) item.setAttribute('aria-current', 'true');
    else item.removeAttribute('aria-current');
  }
}

// Most-recently-modified first. Returns a new array — state.notes keeps its own
// order (sync/merge/persistence rely on it); the sidebar is just a sorted view.
function modifiedTime(note) {
  return new Date(note.updatedAt || note.createdAt || 0).getTime() || 0;
}

function sortByModified(notes) {
  return notes.slice().sort((a, b) => modifiedTime(b) - modifiedTime(a));
}

// ---- Search ----
// Notes shown in the sidebar, ordered by last modified. With a query, title
// matches rank above body-only matches; each group is sorted by recency.
function getVisibleNotes() {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return sortByModified(state.notes);
  const titleMatches = [];
  const bodyMatches = [];
  for (const note of state.notes) {
    if (note.title.toLowerCase().includes(q)) titleMatches.push(note);
    else if (note.content.toLowerCase().includes(q)) bodyMatches.push(note);
  }
  return [...sortByModified(titleMatches), ...sortByModified(bodyMatches)];
}

// Render `text` into `el`, wrapping each case-insensitive run of `query` in a
// <mark>. Built from text nodes (never innerHTML) so note content can't inject
// markup.
function setHighlightedText(el, text, query) {
  el.textContent = '';
  const q = query.trim().toLowerCase();
  const lower = text.toLowerCase();
  let idx = q ? lower.indexOf(q) : -1;
  if (idx === -1) { el.textContent = text; return; }
  let from = 0;
  while (idx !== -1) {
    if (idx > from) el.appendChild(document.createTextNode(text.slice(from, idx)));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(idx, idx + q.length);
    el.appendChild(mark);
    from = idx + q.length;
    idx = lower.indexOf(q, from);
  }
  if (from < text.length) el.appendChild(document.createTextNode(text.slice(from)));
}

// For a body-only match, show a window of content around the first hit (rather
// than the note's opening line) so the match is visible in the preview.
function previewSnippet(content, query) {
  const q = query.trim().toLowerCase();
  const idx = content.toLowerCase().indexOf(q);
  if (idx <= 0 || !q) return content.substring(0, PREVIEW_LENGTH);
  const start = Math.max(0, idx - 10);
  return (start > 0 ? '…' : '') + content.substring(start, start + PREVIEW_LENGTH);
}

// Full rebuild — reserved for add/delete/merge/search, where the set or order of
// visible notes changes. Clicks are handled by one delegated listener on
// #notesList (see init), so we don't re-bind per item here.
function renderNotesList() {
  notesList.innerHTML = '';

  const visible = getVisibleNotes();
  const q = searchQuery.trim().toLowerCase();

  if (visible.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'notes-empty';
    empty.textContent = 'No matching notes';
    notesList.appendChild(empty);
    return;
  }

  visible.forEach(note => {
    // A real <button> so the notes list is keyboard-operable (Tab to focus,
    // Enter/Space to switch — both fire the delegated click handler natively)
    // and announced as a button to assistive tech. aria-current marks the open
    // note. Children are <span>s: a <button> may only contain phrasing content.
    const noteItem = document.createElement('button');
    noteItem.type = 'button';
    noteItem.className = 'note-item';
    noteItem.dataset.noteId = note.id;
    if (note.id === state.currentNoteId) {
      noteItem.classList.add('active');
      noteItem.setAttribute('aria-current', 'true');
    }

    const titleMatched = q && note.title.toLowerCase().includes(q);

    const title = document.createElement('span');
    title.className = 'note-item-title';
    if (titleMatched) setHighlightedText(title, noteListTitle(note), q);
    else title.textContent = noteListTitle(note);

    const preview = document.createElement('span');
    preview.className = 'note-item-preview';
    // A body-only match shows a highlighted snippet around the hit; otherwise the
    // usual leading preview.
    if (q && !titleMatched && note.content.toLowerCase().includes(q)) {
      setHighlightedText(preview, previewSnippet(note.content, q) || 'Empty note', q);
    } else {
      preview.textContent = note.content.substring(0, PREVIEW_LENGTH) || 'Empty note';
    }

    noteItem.appendChild(title);
    noteItem.appendChild(preview);
    notesList.appendChild(noteItem);
  });
}

function updateActiveNoteListItem() {
  const currentNote = getCurrentNote();
  if (!currentNote) return;
  // A search filter can change which notes match and their ranking — rebuild the
  // filtered list instead of patching one row.
  if (searchQuery.trim()) { renderNotesList(); return; }
  // Last-modified order: an edited note belongs at the top. If it's already the
  // first row, refresh its text in place (the hot path while typing); otherwise
  // rebuild so it rises.
  const first = notesList.firstElementChild;
  if (first && first.dataset.noteId === currentNote.id) {
    first.querySelector('.note-item-title').textContent = noteListTitle(currentNote);
    first.querySelector('.note-item-preview').textContent =
      currentNote.content.substring(0, PREVIEW_LENGTH) || 'Empty note';
    return;
  }
  renderNotesList();
}

// ---- Search bar open/close ----
function openSearch() {
  isSearchOpen = true;
  searchBar.hidden = false;
  searchBtn.setAttribute('aria-expanded', 'true');
  // Reveal the sidebar if it's collapsed — otherwise the results are hidden.
  if (sidebar.classList.contains('hidden')) {
    sidebar.classList.remove('hidden');
    toggleSidebarBtn.setAttribute('aria-expanded', 'true');
  }
  searchInput.focus();
  searchInput.select();
}

function closeSearch() {
  const hadQuery = searchQuery !== '';
  isSearchOpen = false;
  searchBar.hidden = true;
  searchBtn.setAttribute('aria-expanded', 'false');
  searchQuery = '';
  searchInput.value = '';
  if (hadQuery) renderNotesList();
  editor.focus();
}

// Cmd/Ctrl+K: open the bar, or just refocus it if already open — never closes.
function focusSearch() {
  if (!isSearchOpen) {
    openSearch();
  } else {
    searchInput.focus();
    searchInput.select();
  }
}

function updateStats() {
  const text = editor.value;
  const chars = text.length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  charCount.textContent = `${chars} character${chars !== 1 ? 's' : ''}`;
  wordCount.textContent = `${words} word${words !== 1 ? 's' : ''}`;
}

function updateSaveStatus(status) {
  localSaveState = status;
  renderStatus();
}

function renderStatus() {
  saveStatus.classList.remove('saving', 'saved', 'error', 'synced');

  if (localSaveState === 'error') {
    saveStatus.textContent = 'Error saving';
    saveStatus.classList.add('error');
    return;
  }
  if (localSaveState === 'saving') {
    saveStatus.textContent = 'Saving';
    saveStatus.classList.add('saving');
    return;
  }
  if (!isSignedIn) {
    saveStatus.textContent = 'Saved';
    saveStatus.classList.add('saved');
    return;
  }
  if (needsUpgrade) {
    saveStatus.textContent = 'Upgrade to sync';
    saveStatus.classList.add('error');
    return;
  }
  if (syncError) {
    saveStatus.textContent = 'Sync error';
    saveStatus.classList.add('error');
    return;
  }
  if (isSyncing || dirtyNotes.size > 0 || pendingDeletes.size > 0) {
    saveStatus.textContent = 'Syncing';
    saveStatus.classList.add('saving');
    return;
  }
  saveStatus.textContent = 'Synced';
  saveStatus.classList.add('saved', 'synced');
}

// Auto-save with debouncing
function autoSave() {
  updateSaveStatus('saving');

  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    updateCurrentNote();
    updateActiveNoteListItem();
    saveNotes();
  }, AUTOSAVE_DEBOUNCE_MS);
}

// Export functionality
function exportNote() {
  const currentNote = getCurrentNote();
  if (!currentNote) return;

  // Sanitize the title into a safe, predictable filename: strip path/reserved
  // chars (/ \ : * ? " < > |) and control chars, collapse whitespace.
  const base = (currentNote.title || 'note')
    .replace(/[\/\\:*?"<>|\x00-\x1f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'note';

  const blob = new Blob([currentNote.content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${base}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---- Sync engine ----
function scheduleFlush() {
  if (!isSignedIn) return;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flushPending, FLUSH_DEBOUNCE_MS);
}

async function flushPending() {
  if (!isSignedIn) return;
  if (isSyncing) return;
  if (dirtyNotes.size === 0 && pendingDeletes.size === 0) return;

  isSyncing = true;
  renderStatus();

  let hadFailure = false;
  let hitUpgrade = false;

  for (const id of [...pendingDeletes]) {
    if (hitUpgrade) break;
    try {
      await TabMarginAPI.deleteRemoteNote(id);
      pendingDeletes.delete(id);
      await saveSyncState();
    } catch (err) {
      if (err.status === 402) { hitUpgrade = true; break; }
      console.error('Delete failed for', id, err);
      hadFailure = true;
    }
  }

  for (const id of [...dirtyNotes]) {
    if (hitUpgrade) break;
    const note = state.notes.find(n => n.id === id);
    if (!note) {
      dirtyNotes.delete(id);
      continue;
    }
    // Snapshot what we send. The note object is mutated in place by
    // updateCurrentNote(), so a keystroke landing during this await would
    // otherwise have its dirty flag cleared below and never get pushed.
    const pushedTitle = note.title;
    const pushedContent = note.content;
    try {
      const result = await TabMarginAPI.pushNote(note);
      const editedDuringPush =
        note.title !== pushedTitle || note.content !== pushedContent;
      if (editedDuringPush) {
        // Leave it dirty so the next flush re-pushes the newer content, and
        // don't apply the server timestamps — the local copy is now ahead.
        continue;
      }
      if (result.note) {
        note.createdAt = result.note.created_at;
        note.updatedAt = result.note.updated_at;
        lastSyncAt = maxIso(lastSyncAt, result.note.updated_at);
      }
      dirtyNotes.delete(id);
      await saveNotes();
    } catch (err) {
      if (err.status === 402) { hitUpgrade = true; break; }
      console.error('Push failed for', id, err);
      hadFailure = true;
    }
  }

  isSyncing = false;
  needsUpgrade = hitUpgrade;
  syncError = hadFailure && !hitUpgrade;
  renderStatus();

  // Re-push notes left dirty by a mid-flight edit. Guarded on no failures so a
  // persistent network error doesn't hot-loop the 200ms flush.
  if (!hitUpgrade && !hadFailure && dirtyNotes.size > 0) scheduleFlush();
}

async function pullAndMerge() {
  if (!isSignedIn || isSyncing) return;

  // capture any in-flight edits so LWW keeps the user's current typing
  updateCurrentNote();
  const epochAtPull = editEpoch;

  isSyncing = true;
  syncError = false;
  renderStatus();

  try {
    const remoteNotes = await TabMarginAPI.fetchRemoteNotes(lastSyncAt);
    needsUpgrade = false;
    // Flush anything typed *during* the await into state (and mark it dirty) so
    // the merge treats the current note as a local edit instead of overwriting it.
    updateCurrentNote();
    mergeRemote(remoteNotes);
    for (const remote of remoteNotes) {
      lastSyncAt = maxIso(lastSyncAt, remote.updated_at);
    }
    await TabMarginStorage.set({
      notes: state.notes,
      currentNoteId: state.currentNoteId,
      dirtyNoteIds: [...dirtyNotes],
      pendingDeleteIds: [...pendingDeletes],
      lastSyncAt
    });
    // renderNotesList already refreshed the list + active highlight. Only reset
    // the editor from state if the user hasn't typed since the pull began;
    // otherwise leave their live text untouched (state already matches it).
    renderNotesList();
    if (editEpoch === epochAtPull) {
      loadCurrentNote();
    }
  } catch (err) {
    console.error('Pull failed:', err);
    if (err.status === 402) {
      needsUpgrade = true;
    } else {
      syncError = true;
    }
  } finally {
    isSyncing = false;
    renderStatus();
  }

  if (!needsUpgrade) await flushPending();
}

function mergeRemote(remoteNotes) {
  const merged = TabMarginSync.mergeRemoteNotes({
    notes: state.notes,
    currentNoteId: state.currentNoteId,
    remoteNotes,
    dirtyNoteIds: [...dirtyNotes],
    pendingDeleteIds: [...pendingDeletes],
    createFallbackNote: createNewNote
  });

  state.notes = merged.notes;
  state.currentNoteId = merged.currentNoteId;
  dirtyNotes.clear();
  merged.dirtyNoteIds.forEach(id => dirtyNotes.add(id));
}

function maxIso(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

async function refreshAuthState() {
  const session = await TabMarginAPI.getSession();
  const wasSignedIn = isSignedIn;
  isSignedIn = !!session;

  if (isSignedIn && !wasSignedIn) {
    if (!lastSyncAt && dirtyNotes.size === 0 && pendingDeletes.size === 0) {
      state.notes.forEach(note => dirtyNotes.add(note.id));
      await saveSyncState();
    }
    pullAndMerge();
  } else if (!isSignedIn && wasSignedIn) {
    dirtyNotes.clear();
    pendingDeletes.clear();
    syncError = false;
    needsUpgrade = false;
    await saveSyncState();
  }
  renderStatus();
}

// Event listeners
toggleSidebarBtn.addEventListener('click', () => {
  const hidden = sidebar.classList.toggle('hidden');
  toggleSidebarBtn.setAttribute('aria-expanded', String(!hidden));
});

newNoteBtn.addEventListener('click', addNewNote);

// Delegated: one listener for the whole list instead of re-binding per item on
// every render.
notesList.addEventListener('click', (e) => {
  const item = e.target.closest('.note-item');
  if (item && notesList.contains(item)) switchNote(item.dataset.noteId);
});

noteTitle.addEventListener('input', () => {
  updateStats();
  autoSave();
});

editor.addEventListener('input', () => {
  updateStats();
  autoSave();
});

exportBtn.addEventListener('click', exportNote);
deleteBtn.addEventListener('click', deleteCurrentNote);

searchBtn.addEventListener('click', () => {
  if (isSearchOpen) closeSearch();
  else openSearch();
});

searchClear.addEventListener('click', closeSearch);

searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value;
  renderNotesList();
});

// Enter jumps to the top result and drops focus into the editor.
searchInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const first = notesList.querySelector('.note-item');
  if (!first) return;
  switchNote(first.dataset.noteId);
  editor.focus();
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Esc closes the search bar from anywhere (no modifier).
  if (e.key === 'Escape' && isSearchOpen) {
    e.preventDefault();
    closeSearch();
    return;
  }

  const mod = e.ctrlKey || e.metaKey;
  if (!mod || e.repeat || e.altKey) return;
  const key = e.key.toLowerCase();

  // Ctrl/Cmd + K: open / focus the notes search.
  if (key === 'k') {
    e.preventDefault();
    focusSearch();
    return;
  }

  // Ctrl/Cmd + Shift + L: New note. (Ctrl/Cmd+N is reserved by the browser for
  // New Window and fires unreliably, so we keep the new-note shortcut off it.)
  if (e.shiftKey && key === 'l') {
    e.preventDefault();
    addNewNote();
    return;
  }

  if (e.shiftKey) return; // remaining shortcuts are unshifted

  // Ctrl/Cmd + S: Manual save (already auto-saving, but for user comfort)
  if (key === 's') {
    e.preventDefault();
    updateCurrentNote();
    saveNotes();
  }

  // Ctrl/Cmd + E: Export
  if (key === 'e') {
    e.preventDefault();
    exportNote();
  }
});

// Theme management
async function loadTheme() {
  try {
    const result = await TabMarginStorage.get('theme');
    const theme = result.theme || 'system';
    applyTheme(theme);
  } catch (error) {
    console.error('Error loading theme:', error);
    applyTheme('system');
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

// Listen for theme + auth changes from settings popup
TabMarginStorage.onChanged((changes, area) => {
  if (area !== 'local') return;
  if (changes.theme) {
    applyTheme(changes.theme.newValue);
  }
  if (changes.auth) {
    refreshAuthState();
  }
});

// Pull on window focus when signed in
window.addEventListener('focus', () => {
  if (isSignedIn) pullAndMerge();
});

// Initialize
async function init() {
  await loadTheme();
  await loadNotes();
  renderNotesList();
  loadCurrentNote();
  editor.focus();

  // refreshAuthState fires pullAndMerge in the background when signed in
  await refreshAuthState();
}

// Expose the editor's entry points so the web shell (app.js) can boot it after
// login and re-check auth in the active tab (where the storage event doesn't
// fire). The extension doesn't use these — it boots immediately below.
window.TabMarginEditor = { init, refreshAuthState };

// Start the application. The web build sets TabMarginEnv.deferInit so app.js can
// gate the editor behind sign-in; the extension leaves it unset and boots now.
if (!window.TabMarginEnv?.deferInit) init();
