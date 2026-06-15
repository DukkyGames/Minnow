/**
 * Minimal multipart/form-data parser for a single file upload field.
 */

import { formatByteLimit } from './limits.js';

/**
 * Extract the first file part from a multipart body.
 * @param {Buffer} body
 * @param {string} boundary
 * @param {number} maxBytes
 * @returns {{ buffer: Buffer, mime: string, filename: string }}
 */
export function extractFileFromMultipart(body, boundary, maxBytes) {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = splitMultipart(body, delimiter);
  for (const part of parts) {
    if (!part.length) continue;
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd < 0) continue;
    const headerText = part.slice(0, headerEnd).toString('utf8');
    if (!/content-disposition:\s*form-data/i.test(headerText)) continue;
    const nameMatch = headerText.match(/name="([^"]+)"/i);
    const filenameMatch = headerText.match(/filename="([^"]*)"/i);
    if (!filenameMatch && nameMatch?.[1] !== 'file') continue;
    const mimeMatch = headerText.match(/content-type:\s*([^\r\n]+)/i);
    let data = part.slice(headerEnd + 4);
    if (data.length >= 2 && data[data.length - 2] === 0x0d && data[data.length - 1] === 0x0a) {
      data = data.slice(0, -2);
    }
    if (data.length > maxBytes) {
      throw new Error(`Audio file exceeds ${formatByteLimit(maxBytes)} limit`);
    }
    return {
      buffer: data,
      mime: mimeMatch?.[1]?.trim() ?? 'application/octet-stream',
      filename: filenameMatch?.[1] ?? 'audio.webm',
    };
  }
  throw new Error('No file field found in multipart body');
}

/**
 * @param {Buffer} body
 * @param {Buffer} delimiter
 */
function splitMultipart(body, delimiter) {
  const parts = [];
  let offset = 0;
  while (offset < body.length) {
    const start = body.indexOf(delimiter, offset);
    if (start < 0) break;
    const partStart = start + delimiter.length;
    if (body[partStart] === 0x2d && body[partStart + 1] === 0x2d) break;
    const next = body.indexOf(delimiter, partStart);
    if (next < 0) break;
    let chunk = body.slice(partStart, next);
    if (chunk[0] === 0x0d && chunk[1] === 0x0a) {
      chunk = chunk.slice(2);
    }
    parts.push(chunk);
    offset = next;
  }
  return parts;
}

/**
 * Read a multipart upload from an incoming request with a byte cap.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} maxBytes
 */
export function parseMultipartFile(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers['content-type'] || '');
    const match = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
    if (!match) {
      reject(new Error('Missing multipart boundary'));
      return;
    }
    const boundary = match[1] || match[2];
    const chunks = [];
    let size = 0;
    const overhead = 4096;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes + overhead) {
        reject(new Error(`Audio file exceeds ${formatByteLimit(maxBytes)} limit`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks);
        resolve(extractFileFromMultipart(body, boundary, maxBytes));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}
