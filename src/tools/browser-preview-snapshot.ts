export interface PreviewSnapshotNode {
  uid: number;
  role: string;
  name: string;
  value?: string;
  children?: PreviewSnapshotNode[];
}

/** Format snapshot nodes as an indented tree for the model. */
export function renderPreviewSnapshotTree(nodes: PreviewSnapshotNode[], indent = 0): string {
  const lines: string[] = [];
  for (const node of nodes) {
    if (!node.uid) {
      if (node.children?.length) {
        lines.push(renderPreviewSnapshotTree(node.children, indent));
      }
      continue;
    }
    const pad = ' '.repeat(indent);
    const parts = [`[${node.uid}]`, node.role];
    if (node.name) parts.push(`"${node.name}"`);
    if (node.value) parts.push(`value="${node.value}"`);
    lines.push(`${pad}${parts.join(' ')}`);
    if (node.children?.length) {
      lines.push(renderPreviewSnapshotTree(node.children, indent + 1));
    }
  }
  return lines.join('\n');
}

export const PREVIEW_DOM_SNAPSHOT_SCRIPT = `(() => {
  const INTERACTIVE =
    'a,button,input,textarea,select,[role],[aria-label],h1,h2,h3,h4,h5,h6,label';
  let nextUid = 1;

  function roleFor(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      return 'textbox';
    }
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'label') return 'label';
    return tag;
  }

  function nameFor(el) {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim().slice(0, 200);
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const ref = document.getElementById(labelledBy);
      const t = ref && (ref.innerText || ref.textContent || '').trim();
      if (t) return t.slice(0, 200);
    }
    const text = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ');
    if (text) return text.slice(0, 200);
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return placeholder.trim();
    if ('value' in el && el.value != null && String(el.value).trim()) {
      return String(el.value).trim().slice(0, 120);
    }
    const alt = el.getAttribute('alt');
    if (alt) return alt.trim();
    return '';
  }

  function valueFor(el) {
    if ('value' in el && el.value != null && String(el.value)) {
      return String(el.value).slice(0, 120);
    }
    return undefined;
  }

  function isCandidate(el) {
    if (!(el instanceof Element)) return false;
    if (el.closest('[hidden]')) return false;
    const tag = el.tagName.toLowerCase();
    if (['a', 'button', 'input', 'textarea', 'select', 'label'].includes(tag)) return true;
    if (el.hasAttribute('role') || el.hasAttribute('aria-label')) return true;
    if (/^h[1-6]$/.test(tag)) return true;
    return false;
  }

  function walk(el) {
    const children = [];
    for (const child of el.children) {
      const node = buildNode(child);
      if (node) children.push(node);
    }
    if (!isCandidate(el) && children.length === 1) return children[0];
    if (!isCandidate(el) && children.length === 0) return null;
    if (!isCandidate(el)) {
      return children.length ? { uid: 0, role: 'generic', name: '', children } : null;
    }
    const uid = nextUid++;
    el.setAttribute('data-mn-uid', String(uid));
    const role = roleFor(el);
    const name = nameFor(el);
    const value = valueFor(el);
    const node = { uid, role, name };
    if (value) node.value = value;
    if (children.length) node.children = children;
    if (!name && !value && (role === 'generic' || role === 'none') && children.length <= 1) {
      return children[0] ?? null;
    }
    return node;
  }

  function buildNode(el) {
    if (!(el instanceof Element)) return null;
    return walk(el);
  }

  const roots = [];
  const body = document.body;
  if (!body) return { text: '(empty page)', nodes: [] };
  for (const child of body.children) {
    const node = buildNode(child);
    if (node) roots.push(node);
  }

  function render(nodes, indent) {
    const lines = [];
    for (const node of nodes) {
      if (!node.uid) {
        if (node.children && node.children.length) {
          lines.push(render(node.children, indent));
        }
        continue;
      }
      const pad = ' '.repeat(indent);
      const parts = ['[' + node.uid + ']', node.role];
      if (node.name) parts.push('"' + node.name.replace(/"/g, '\\\\"') + '"');
      if (node.value) parts.push('value="' + String(node.value).replace(/"/g, '\\\\"') + '"');
      lines.push(pad + parts.join(' '));
      if (node.children && node.children.length) {
        lines.push(render(node.children, indent + 1));
      }
    }
    return lines.filter(Boolean).join('\\n');
  }

  const text = render(roots, 0) || '(empty page)';
  return { text, nodes: roots };
})()`;
