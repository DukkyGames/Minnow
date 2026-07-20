import { appAlert, appConfirm, appPrompt } from '../app-dialog';
/**
 * Rich-text body editor for the email compose footer (toolbar + contenteditable).
 */

import type { ComposeImproveMode } from "../../email/client";

/** Toolbar actions mapped to document.execCommand names. */
const FORMAT_COMMANDS: Record<string, string> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strike: "strikeThrough",
  ul: "insertUnorderedList",
  ol: "insertOrderedList",
};

export interface ComposeBodyEditor {
  root: HTMLElement;
  getPlainText: () => string;
  getHtml: () => string | undefined;
  setPlainText: (text: string) => void;
  getSelectionText: () => string | null;
  replaceSelection: (text: string) => void;
  focus: () => void;
}

export interface ComposeSelectionAiOptions {
  onImprove: (
    selection: string,
    mode: ComposeImproveMode,
    instructions?: string,
  ) => Promise<string>;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function hasRichFormatting(editor: HTMLElement): boolean {
  return Boolean(
    editor.querySelector(
      "b, strong, i, em, u, s, strike, ul, ol, li, a, h1, h2, h3, pre",
    ),
  );
}

function readEditorSelection(editor: HTMLElement): {
  text: string;
  range: Range;
} | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;

  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return null;

  const text = range.toString().replace(/\u00a0/g, " ").trim();
  if (!text) return null;

  return { text, range: range.cloneRange() };
}

async function insertLink(editor: HTMLElement): Promise<void> {
  const selection = window.getSelection();
  let range: Range | null = null;
  if (selection?.rangeCount) {
    const candidate = selection.getRangeAt(0);
    if (editor.contains(candidate.commonAncestorContainer)) {
      range = candidate.cloneRange();
    }
  }

  const selectedText = range?.toString() ?? "";
  const urlInput = await appPrompt("Link URL", "https://");
  if (urlInput === null) {
    editor.focus();
    return;
  }

  let url = urlInput.trim();
  if (!url) {
    editor.focus();
    return;
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith("//")) {
    url = `https://${url}`;
  }

  const labelInput = await appPrompt("Link text (optional)", selectedText || url);
  if (labelInput === null) {
    editor.focus();
    return;
  }
  const label = labelInput.trim() || selectedText || url;

  if (!range) {
    range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
  }

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";

  if (selectedText && label === selectedText) {
    anchor.appendChild(range.extractContents());
  } else {
    range.deleteContents();
    anchor.textContent = label;
  }

  range.insertNode(anchor);
  const after = document.createRange();
  after.setStartAfter(anchor);
  after.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(after);
  editor.focus();
}

