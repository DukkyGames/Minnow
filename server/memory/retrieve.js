/**
 * Memory back-compat adapter: re-exports brain retrieval (MIN-B3).
 * TRACKING: remove when clients use /api/brain/retrieve (MIN-B4+).
 */

export * from '../brain/retrieve.js';
