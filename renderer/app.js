import { EditorState, RangeSetBuilder } from '@codemirror/state';
import {
  EditorView,
  ViewPlugin,
  Decoration,
  drawSelection,
  keymap,
} from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxTree, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { tags } from '@lezer/highlight';

// ============================================================
// MARKDOWN SYNTAX-HIDING PLUGIN
// Hides markdown markers on every line except the one the cursor is on.
// Heading font sizes are applied via CSS classes on the .cm-line element.
// ============================================================

// Inline marker nodes we want to replace with nothing (hide)
const INLINE_MARKS = new Set([
  'EmphasisMark', // * _ ** __
  'CodeMark',     // ` (only inside InlineCode; fenced ``` handled below)
  'LinkMark',     // [ ] ( )
  'StrikethroughMark',
]);

// For headings we want to hide "# " including the trailing space
const HEADING_MARK = 'HeaderMark';

// Blockquote ">" — we hide these too (border-left shows the quote visually)
const QUOTE_MARK = 'QuoteMark';

// List markers "- " / "* " / "1. " — hidden; a CSS ::before can be added later
const LIST_MARK = 'ListMark';

function getActiveLinesSet(state) {
  const active = new Set();
  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from).number;
    const toLine   = state.doc.lineAt(range.to).number;
    for (let n = fromLine; n <= toLine; n++) active.add(n);
  }
  return active;
}

function buildSyntaxDecorations(view) {
  const { state } = view;
  const activeLines = getActiveLinesSet(state);
  const ranges = [];

  syntaxTree(state).iterate({
    enter(node) {
      const lineNo = state.doc.lineAt(node.from).number;
      if (activeLines.has(lineNo)) return; // show raw syntax on active lines

      // --- Heading marker ---
      if (node.name === HEADING_MARK) {
        let to = node.to;
        // Include the space that follows "#"
        if (to < state.doc.length && state.doc.sliceString(to, to + 1) === ' ') to++;
        ranges.push([node.from, to]);
        return;
      }

      // --- Inline code mark: only hide when inside InlineCode (not FencedCode) ---
      if (node.name === 'CodeMark') {
        if (node.parent?.name === 'InlineCode') {
          ranges.push([node.from, node.to]);
        }
        return;
      }

      // --- URL inside a Link: hide the (url) including parens ---
      if (node.name === 'URL' && node.parent?.name === 'Link') {
        // The URL node sits between LinkMark ")" chars; hide it
        ranges.push([node.from, node.to]);
        return;
      }

      if (INLINE_MARKS.has(node.name)) {
        ranges.push([node.from, node.to]);
        return;
      }

      if (node.name === QUOTE_MARK) {
        let to = node.to;
        if (to < state.doc.length && state.doc.sliceString(to, to + 1) === ' ') to++;
        ranges.push([node.from, to]);
        return;
      }

      if (node.name === LIST_MARK) {
        let to = node.to;
        if (to < state.doc.length && state.doc.sliceString(to, to + 1) === ' ') to++;
        ranges.push([node.from, to]);
        return;
      }
    },
  });

  // Sort by start position (syntaxTree iterates in document order, but nested
  // nodes can interleave — sort defensively to satisfy RangeSetBuilder)
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const builder = new RangeSetBuilder();
  let last = -1;
  for (const [from, to] of ranges) {
    if (from >= last) { // skip overlapping ranges
      builder.add(from, to, Decoration.replace({}));
      last = to;
    }
  }
  return builder.finish();
}

