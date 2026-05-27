'use strict';


const db           = require('../core/database');
const errorHandler = require('../utils/errorHandler');

const { restoreSavedActivity } = require('./ready');

const DEBUG_ACTIVITY = process.env.DEBUG_ACTIVITY === 'true' || process.env.DEBUG_ACTIVITY === '1';
const DEBOUNCE_MS = 5_000;
const THROTTLE_MS = 60_000;
const pendingByShard = new Map();
const lastApplyByShard = new Map();

module.exports = {
  name : 'shardResume',
  once : false,

  async execute(client, shardId, replayedEvents) {
    if (!client?.user) return;

    const key = String(shardId ?? 'unknown');
    const existing = pendingByShard.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      pendingByShard.delete(key);

      try {
        const now = Date.now();
        const lastApply = lastApplyByShard.get(key) ?? 0;

        if (now - lastApply < THROTTLE_MS) {
          if (DEBUG_ACTIVITY) {
            console.log(`[shardResume] Restore ignore par throttle (shard=${key}, replayed=${replayedEvents ?? 0}).`);
          }
          return;
        }

        const saved = db.getBotActivity();
        if (!saved || saved.removed) return;

        if (typeof restoreSavedActivity !== 'function') return;

        restoreSavedActivity(client, saved, { silent: true });
        lastApplyByShard.set(key, now);

        if (DEBUG_ACTIVITY) {
          console.log(`[shardResume] Activite reappliquee apres resume (shard=${key}, replayed=${replayedEvents ?? 0}).`);
        }
      } catch (err) {
        errorHandler.handle(err, { source: 'activityRestore', shardId: key });
      }
    }, DEBOUNCE_MS);

    if (typeof timer.unref === 'function') timer.unref();
    pendingByShard.set(key, timer);

    if (DEBUG_ACTIVITY) {
      console.log(`[shardResume] Restore programme (shard=${key}, replayed=${replayedEvents ?? 0}).`);
    }
  },
};
