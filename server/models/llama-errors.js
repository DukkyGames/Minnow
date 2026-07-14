/**
 * Map raw llama.cpp / CUDA / router error text to user-friendly messages.
 * @param {string} raw
 * @returns {string}
 */
export function mapLlamaError(raw) {
  const text = String(raw || '').trim();
  if (!text) return 'llama.cpp operation failed';

  const lower = text.toLowerCase();

  if (
    lower.includes('out of memory') ||
    lower.includes('cuda error') && lower.includes('memory') ||
    lower.includes('ggml_cuda') && lower.includes('alloc') ||
    lower.includes('failed to allocate')
  ) {
    return 'GPU out of memory — try a smaller quant, fewer GPU layers, or unload other models.';
  }

  if (
    lower.includes('cuda driver version is insufficient') ||
    lower.includes('driver version is insufficient') ||
    lower.includes('cuda version mismatch') ||
    lower.includes('no cuda-capable device') ||
    lower.includes('failed to initialize cuda')
  ) {
    return 'CUDA driver mismatch — reinstall llama.cpp with a matching variant in Settings → Servers, or switch to CPU/Vulkan.';
  }

  if (lower.includes('vulkan') && (lower.includes('not found') || lower.includes('failed'))) {
    return 'Vulkan initialization failed — try the CPU variant or update GPU drivers.';
  }

  if (lower.includes('does not support router mode') || lower.includes('--models-dir')) {
    return 'Installed llama-server is too old for router mode — update the runtime in Settings → Servers.';
  }

  if (lower.includes('model') && lower.includes('not found')) {
    return 'Model file not found — verify the GGUF path in Models → Installed.';
  }

  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}