// CSS class decorations on .cm-line for heading sizes
function buildLineDecorations(view) {
  const { state } = view;
  const builder = new RangeSetBuilder();

  syntaxTree(state).iterate({
    enter(node) {
      const m = node.name.match(/^ATXHeading(\d)$/);
      if (m) {
        const line = state.doc.lineAt(node.from);
        builder.add(line.from, line.from, Decoration.line({ class: `cm-md-h${m[1]}` }));
        return false; // don't descend
      }
      if (node.name === 'Blockquote') {
        const fromLineNo = state.doc.lineAt(node.from).number;
        const toLineNo   = state.doc.lineAt(node.to).number;
        for (let n = fromLineNo; n <= toLineNo; n++) {
          const line = state.doc.line(n);
          builder.add(line.from, line.from, Decoration.line({ class: 'cm-md-blockquote' }));
        }
        return false;
      }
      if (node.name === 'HorizontalRule') {
        const line = state.doc.lineAt(node.from);
        builder.add(line.from, line.from, Decoration.line({ class: 'cm-md-hr' }));
        return false;
      }
      if (node.name === 'FencedCode') {
        const fromLineNo = state.doc.lineAt(node.from).number;
        const toLineNo   = state.doc.lineAt(node.to).number;
        for (let n = fromLineNo; n <= toLineNo; n++) {
          const line = state.doc.line(n);
          builder.add(line.from, line.from, Decoration.line({ class: 'cm-md-code-fence' }));
        }
        return false;
      }
    },
  });

  return builder.finish();
}

// Combine both decoration sources in one plugin
const markdownDisplayPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.syntax = buildSyntaxDecorations(view);
      this.lines  = buildLineDecorations(view);
    }
    update(u) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) {
        this.syntax = buildSyntaxDecorations(u.view);
      }
      if (u.docChanged || u.viewportChanged) {
        this.lines = buildLineDecorations(u.view);
      }
    }
  },
  {
    // Primary: inline replace decorations
    decorations: (v) => v.syntax,
    // Additional: line class decorations
    provide: (plugin) =>
      EditorView.decorations.of((view) => {
        const instance = view.plugin(plugin);
        return instance ? instance.lines : Decoration.none;
      }),
  }
);

// ============================================================
// HIGHLIGHT STYLE — maps lezer tags to CSS classes
// ============================================================
const mindHighlight = HighlightStyle.define([
  { tag: tags.strong,        class: 'cm-strong' },
  { tag: tags.emphasis,      class: 'cm-em' },
  { tag: tags.monospace,     class: 'cm-inline-code' },
  { tag: tags.link,          class: 'cm-link-text' },
  { tag: tags.strikethrough, class: 'cm-strikethrough' },
  // Dim the raw syntax that IS visible (on active line)
  { tag: tags.processingInstruction, color: 'var(--text-faint)' },
  { tag: tags.meta,                  color: 'var(--text-faint)' },
  { tag: tags.atom,                  color: 'var(--text-faint)' },
]);

// ============================================================
// THEME — EditorView-level style overrides
// ============================================================
const mindTheme = EditorView.theme({
  '&': { background: 'transparent', color: 'var(--text)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': { caretColor: 'var(--accent)' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    background: 'var(--selection)',
  },
  '.cm-scroller': { fontFamily: 'inherit' },
}, { dark: true });

// ============================================================
// EDITOR FACTORY
// ============================================================
function createEditor(parent, doc, onChange) {
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        drawSelection(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        syntaxHighlighting(mindHighlight),
        markdownDisplayPlugin,
        mindTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange(update.view.state.doc.toString());
        }),
      ],
    }),
    parent,
  });
}

// ============================================================
// APP STATE
// ============================================================
let currentFolder   = null;
let currentFilePath = null;
let editorView      = null;
let saveTimer       = null;
let isDirty         = false;

// ============================================================
// SAVE
// ============================================================
function scheduleSave(content) {
  isDirty = true;
  setStatus('save', '●');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveFile(content), 1800);
}

async function saveFile(content) {
  if (!currentFilePath) return;
  const ok = await window.api.writeFile(currentFilePath, content ?? editorView.state.doc.toString());
  if (ok) {
    isDirty = false;
    setStatus('save', '');
  }
}

// ============================================================
// WORD COUNT
// ============================================================
function countWords(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return `${words} ${words === 1 ? 'palavra' : 'palavras'}`;
}

// ============================================================
// STATUS BAR
// ============================================================
function setStatus(slot, text) {
  const el = document.getElementById(`status-${slot}`);
  if (el) el.textContent = text;
}

