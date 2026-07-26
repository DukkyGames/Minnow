// Vendored from https://github.com/thenativeweb/boolean (MIT) — upstream npm package is deprecated.
function boolean(value) {
  switch (Object.prototype.toString.call(value)) {
    case '[object String]':
      return ['true', 't', 'yes', 'y', 'on', '1'].includes(value.trim().toLowerCase());
    case '[object Number]':
      return value.valueOf() === 1;
    case '[object Boolean]':
      return value.valueOf();
    default:
      return false;
  }
}

function isBooleanable(value) {
  switch (Object.prototype.toString.call(value)) {
    case '[object String]':
      return [
        'true', 't', 'yes', 'y', 'on', '1',
        'false', 'f', 'no', 'n', 'off', '0',
      ].includes(value.trim().toLowerCase());
    case '[object Number]':
      return [0, 1].includes(value.valueOf());
    case '[object Boolean]':
      return true;
    default:
      return false;
  }
}

module.exports = { boolean, isBooleanable };
