'use strict';

const { createRankToggle } = require('../rankToggle');
const { LEVELS } = require('../config');

module.exports = createRankToggle({ name: 'sys', rank: 'sys', minRank: LEVELS.SYS_PLUS,
  description: 'Ajoute ou retire le rang Sys Voicemaster.' });
