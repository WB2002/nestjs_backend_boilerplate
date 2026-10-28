'use strict';

/** Minimal CJS shim so Jest (experimental-vm-modules) can load sanitization tests. */
function sanitizeHtml(dirty, options = {}) {
  if (typeof dirty !== 'string') {
    return dirty;
  }
  let out = dirty.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const allowedTags = options.allowedTags ?? [];
  if (allowedTags.length === 0) {
    return out.replace(/<[^>]+>/g, '');
  }
  return out;
}

module.exports = sanitizeHtml;
module.exports.default = sanitizeHtml;
