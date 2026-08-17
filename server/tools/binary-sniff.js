/**
 * Detect buffers that are not UTF-8 text so read_file does not dump ZIP/OLE/image bytes.
 */

/** Sample window — enough to catch ZIP/OLE/PNG headers and embedded NULs. */
const BINARY_SAMPLE_BYTES = 8192;

/**
 * True when the buffer is unlikely to be UTF-8 text (NUL in the leading sample).
 * Office/PDF paths should be routed to read_document before this check.
 *
 * @param {Buffer} buffer
 * @returns {boolean}
 */
export function looksLikeBinaryBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return false;
  }
  const sampleLen = Math.min(buffer.length, BINARY_SAMPLE_BYTES);
  for (let i = 0; i < sampleLen; i++) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}
