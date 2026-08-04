'use strict';

// ── Base URL for all web-app redirects (checkout, OAuth, emails) ──────────────
// Set APP_BASE_URL env var when adding a custom domain so all redirects update
// without a code change.
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://blastybiz-9523e.web.app';

const JOB_STATUS = {
  PENDING:          'pending',
  PROCESSING:       'processing',
  SUCCESS:          'success',
  FAILED:           'failed',
  MANUAL_REQUIRED:  'manual_required',
  MANUAL_FOLLOWUP:  'manual_followup',
  MANUAL_COMPLETED: 'manual_completed',
  CLOSED:           'closed',
};

module.exports = { APP_BASE_URL, JOB_STATUS };
