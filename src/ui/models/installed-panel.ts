/**
 * Models → Installed — placeholder until download/serve ships (MIN-115 M3/M4).
 */

export function mountInstalledSection(): void {
  const mount = document.getElementById('modelsInstalledBody');
  if (!mount || mount.dataset.mounted === '1') return;
  mount.dataset.mounted = '1';
  mount.innerHTML = `
    <p class="models-lead">Downloaded models will appear here once the local download queue ships.</p>
    <p class="models-muted">Storage path: <code>~/.minnow/models/</code></p>
  `;
}
