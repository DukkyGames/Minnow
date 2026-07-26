// fetch-blob still lists node-domexception; Node 18+ provides DOMException globally.
module.exports = globalThis.DOMException;
