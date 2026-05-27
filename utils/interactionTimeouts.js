'use strict';

const { parseDuration } = require('./parseDuration');

/**
 * Centralized interaction timeout constants
 * All interaction collectors should use these values
 * Uses duration strings compatible with parseDuration utility
 */

const TIMEOUT_STRINGS = {
  // Short confirmations (delete/confirm dialogs)
  CONFIRM_TIME: '5m',      // 5 minutes
  CONFIRM_IDLE: '3m',      // 3 minutes

  // Standard panels (paginated content, forms)
  PANEL_TIME: '10m',       // 10 minutes
  PANEL_IDLE: '5m',        // 5 minutes

  // Long-running operations (giveaways, embeds)
  LONG_TIME: '30m',        // 30 minutes
  LONG_IDLE: '10m',        // 10 minutes

  // Quick interactions (one-shot buttons)
  QUICK_TIME: '2m',        // 2 minutes
  QUICK_IDLE: '1m',        // 1 minute
};

// Convert to milliseconds on module load
const INTERACTION_TIMEOUTS = Object.freeze({
  CONFIRM_TIME_MS: parseDuration(TIMEOUT_STRINGS.CONFIRM_TIME),
  CONFIRM_IDLE_MS: parseDuration(TIMEOUT_STRINGS.CONFIRM_IDLE),

  PANEL_TIME_MS: parseDuration(TIMEOUT_STRINGS.PANEL_TIME),
  PANEL_IDLE_MS: parseDuration(TIMEOUT_STRINGS.PANEL_IDLE),

  LONG_TIME_MS: parseDuration(TIMEOUT_STRINGS.LONG_TIME),
  LONG_IDLE_MS: parseDuration(TIMEOUT_STRINGS.LONG_IDLE),

  QUICK_TIME_MS: parseDuration(TIMEOUT_STRINGS.QUICK_TIME),
  QUICK_IDLE_MS: parseDuration(TIMEOUT_STRINGS.QUICK_IDLE),
});

module.exports = INTERACTION_TIMEOUTS;
