'use strict';

const { createRankToggle } = require('../rankToggle');
const { LEVELS } = require('../config');

const command = createRankToggle({ name: 'sys+', rank: 'sys+', minRank: LEVELS.PRINCIPAL,
  description: 'Ajoute ou retire le rang Sys+ Voicemaster, valable sur tous les serveurs (principal uniquement).' });
command.aliases = ['sysplus'];

module.exports = command;
