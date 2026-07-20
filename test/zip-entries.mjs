/**
 * Read entry names out of a zip buffer.
 *
 * The agent-pack tests used to assert this by shelling out to `tar -tf`, which
 * was never portable:
 *
 * - GNU tar — what Linux and Git-for-Windows ship — cannot read zip archives
 *   at all, so the assertion failed outright wherever bsdtar was not `tar`.
 * - Given an absolute Windows path, GNU tar reads the leading `C:` as a remote
 *   host spec and fails with "Cannot connect to C:".
 *
 * Parsing the central directory tests the same property — the bytes are a
 * valid zip containing the expected entries — on every platform, with no
 * external tool and no temp file.
 */

/** Central-directory file header signature. */
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;

/** Bytes of a central-directory header before the filename begins. */
const ZIP_CENTRAL_HEADER_BYTES = 46;

/** Offset of the 16-bit filename length within a central-directory header. */
const ZIP_NAME_LENGTH_OFFSET = 28;

/**
 * @param {Buffer} buffer a complete zip archive
 * @returns {string[]} entry names, in central-directory order
 */
export function listZipEntries(buffer) {
  /** @type {string[]} */
  const names = [];
  if (!Buffer.isBuffer(buffer)) {
    return names;
  }

  for (let at = 0; at + ZIP_CENTRAL_HEADER_BYTES <= buffer.length; at += 1) {
    if (buffer.readUInt32LE(at) !== ZIP_CENTRAL_SIGNATURE) continue;

    const nameLength = buffer.readUInt16LE(at + ZIP_NAME_LENGTH_OFFSET);
    const start = at + ZIP_CENTRAL_HEADER_BYTES;
    // A truncated or coincidental signature match must not read past the end.
    if (start + nameLength > buffer.length) continue;

    names.push(buffer.toString('utf8', start, start + nameLength));
  }

  return names;
}
