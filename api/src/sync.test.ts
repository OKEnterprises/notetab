import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { mergeRemoteNotes, mergeLocalSnapshot } = require('../../extension/sync.js')

function fallbackNote() {
  return {
    id: 'fresh',
    title: 'Untitled Note',
    content: '',
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: '2026-05-27T00:00:00.000Z',
  }
}

describe('sync merge helper', () => {
  it('removes local notes when a remote tombstone arrives', () => {
    const result = mergeRemoteNotes({
      notes: [{
        id: 'note_1',
        title: 'Title',
        content: 'Body',
        createdAt: '2026-05-27T00:00:00.000Z',
        updatedAt: '2026-05-27T00:00:00.000Z',
      }],
      currentNoteId: 'note_1',
      remoteNotes: [{
        id: 'note_1',
        updated_at: '2026-05-27T00:01:00.000Z',
        deleted_at: '2026-05-27T00:01:00.000Z',
      }],
      dirtyNoteIds: [],
      createFallbackNote: fallbackNote,
    })

    expect(result.notes).toEqual([fallbackNote()])
    expect(result.dirtyNoteIds).toEqual(['fresh'])
  })

  it('keeps explicitly dirty local notes when remote absence is unknown', () => {
    const result = mergeRemoteNotes({
      notes: [{
        id: 'local_1',
        title: 'Local',
        content: 'Draft',
        createdAt: '2026-05-27T00:00:00.000Z',
        updatedAt: '2026-05-27T00:02:00.000Z',
      }],
      currentNoteId: 'local_1',
      remoteNotes: [],
      dirtyNoteIds: ['local_1'],
      createFallbackNote: fallbackNote,
    })

    expect(result.notes[0].id).toBe('local_1')
    expect(result.dirtyNoteIds).toEqual(['local_1'])
  })

  it('does not mark clean local notes dirty just because the remote response omits them', () => {
    const result = mergeRemoteNotes({
      notes: [{
        id: 'local_1',
        title: 'Local',
        content: 'Draft',
        createdAt: '2026-05-27T00:00:00.000Z',
        updatedAt: '2026-05-27T00:02:00.000Z',
      }],
      currentNoteId: 'local_1',
      remoteNotes: [],
      dirtyNoteIds: [],
      createFallbackNote: fallbackNote,
    })

    expect(result.notes[0].id).toBe('local_1')
    expect(result.dirtyNoteIds).toEqual([])
  })

  it('uses server timestamps when accepting remote changes', () => {
    const result = mergeRemoteNotes({
      notes: [{
        id: 'note_1',
        title: 'Old',
        content: 'Old',
        createdAt: '2026-05-27T00:00:00.000Z',
        updatedAt: '2026-05-27T00:00:00.000Z',
      }],
      currentNoteId: 'note_1',
      remoteNotes: [{
        id: 'note_1',
        title: 'New',
        content: 'New',
        created_at: '2026-05-27T00:00:00.000Z',
        updated_at: '2026-05-27T00:10:00.000Z',
        deleted_at: null,
      }],
      dirtyNoteIds: [],
      createFallbackNote: fallbackNote,
    })

    expect(result.notes[0].title).toBe('New')
    expect(result.notes[0].updatedAt).toBe('2026-05-27T00:10:00.000Z')
  })

  it('does not resurrect a note whose delete is still pending locally', () => {
    // The note is already gone locally; the inclusive `since` cursor re-returns
    // the still-live remote row. With it in pendingDeleteIds the merge must drop it.
    const result = mergeRemoteNotes({
      notes: [{
        id: 'keep_1',
        title: 'Keep',
        content: 'Body',
        createdAt: '2026-05-27T00:00:00.000Z',
        updatedAt: '2026-05-27T00:00:00.000Z',
      }],
      currentNoteId: 'keep_1',
      remoteNotes: [{
        id: 'gone_1',
        title: 'Zombie',
        content: 'Back from the dead',
        created_at: '2026-05-27T00:00:00.000Z',
        updated_at: '2026-05-27T00:05:00.000Z',
        deleted_at: null,
      }],
      dirtyNoteIds: [],
      pendingDeleteIds: ['gone_1'],
      createFallbackNote: fallbackNote,
    })

    expect(result.notes.map((n: { id: string }) => n.id)).toEqual(['keep_1'])
  })

  it('does not resurrect deleted notes when a later tombstone is present', () => {
    const result = mergeRemoteNotes({
      notes: [],
      currentNoteId: 'note_1',
      remoteNotes: [{
        id: 'note_1',
        updated_at: '2026-05-27T00:10:00.000Z',
        deleted_at: '2026-05-27T00:10:00.000Z',
      }],
      dirtyNoteIds: [],
      createFallbackNote: fallbackNote,
    })

    expect(result.notes).toEqual([fallbackNote()])
    expect(result.currentNoteId).toBe('fresh')
  })
})

