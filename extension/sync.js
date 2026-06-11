(function (root) {
  function remoteToLocal(remote) {
    return {
      id: remote.id,
      // Keep blank titles blank; the UI renders a placeholder rather than a
      // stored "Untitled Note" sentinel (see updateCurrentNote / renderNotesList).
      title: remote.title ?? '',
      content: remote.content || '',
      createdAt: remote.created_at,
      updatedAt: remote.updated_at
    };
  }

  function sortNotes(notes) {
    return [...notes].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  function mergeRemoteNotes({ notes, currentNoteId, remoteNotes, dirtyNoteIds, pendingDeleteIds, createFallbackNote }) {
    const byId = new Map(notes.map(note => [note.id, note]));
    const dirty = new Set(dirtyNoteIds);
    const pendingDelete = new Set(pendingDeleteIds);
    let nextCurrentNoteId = currentNoteId;

    for (const remote of remoteNotes) {
      // A delete we've queued but not yet confirmed: the note is already gone
      // locally, and the inclusive `since` cursor commonly re-returns the still
      // -live row. Skip it so it doesn't resurrect before the delete lands.
      if (pendingDelete.has(remote.id)) {
        byId.delete(remote.id);
        continue;
      }

      if (remote.deleted_at) {
        byId.delete(remote.id);
        dirty.delete(remote.id);
        continue;
      }

      const local = byId.get(remote.id);
      if (!local) {
        byId.set(remote.id, remoteToLocal(remote));
        continue;
      }

      if (dirty.has(remote.id)) continue;

      const localTime = new Date(local.updatedAt).getTime();
      const remoteTime = new Date(remote.updated_at).getTime();
      if (remoteTime >= localTime) {
        byId.set(remote.id, remoteToLocal(remote));
      }
    }

    let nextNotes = sortNotes(byId.values());
    if (nextNotes.length === 0) {
      const fresh = createFallbackNote();
      nextNotes = [fresh];
      nextCurrentNoteId = fresh.id;
      dirty.add(fresh.id);
    } else if (!nextNotes.find(note => note.id === nextCurrentNoteId)) {
      nextCurrentNoteId = nextNotes[0].id;
    }

    return {
      notes: nextNotes,
      currentNoteId: nextCurrentNoteId,
      dirtyNoteIds: [...dirty],
    };
  }

  // Reconcile this tab's in-memory state with a full snapshot another tab just
  // persisted (storage is whole-array last-writer-wins, so without this a stale
  // tab's next save would clobber the other tab's edits). The snapshot is the
  // baseline; a local copy survives only when it is strictly newer (in-flight
  // typing) — and a note missing from the snapshot only when we hold unsaved
  // (dirty) edits to it. Explicit deletes (pendingDeleteIds, either side) always
  // win over concurrent edits. Returns changed=true when the result differs
  // from the snapshot, i.e. the caller should re-persist.
  function mergeLocalSnapshot({
    localNotes, snapshotNotes,
    currentNoteId, snapshotCurrentNoteId,
    dirtyNoteIds, snapshotDirtyNoteIds,
    pendingDeleteIds, snapshotPendingDeleteIds,
    createFallbackNote
  }) {
    const localById = new Map(localNotes.map(note => [note.id, note]));
    const localDirty = new Set(dirtyNoteIds);
    const dirty = new Set([...dirtyNoteIds, ...snapshotDirtyNoteIds]);
    const pendingDeletes = new Set([...pendingDeleteIds, ...snapshotPendingDeleteIds]);

    let changed = false;
    const seen = new Set();
    // Keep the snapshot's order (it's the canonical persisted order); notes we
    // resurrect below are unshifted to the front like freshly created ones.
    const merged = [];

    for (const snap of snapshotNotes) {
      seen.add(snap.id);
      if (pendingDeletes.has(snap.id)) {
        // Deleted here but the snapshot writer hadn't seen the delete yet.
        changed = true;
        continue;
      }
      const local = localById.get(snap.id);
      if (local && new Date(local.updatedAt).getTime() > new Date(snap.updatedAt).getTime()) {
        merged.push(local);
        if (local.title !== snap.title || local.content !== snap.content) changed = true;
      } else {
        merged.push(snap);
      }
    }

    for (const local of localNotes) {
      if (seen.has(local.id) || pendingDeletes.has(local.id)) continue;
      // Missing from the snapshot without a tombstone: the writer never had it
      // (creation race). Resurrect only what we have unsaved edits to — a clean
      // local copy missing from the snapshot was deleted-and-flushed elsewhere.
      if (localDirty.has(local.id)) {
        merged.unshift(local);
        changed = true;
      }
    }

    let nextCurrentNoteId = currentNoteId;
    if (!merged.find(note => note.id === nextCurrentNoteId)) {
      nextCurrentNoteId =
        merged.find(note => note.id === snapshotCurrentNoteId)?.id ?? merged[0]?.id ?? null;
    }
    if (merged.length === 0) {
      const fresh = createFallbackNote();
      merged.push(fresh);
      nextCurrentNoteId = fresh.id;
      dirty.add(fresh.id);
      changed = true;
    }

    // Drop dirty flags for notes that no longer exist.
    const mergedIds = new Set(merged.map(note => note.id));
    const dirtyNoteIdsOut = [...dirty].filter(id => mergedIds.has(id));

    return {
      notes: merged,
      currentNoteId: nextCurrentNoteId,
      dirtyNoteIds: dirtyNoteIdsOut,
      pendingDeleteIds: [...pendingDeletes],
      changed,
    };
  }

  const api = { mergeRemoteNotes, mergeLocalSnapshot, remoteToLocal };
  root.TabMarginSync = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