function syncToolbarState(
  editor: HTMLElement,
  buttons: Map<string, HTMLButtonElement>,
): void {
  for (const [action, button] of buttons) {
    if (action === "link") continue;
    const command = FORMAT_COMMANDS[action];
    if (!command) continue;
    let active = false;
    try {
      active = document.queryCommandState(command);
    } catch {
      active = false;
    }
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

/** Position the revise bubble below the format toolbar, flipping when needed. */
function positionSelectionBubble(
  bubble: HTMLElement,
  root: HTMLElement,
  toolbar: HTMLElement,
  editor: HTMLElement,
  range: Range,
): void {
  const rect = range.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();

  if (rect.width === 0 && rect.height === 0) {
    return;
  }

  const gap = 8;
  const edge = 8;
  const toolbarFloor = toolbar.offsetHeight + gap;
  const bubbleWidth = bubble.offsetWidth || bubble.scrollWidth;
  const bubbleHeight = bubble.offsetHeight || bubble.scrollHeight;

  const left = Math.max(
    edge,
    Math.min(rect.left - rootRect.left, root.clientWidth - bubbleWidth - edge),
  );

  let top = rect.top - rootRect.top - bubbleHeight - gap;
  if (top < toolbarFloor) {
    top = rect.bottom - rootRect.top + gap;
  }

  const maxTop = root.clientHeight - bubbleHeight - edge;
  top = Math.min(Math.max(toolbarFloor, top), Math.max(toolbarFloor, maxTop));

  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
}

/** Compact toolbar for improving highlighted compose text. */
function attachSelectionAiBubble(
  editor: HTMLElement,
  root: HTMLElement,
  toolbar: HTMLElement,
  options: ComposeSelectionAiOptions,
): void {
  const bubble = el("div", "email-compose-selection-bubble");
  bubble.hidden = true;
  bubble.setAttribute("role", "toolbar");
  bubble.setAttribute("aria-label", "Revise selected text");
  root.appendChild(bubble);

  const actions = el("div", "email-compose-selection-actions");
  bubble.appendChild(actions);

  const customRow = el("div", "email-compose-selection-custom");
  customRow.hidden = true;
  const customInput = el("input", "email-compose-selection-input") as HTMLInputElement;
  customInput.type = "text";
  customInput.placeholder = "How should this change?";
  customInput.autocomplete = "off";
  const customGo = el("button", "email-compose-selection-btn", "Go") as HTMLButtonElement;
  customGo.type = "button";
  customRow.appendChild(customInput);
  customRow.appendChild(customGo);
  bubble.appendChild(customRow);

  let savedRange: Range | null = null;
  let busy = false;

  const hideBubble = (): void => {
    bubble.hidden = true;
    customRow.hidden = true;
    customInput.value = "";
    savedRange = null;
  };

  const refreshBubblePosition = (): void => {
    if (!savedRange || bubble.hidden) return;
    positionSelectionBubble(bubble, root, toolbar, editor, savedRange);
  };

  const runImprove = async (
    mode: ComposeImproveMode,
    instructions?: string,
  ): Promise<void> => {
    if (busy || !savedRange) return;
    const text = savedRange.toString().replace(/\u00a0/g, " ").trim();
    if (!text) return;

    busy = true;
    bubble.classList.add("is-busy");
    try {
      const revised = await options.onImprove(text, mode, instructions);
      if (!revised.trim()) return;

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(savedRange);
      savedRange.deleteContents();
      savedRange.insertNode(document.createTextNode(revised));
      savedRange.collapse(false);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    } finally {
      busy = false;
      bubble.classList.remove("is-busy");
      hideBubble();
      editor.focus();
    }
  };

  const addAction = (
    label: string,
    mode: ComposeImproveMode,
    title: string,
  ): void => {
    const button = el("button", "email-compose-selection-btn") as HTMLButtonElement;
    button.type = "button";
    button.textContent = label;
    button.title = title;
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => void runImprove(mode));
    actions.appendChild(button);
  };

  addAction("Improve", "improve", "Improve clarity and tone");
  addAction("Fix", "correct", "Fix grammar and spelling");
  addAction("Shorter", "shorten", "Make more concise");
  addAction("Friendlier", "friendlier", "Warm up the tone");
  addAction("Firmer", "firmer", "Make the tone firmer and more direct");

  const tuneBtn = el("button", "email-compose-selection-btn", "Tune") as HTMLButtonElement;
  tuneBtn.type = "button";
  tuneBtn.title = "Describe how to change the selection";
  tuneBtn.addEventListener("mousedown", (event) => event.preventDefault());
  tuneBtn.addEventListener("click", () => {
    customRow.hidden = false;
    customInput.focus();
    refreshBubblePosition();
  });
  actions.appendChild(tuneBtn);

  customGo.addEventListener("mousedown", (event) => event.preventDefault());
  customGo.addEventListener("click", () => {
    const instructions = customInput.value.trim();
    if (!instructions) return;
    void runImprove("improve", instructions);
  });

  customInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      customGo.click();
    }
    if (event.key === "Escape") {
      customInput.value = "";
      customRow.hidden = true;
    }
  });

  const syncFromSelection = (): void => {
    if (busy) return;
    const picked = readEditorSelection(editor);
    if (!picked) {
      hideBubble();
      return;
    }
    savedRange = picked.range;
    customRow.hidden = true;
    customInput.value = "";
    bubble.hidden = false;
    refreshBubblePosition();
  };

  editor.addEventListener("mouseup", syncFromSelection);
  editor.addEventListener("keyup", syncFromSelection);
  editor.addEventListener("scroll", refreshBubblePosition);
  document.addEventListener("selectionchange", () => {
    if (busy) return;
    if (!readEditorSelection(editor)) hideBubble();
  });
  document.addEventListener("mousedown", (event) => {
    if (bubble.contains(event.target as Node)) return;
    if (editor.contains(event.target as Node)) return;
    hideBubble();
  });
}

