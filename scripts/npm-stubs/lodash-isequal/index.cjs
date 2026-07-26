const { isDeepStrictEqual } = require('node:util');

// electron-updater compares plain config objects; strict deep equality is sufficient here.
function isEqual(value, other) {
  return isDeepStrictEqual(value, other);
}

module.exports = isEqual;
