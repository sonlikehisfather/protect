'use strict';

/**
 * VoiceMaster - constantes partagees.
 * Hierarchie : wl < owner < sys < sys+ < principal.
 */

const PREFIX = '=';

const LEVELS = Object.freeze({
  NONE      : 0,
  WL        : 1,
  OWNER     : 2,
  SYS       : 3,
  SYS_PLUS  : 4,
  PRINCIPAL : 5,
});

const LEVEL_NAMES = Object.freeze({
  [LEVELS.NONE]      : 'Aucun',
  [LEVELS.WL]        : 'WL',
  [LEVELS.OWNER]     : 'Owner',
  [LEVELS.SYS]       : 'Sys',
  [LEVELS.SYS_PLUS]  : 'Sys+',
  [LEVELS.PRINCIPAL] : 'Sys+ principal',
});

/** Rangs stockes en base (le niveau WL est un indicateur separe, voir store.js). */
const STORED_RANKS = Object.freeze({
  owner : LEVELS.OWNER,
  sys   : LEVELS.SYS,
  'sys+': LEVELS.SYS_PLUS,
});

/** Types de logs VoiceMaster, regroupés par section dans le panneau =vmlogs setup. */
const LOG_SECTIONS = Object.freeze([
  { id: 'ranks', label: 'Rangs' },
  { id: 'voice', label: 'Vocal' },
  { id: 'tools', label: 'Outils' },
]);

const LOG_TYPES = Object.freeze([
  { id: 'sys',     label: 'Sys',        section: 'ranks' },
  { id: 'ow',      label: 'Owner',      section: 'ranks' },
  { id: 'wl',      label: 'Whitelist',  section: 'ranks' },
  { id: 'mv',      label: 'Mv',         section: 'voice' },
  { id: 'join',    label: 'Join',       section: 'voice' },
  { id: 'mp',      label: 'Mp',         section: 'voice' },
  { id: 'pv',      label: 'Pv',         section: 'voice' },
  { id: 'acces',   label: 'Accès',      section: 'voice' },
  { id: 'menotte', label: 'Menotte',    section: 'tools' },
  { id: 'follow',  label: 'Follow',     section: 'tools' },
  { id: 'bringcc', label: 'Bringcc',    section: 'tools' },
  { id: 'vmall',   label: 'Vmall',      section: 'tools' },
]);

module.exports = { PREFIX, LEVELS, LEVEL_NAMES, STORED_RANKS, LOG_SECTIONS, LOG_TYPES };
