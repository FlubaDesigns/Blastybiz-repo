'use strict';

// ── bbLog — structured logging helper ────────────────────────────────────────
// Emits JSON-structured log entries that GCP Cloud Logging parses into
// queryable fields. Use for auth failures, billing events, and errors.
// Fields: severity (DEBUG/INFO/WARNING/ERROR), fn (function name), + any extras.
function bbLog(severity, fn, data = {}) {
  const entry = JSON.stringify({ severity, fn, ...data });
  if (severity === 'ERROR' || severity === 'WARNING') {
    console.error(entry);
  } else {
    console.log(entry);
  }
}

module.exports = { bbLog };
