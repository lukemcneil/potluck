/**
 * Preload hook to neutralize the `server-only` package when running
 * scripts under tsx. Next.js relies on bundler resolution to swap
 * `server-only` for an empty module on the server; from a plain Node
 * script the package always throws. Use via:
 *
 *   node --require ./scripts/_stub-server-only.cjs ...
 *
 * tsx accepts the same -r/--require flag.
 */

const Module = require("node:module");
const path = require("node:path");

const original = Module._resolveFilename;
Module._resolveFilename = function patched(request, parent, ...rest) {
  if (request === "server-only") {
    return path.join(__dirname, "_server-only-empty.cjs");
  }
  return original.call(this, request, parent, ...rest);
};
