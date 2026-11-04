'use strict';

const { createRankToggle } = require('../rankToggle');
const { LEVELS } = require('../config');

module.exports = createRankToggle({ name: 'ow', rank: 'owner', minRank: LEVELS.SYS_PLUS,
  description: 'Ajoute ou retire le rang Owner Voicemaster.' });
