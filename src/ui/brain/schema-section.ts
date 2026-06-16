/**
 * Brain app — Schema section: view and edit schema.md.
 */

import { fetchBrainSchema, saveBrainSchema } from '../../brain/client';

let bindingsDone = false;

function setSchemaStatus(kind: 'ok' | 'err' | 'spin', message: string): void {
  const el = document.getElementById('brainSchemaStatus');
  if (!el) return;
  el.textContent = message;
  el.dataset.kind = kind;
}

function bindSchemaSection(): void {
  if (bindingsDone) return;
  bindingsDone = true;

  document.getElementById('brainSchemaReload')?.addEventListener('click', () => {
    void renderSchemaSection();
  });

  document.getElementById('brainSchemaSave')?.addEventListener('click', () => {
    void (async () => {
      const editor = document.getElementById(
        'brainSchemaEditor',
      ) as HTMLTextAreaElement | null;
      if (!editor) return;
      setSchemaStatus('spin', 'Saving…');
      const ok = await saveBrainSchema(editor.value);
      setSchemaStatus(ok ? 'ok' : 'err', ok ? 'Schema saved.' : 'Save failed.');
    })();
  });
}

/** Load schema.md into the editor. */
export async function renderSchemaSection(): Promise<void> {
  bindSchemaSection();
  const editor = document.getElementById('brainSchemaEditor') as HTMLTextAreaElement | null;
  const offlineEl = document.getElementById('brainSchemaOffline');
  if (!editor) return;

  const schema = await fetchBrainSchema();
  const online = schema !== null;
  offlineEl?.classList.toggle('hidden', online);

  if (!online) {
    editor.value = '';
    editor.disabled = true;
    setSchemaStatus('err', 'Offline — start npm start.');
    return;
  }

  editor.disabled = false;
  editor.value = schema ?? '';
  setSchemaStatus('ok', 'Schema loaded.');
}
