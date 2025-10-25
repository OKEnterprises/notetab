# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NoteTab is a Firefox extension (Manifest v2) that replaces the new tab page with a minimalist notepad. Users can create multiple notes, which are auto-saved and persist using the browser's local storage API.

## Architecture

### Core Components

**Main Application (`newtab.html`, `script.js`, `styles.css`)**
- `newtab.html`: Single-page application with sidebar, editor, and status bar
- `script.js`: Manages state (notes array, current note ID), handles auto-save with 500ms debounce, and listens for theme changes via `browser.storage.onChanged`
- `styles.css`: Theme system using CSS custom properties with three modes: system (default), light, and dark

**Settings Popup (`popup.html`, `popup.js`, `popup.css`)**
- Accessible via toolbar icon click
- Saves theme preference to `browser.storage.local`
- Changes propagate instantly to all open tabs via storage listener

**Storage Schema**
```javascript
{
  notes: [
    {
      id: "timestamp-string",
      title: "string",
      content: "string",
      createdAt: "ISO-8601",
      updatedAt: "ISO-8601"
    }
  ],
  currentNoteId: "timestamp-string",
  theme: "system" | "light" | "dark"
}
```

### Theme System Implementation

The theme system uses a data attribute approach:
- `script.js` sets `document.documentElement.setAttribute('data-theme', theme)` on load and when changed
- `styles.css` defines CSS custom properties for three states:
  - `:root` - base light theme
  - `:root[data-theme="dark"]` - forced dark
  - `:root[data-theme="light"]` - forced light (overrides system preference)
  - `@media (prefers-color-scheme: dark)` with `:root:not([data-theme="light"])` - system dark mode

SVG icon colors are adjusted using CSS filter properties that change based on theme.

### Key Design Decisions

- **No build step**: Plain HTML/CSS/JS for simplicity
- **Monospace font throughout**: Applied to `body` and cascades to all elements
- **Auto-save timing**: 500ms debounce prevents excessive writes
- **Sidebar behavior**: Uses `display: none` when hidden (not transform) to avoid animation overlap bugs
- **Default note**: Always creates one note on first run; never allows zero notes

## Development Workflow

### Testing the Extension

Load in Firefox for development:
1. Navigate to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `manifest.json` from the project directory
4. Open a new tab to see the extension
5. Changes require clicking "Reload" in about:debugging

### Making Changes

When modifying theme behavior, remember that changes must be coordinated across three files:
- `styles.css`: CSS custom properties and icon filters
- `script.js`: Theme loading and `data-theme` attribute management
- `popup.js`: Theme preference UI and storage

When adding new SVG icons, ensure they have appropriate CSS filters defined for both light and dark modes.

## File Structure

- `manifest.json` - Extension metadata, permissions, and entry points
- `newtab.html` - Main notepad UI structure
- `script.js` - Notes management, auto-save, and theme application
- `styles.css` - Complete styling including theme system
- `popup.html/css/js` - Settings popup for theme selection
- `icons/*.svg` - SVG icons (notes, download, trash)
