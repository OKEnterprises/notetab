// State management
let state = {
  notes: [],
  currentNoteId: null,
  saveTimeout: null
};

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

// Storage functions
async function loadNotes() {
  try {
    const result = await browser.storage.local.get(['notes', 'currentNoteId']);

    if (result.notes && result.notes.length > 0) {
      state.notes = result.notes;
      state.currentNoteId = result.currentNoteId || state.notes[0].id;
    } else {
      // Create default note if none exist
      const defaultNote = createNewNote();
      state.notes = [defaultNote];
      state.currentNoteId = defaultNote.id;
      await saveNotes();
    }
  } catch (error) {
    console.error('Error loading notes:', error);
    // Create default note on error
    const defaultNote = createNewNote();
    state.notes = [defaultNote];
    state.currentNoteId = defaultNote.id;
  }
}

async function saveNotes() {
  try {
    await browser.storage.local.set({
      notes: state.notes,
      currentNoteId: state.currentNoteId
    });
    updateSaveStatus('saved');
  } catch (error) {
    console.error('Error saving notes:', error);
    updateSaveStatus('error');
  }
}

// Note operations
function createNewNote() {
  return {
    id: Date.now().toString(),
    title: 'Untitled Note',
    content: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function addNewNote() {
  const newNote = createNewNote();
  state.notes.unshift(newNote);
  state.currentNoteId = newNote.id;

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
  if (currentNote) {
    currentNote.title = noteTitle.value.trim() || 'Untitled Note';
    currentNote.content = editor.value;
    currentNote.updatedAt = new Date().toISOString();
  }
}

function switchNote(noteId) {
  // Save current note before switching
  updateCurrentNote();

  state.currentNoteId = noteId;
  loadCurrentNote();
  saveNotes();
}

function deleteCurrentNote() {
  if (state.notes.length === 1) {
    // Don't delete the last note, just clear it
    const currentNote = getCurrentNote();
    currentNote.title = 'Untitled Note';
    currentNote.content = '';
    noteTitle.value = '';
    editor.value = '';
    updateStats();
    saveNotes();
    return;
  }

  const confirmed = confirm('Are you sure you want to delete this note?');
  if (!confirmed) return;

  const currentIndex = state.notes.findIndex(note => note.id === state.currentNoteId);
  state.notes = state.notes.filter(note => note.id !== state.currentNoteId);

  // Switch to next note or previous if at end
  const newIndex = currentIndex >= state.notes.length ? state.notes.length - 1 : currentIndex;
  state.currentNoteId = state.notes[newIndex].id;

  renderNotesList();
  loadCurrentNote();
  saveNotes();
}

// UI functions
function loadCurrentNote() {
  const currentNote = getCurrentNote();
  if (currentNote) {
    noteTitle.value = currentNote.title === 'Untitled Note' ? '' : currentNote.title;
    editor.value = currentNote.content;
    updateStats();
    renderNotesList();
  }
}

function renderNotesList() {
  notesList.innerHTML = '';

  state.notes.forEach(note => {
    const noteItem = document.createElement('div');
    noteItem.className = 'note-item';
    if (note.id === state.currentNoteId) {
      noteItem.classList.add('active');
    }

    const title = document.createElement('div');
    title.className = 'note-item-title';
    title.textContent = note.title;

    const preview = document.createElement('div');
    preview.className = 'note-item-preview';
    preview.textContent = note.content.substring(0, 50) || 'Empty note';

    noteItem.appendChild(title);
    noteItem.appendChild(preview);

    noteItem.addEventListener('click', () => switchNote(note.id));
    notesList.appendChild(noteItem);
  });
}

function updateStats() {
  const text = editor.value;
  const chars = text.length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  charCount.textContent = `${chars} character${chars !== 1 ? 's' : ''}`;
  wordCount.textContent = `${words} word${words !== 1 ? 's' : ''}`;
}

function updateSaveStatus(status) {
  if (status === 'saving') {
    saveStatus.textContent = 'Saving...';
    saveStatus.classList.add('saving');
  } else if (status === 'saved') {
    saveStatus.textContent = 'Saved';
    saveStatus.classList.remove('saving');
  } else if (status === 'error') {
    saveStatus.textContent = 'Error saving';
    saveStatus.classList.remove('saving');
  }
}

// Auto-save with debouncing
function autoSave() {
  updateSaveStatus('saving');

  clearTimeout(state.saveTimeout);
  state.saveTimeout = setTimeout(() => {
    updateCurrentNote();
    renderNotesList();
    saveNotes();
  }, 500); // Save 500ms after user stops typing
}

// Export functionality
function exportNote() {
  const currentNote = getCurrentNote();
  if (!currentNote) return;

  const blob = new Blob([currentNote.content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${currentNote.title}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Event listeners
toggleSidebarBtn.addEventListener('click', () => {
  sidebar.classList.toggle('hidden');
});

newNoteBtn.addEventListener('click', addNewNote);

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

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Ctrl/Cmd + N: New note
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    addNewNote();
  }

  // Ctrl/Cmd + S: Manual save (already auto-saving, but for user comfort)
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    updateCurrentNote();
    saveNotes();
  }

  // Ctrl/Cmd + E: Export
  if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
    e.preventDefault();
    exportNote();
  }
});

// Theme management
async function loadTheme() {
  try {
    const result = await browser.storage.local.get('theme');
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

// Listen for theme changes from settings
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.theme) {
    applyTheme(changes.theme.newValue);
  }
});

// Initialize
async function init() {
  await loadTheme();
  await loadNotes();
  loadCurrentNote();
  editor.focus();
}

// Start the application
init();
