# NoteTab

A minimalist Firefox extension that transforms your new tab page into a persistent notepad. Perfect for quick notes, drafts, and ideas that you want to keep close at hand while browsing.

## Features

NoteTab provides a distraction-free writing environment directly in your browser. Create multiple notes that are automatically saved as you type, eliminating the worry of losing your thoughts. The extension features real-time character and word counting, making it ideal for writers who need to track their progress. Every note can be exported as a plain text file with a single click, and the entire interface uses a clean monospace font for a focused, code-editor-like experience.

The extension includes a customizable theme system accessible from the toolbar icon. Choose between light mode, dark mode, or let the extension automatically match your system preferences. Theme changes apply instantly across all tabs and persist between browser sessions. The collapsible sidebar keeps your notes organized without cluttering the writing space.

## Installation
OK Notetab 1.0.0 can be installed from https://addons.mozilla.org/en-US/firefox/addon/ok-notetab/

## Usage

When you open a new tab, you'll see the NoteTab interface with a clean editor and sidebar. Click the "+" button in the sidebar to create new notes, or select existing notes from the list to switch between them. All changes are automatically saved 500ms after you stop typing, indicated by the "Saved" status in the bottom bar.

Use the export icon (download) to save any note as a `.txt` file, or the trash icon to delete the current note. The sidebar can be toggled on and off using the menu icon (☰) in the top-left corner. Character and word counts update in real-time as you type, displayed in the status bar at the bottom of the page.

To change themes, click the NoteTab icon in your Firefox toolbar. Select your preferred theme from the popup menu: System will follow your OS theme settings, while Light and Dark will force the extension to use that specific theme regardless of your system preferences.

## Development

NoteTab is built with vanilla HTML, CSS, and JavaScript—no build tools or dependencies required. The extension uses Firefox's WebExtensions API (Manifest v2) for storage and browser integration. All notes are stored locally using `browser.storage.local`, ensuring your data never leaves your device.

The codebase consists of two main components: the new tab page (`newtab.html`, `script.js`, `styles.css`) and the settings popup (`popup.html`, `popup.js`, `popup.css`). The theme system uses CSS custom properties with a data attribute on the document root, allowing for seamless switching between themes. SVG icons are dynamically colored using CSS filters that adapt to the current theme.

After making changes to the code, reload the extension from `about:debugging` to see your updates. The simplicity of the architecture makes it easy to extend with new features or customize to your preferences.