// ============================================================
// FILE TREE
// ============================================================
async function renderTree(folderPath, container) {
  container.innerHTML = '';
  const entries = await window.api.readDir(folderPath);

  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, 'pt', { sensitivity: 'base' });
  });

  for (const entry of entries) {
    const item = document.createElement('div');
    item.className = 'tree-item' + (entry.isDirectory ? ' is-dir' : '');
    item.dataset.path = entry.path;

    const icon = document.createElement('i');
    icon.className = 'icon';

    const label = document.createElement('span');
    label.textContent = entry.isDirectory
      ? entry.name
      : entry.name.replace(/\.md$/, '');
    label.style.overflow = 'hidden';
    label.style.textOverflow = 'ellipsis';

    item.append(icon, label);

    if (entry.path === currentFilePath) item.classList.add('active');

    if (entry.isDirectory) {
      let open = false;
      let childWrap = null;
      item.addEventListener('click', async () => {
        open = !open;
        item.classList.toggle('open', open);
        if (open) {
          childWrap = document.createElement('div');
          childWrap.className = 'tree-children';
          item.after(childWrap);
          await renderTree(entry.path, childWrap);
        } else {
          childWrap?.remove();
          childWrap = null;
        }
      });
    } else {
      item.addEventListener('click', () => openFile(entry.path));
    }

    container.appendChild(item);
  }
}

function refreshTreeActiveState() {
  document.querySelectorAll('.tree-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.path === currentFilePath);
  });
}

// ============================================================
// OPEN FOLDER
// ============================================================
async function openFolder() {
  const folder = await window.api.openFolderDialog();
  if (!folder) return;
  currentFolder = folder;

  const name = await window.api.basename(folder, '');
  setStatus('file', name);
  document.getElementById('folder-name').textContent = name;

  const tree = document.getElementById('file-tree');
  const empty = document.getElementById('sidebar-empty');
  empty.classList.remove('visible');
  await renderTree(folder, tree);
}

// ============================================================
// OPEN FILE
// ============================================================
async function openFile(filePath) {
  // Flush any pending save for the previous file
  clearTimeout(saveTimer);
  if (isDirty && currentFilePath) await saveFile();

  currentFilePath = filePath;
  const content = await window.api.readFile(filePath);
  const name = await window.api.basename(filePath, '.md');

  // Replace editor content
  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: content },
  });

  editorView.focus();
  isDirty = false;
  setStatus('save', '');
  setStatus('file', name);
  setStatus('words', countWords(content));
  document.title = `${name} — Mind`;
  refreshTreeActiveState();
}

// ============================================================
// NEW FILE
// ============================================================
async function newFile() {
  if (!currentFolder) {
    await openFolder();
    if (!currentFolder) return;
  }

  const name = prompt('Nome do arquivo (sem extensão):');
  if (!name?.trim()) return;

  const filePath = await window.api.createFile(currentFolder, name.trim());
  if (!filePath) return;

  await renderTree(currentFolder, document.getElementById('file-tree'));
  await openFile(filePath);
}

// ============================================================
// SIDEBAR TOGGLE
// ============================================================
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('sidebar-hidden');
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  const editorEl = document.getElementById('editor');

  editorView = createEditor(editorEl, '', (content) => {
    scheduleSave(content);
    setStatus('words', countWords(content));
  });

  editorView.focus();

  // Show empty state until a folder is opened
  document.getElementById('sidebar-empty').classList.add('visible');

  // Buttons
  document.getElementById('btn-open-folder').addEventListener('click', openFolder);
  document.getElementById('btn-open-folder-2').addEventListener('click', openFolder);
  document.getElementById('btn-new-file').addEventListener('click', newFile);

  // Menu actions from main process
  window.api.onMenuAction(async (action) => {
    switch (action) {
      case 'open-folder':    await openFolder(); break;
      case 'new-file':       await newFile(); break;
      case 'save':           await saveFile(); break;
      case 'toggle-sidebar': toggleSidebar(); break;
    }
  });

  // Save before window closes
  window.addEventListener('beforeunload', () => {
    if (isDirty && currentFilePath) {
      window.api.writeFile(currentFilePath, editorView.state.doc.toString());
    }
  });
});