export function createComposeBodyEditor(
  aiOptions?: ComposeSelectionAiOptions,
): ComposeBodyEditor {
  const root = el("div", "email-compose-editor");
  const toolbar = el("div", "email-compose-toolbar");
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Message formatting");

  const editor = el("div", "email-compose-body email-compose-body-rich");
  editor.setAttribute("contenteditable", "true");
  editor.setAttribute("role", "textbox");
  editor.setAttribute("aria-multiline", "true");
  editor.setAttribute(
    "data-placeholder",
    "Write your message, or highlight text to revise it…",
  );

  const buttons = new Map<string, HTMLButtonElement>();

  const addFormatButton = (
    action: string,
    label: string,
    title: string,
  ): void => {
    const button = el("button", "email-compose-format-btn") as HTMLButtonElement;
    button.type = "button";
    button.textContent = label;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    button.addEventListener("click", () => {
      editor.focus();
      if (action === "link") {
        void insertLink(editor);
        syncToolbarState(editor, buttons);
        return;
      }
      const command = FORMAT_COMMANDS[action];
      if (!command) return;
      try {
        document.execCommand(command);
      } catch {
        /* execCommand may fail on unsupported commands; ignore. */
      }
      syncToolbarState(editor, buttons);
    });
    buttons.set(action, button);
    toolbar.appendChild(button);
  };

  addFormatButton("bold", "B", "Bold");
  addFormatButton("italic", "I", "Italic");
  addFormatButton("underline", "U", "Underline");
  addFormatButton("strike", "S", "Strikethrough");

  toolbar.appendChild(el("span", "email-compose-toolbar-sep"));

  addFormatButton("ul", "•", "Bullet list");
  addFormatButton("ol", "1.", "Numbered list");
  addFormatButton("link", "Link", "Insert link");

  root.appendChild(toolbar);
  root.appendChild(editor);

  if (aiOptions) {
    attachSelectionAiBubble(editor, root, toolbar, aiOptions);
  }

  const onSelectionChange = (): void => {
    const selection = window.getSelection();
    if (!selection?.anchorNode) return;
    if (!editor.contains(selection.anchorNode)) return;
    syncToolbarState(editor, buttons);
  };

  document.addEventListener("selectionchange", onSelectionChange);
  editor.addEventListener("keyup", onSelectionChange);
  editor.addEventListener("mouseup", onSelectionChange);
  editor.addEventListener("focus", onSelectionChange);

  return {
    root,
    getPlainText: () => editor.innerText.replace(/\u00a0/g, " ").trimEnd(),
    getHtml: () => {
      if (!hasRichFormatting(editor)) return undefined;
      return editor.innerHTML.trim() || undefined;
    },
    setPlainText: (text: string) => {
      editor.textContent = text;
    },
    getSelectionText: () => readEditorSelection(editor)?.text ?? null,
    replaceSelection: (text: string) => {
      const picked = readEditorSelection(editor);
      if (!picked) {
        editor.textContent = text;
        return;
      }
      picked.range.deleteContents();
      picked.range.insertNode(document.createTextNode(text));
      picked.range.collapse(false);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    },
    focus: () => {
      editor.focus();
    },
  };
}