// Cross-tab adoption: another tab persisted a full snapshot; reconcile it with
// this tab's in-memory state (see script.js adoptExternalSnapshot).
describe('local snapshot merge helper', () => {
  function note(id: string, updatedAt: string, content = `body of ${id}`) {
    return {
      id,
      title: `title of ${id}`,
      content,
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt,
    }
  }

  const baseArgs = {
    currentNoteId: 'a',
    snapshotCurrentNoteId: 'a',
    dirtyNoteIds: [],
    snapshotDirtyNoteIds: [],
    pendingDeleteIds: [],
    snapshotPendingDeleteIds: [],
    createFallbackNote: fallbackNote,
  }

  it('adopts the snapshot copy when it is newer than the local one', () => {
    const result = mergeLocalSnapshot({
      ...baseArgs,
      localNotes: [note('a', '2026-06-01T00:00:00.000Z', 'stale')],
      snapshotNotes: [note('a', '2026-06-01T00:05:00.000Z', 'fresh')],
    })

    expect(result.notes[0].content).toBe('fresh')
    expect(result.changed).toBe(false)
  })

  it('keeps the local copy when it is strictly newer (in-flight typing)', () => {
    const result = mergeLocalSnapshot({
      ...baseArgs,
      localNotes: [note('a', '2026-06-01T00:10:00.000Z', 'mine, newer')],
      snapshotNotes: [note('a', '2026-06-01T00:05:00.000Z', 'theirs')],
    })

    expect(result.notes[0].content).toBe('mine, newer')
    expect(result.changed).toBe(true)
  })

  it('adopts notes the other tab created and drops clean notes it deleted', () => {
    const result = mergeLocalSnapshot({
      ...baseArgs,
      localNotes: [note('a', '2026-06-01T00:00:00.000Z'), note('gone', '2026-06-01T00:00:00.000Z')],
      snapshotNotes: [note('a', '2026-06-01T00:00:00.000Z'), note('new', '2026-06-01T00:06:00.000Z')],
      snapshotPendingDeleteIds: ['gone'],
    })

    expect(result.notes.map((n: { id: string }) => n.id).sort()).toEqual(['a', 'new'])
  })

  it('resurrects a locally-dirty note missing from the snapshot (creation race)', () => {
    const result = mergeLocalSnapshot({
      ...baseArgs,
      localNotes: [note('a', '2026-06-01T00:00:00.000Z'), note('draft', '2026-06-01T00:07:00.000Z')],
      snapshotNotes: [note('a', '2026-06-01T00:00:00.000Z')],
      dirtyNoteIds: ['draft'],
    })

    expect(result.notes.map((n: { id: string }) => n.id)).toEqual(['draft', 'a'])
    expect(result.changed).toBe(true)
  })

  it('lets an explicit local delete win over the snapshot still carrying the note', () => {
    const result = mergeLocalSnapshot({
      ...baseArgs,
      localNotes: [note('a', '2026-06-01T00:00:00.000Z')],
      snapshotNotes: [note('a', '2026-06-01T00:00:00.000Z'), note('deleted-here', '2026-06-01T00:09:00.000Z')],
      pendingDeleteIds: ['deleted-here'],
    })

    expect(result.notes.map((n: { id: string }) => n.id)).toEqual(['a'])
    expect(result.changed).toBe(true)
    expect(result.pendingDeleteIds).toContain('deleted-here')
  })

  it('falls back to the snapshot current note when the local one disappeared', () => {
    const result = mergeLocalSnapshot({
      ...baseArgs,
      currentNoteId: 'gone',
      snapshotCurrentNoteId: 'b',
      localNotes: [note('gone', '2026-06-01T00:00:00.000Z')],
      snapshotNotes: [note('b', '2026-06-01T00:01:00.000Z')],
      snapshotPendingDeleteIds: ['gone'],
    })

    expect(result.currentNoteId).toBe('b')
  })

  it('creates a fallback note when everything was deleted', () => {
    const result = mergeLocalSnapshot({
      ...baseArgs,
      localNotes: [note('a', '2026-06-01T00:00:00.000Z')],
      snapshotNotes: [],
      snapshotPendingDeleteIds: ['a'],
    })

    expect(result.notes).toEqual([fallbackNote()])
    expect(result.currentNoteId).toBe('fresh')
    expect(result.dirtyNoteIds).toContain('fresh')
  })
})
