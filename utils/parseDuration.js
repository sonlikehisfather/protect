'use strict';


const UNIT_TO_MS = Object.freeze({
  s         : 1_000,
  sec       : 1_000,
  secs      : 1_000,
  seconde   : 1_000,
  secondes  : 1_000,
  m         : 60_000,
  min       : 60_000,
  mins      : 60_000,
  minute    : 60_000,
  minutes   : 60_000,
  h         : 3_600_000,
  heure     : 3_600_000,
  heures    : 3_600_000,
  d         : 86_400_000,
  j         : 86_400_000,
  jour      : 86_400_000,
  jours     : 86_400_000,
  day       : 86_400_000,
  days      : 86_400_000,
  w         : 604_800_000,
  sem       : 604_800_000,
  semaine   : 604_800_000,
  semaines  : 604_800_000,
  week      : 604_800_000,
  weeks     : 604_800_000,
});


const CANONICAL_TO_MS = Object.freeze({
  s : 1_000,
  m : 60_000,
  h : 3_600_000,
  d : 86_400_000,
  w : 604_800_000,
});

const MS_TO_CANONICAL = Object.freeze({
  1_000       : 's',
  60_000      : 'm',
  3_600_000   : 'h',
  86_400_000  : 'd',
  604_800_000 : 'w',
});


function parseDuration(input, opts = {}) {
  if (input === null || input === undefined) return null;

  const {
    allowedUnits,
    defaultUnit = null,
    minMs,
    maxMs,
    allowSpace = true,
    unit: outputUnit = 'ms',
  } = opts;

  let totalMs;

  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) return null;
    totalMs = input;

  } else {
    const str = String(input).trim().toLowerCase();
    if (!str) return null;


    const spaceClass = allowSpace ? '\\s*' : '';
    const re         = new RegExp(`^(\\d+(?:\\.\\d+)?)${spaceClass}([a-z]+)?$`);
    const match      = str.match(re);
    if (!match) return null;

    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) return null;

    let unitKey = match[2] || null;


    if (!unitKey) {
      if (!defaultUnit) return null;
      unitKey = String(defaultUnit).toLowerCase();
    }

    const multiplier = UNIT_TO_MS[unitKey];
    if (multiplier === undefined) return null;


    if (Array.isArray(allowedUnits) && allowedUnits.length > 0) {
      const canonical = _canonicalize(unitKey);
      if (!canonical || !allowedUnits.includes(canonical)) return null;
    }

    totalMs = value * multiplier;
  }

  if (typeof minMs === 'number' && totalMs < minMs) return null;
  if (typeof maxMs === 'number' && totalMs > maxMs) return null;

  if (outputUnit === 's') {
    return Math.floor(totalMs / 1000);
  }
  return totalMs;
}


function _canonicalize(unitKey) {
  const ms = UNIT_TO_MS[unitKey];
  if (ms === undefined) return null;
  return MS_TO_CANONICAL[ms] || null;
}


const LABELS = Object.freeze({
  short: {
    s: 's', m: 'm', h: 'h', d: 'd', w: 'w',
  },
  long: {
    s: ['second', 'seconds'],
    m: ['minute', 'minutes'],
    h: ['hour', 'hours'],
    d: ['day', 'days'],
    w: ['week', 'weeks'],
  },
  'fr-long': {
    s: ['seconde', 'secondes'],
    m: ['minute', 'minutes'],
    h: ['heure', 'heures'],
    d: ['jour', 'jours'],
    w: ['semaine', 'semaines'],
  },
});


function formatDuration(value, opts = {}) {
  if (value === null || value === undefined) return '';

  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return '';

  const {
    unit: inputUnit = 'ms',
    format = 'short',
  } = opts;

  const totalMs = inputUnit === 's' ? Math.floor(num * 1000) : Math.floor(num);

  if (!LABELS[format]) return '';


  if (totalMs === 0) {
    return _formatPart(0, 's', format);
  }

  const ladder = [
    ['w', 604_800_000],
    ['d', 86_400_000],
    ['h', 3_600_000],
    ['m', 60_000],
    ['s', 1_000],
  ];

  const parts = [];
  let remaining = totalMs;

  for (const [unitKey, mult] of ladder) {
    const amount = Math.floor(remaining / mult);
    if (amount > 0) {
      parts.push(_formatPart(amount, unitKey, format));
      remaining -= amount * mult;
    }
  }


  if (parts.length === 0) {
    return format === 'short'
      ? `${totalMs}ms`
      : (format === 'fr-long' ? `${totalMs} milliseconde${totalMs > 1 ? 's' : ''}`
                              : `${totalMs} millisecond${totalMs > 1 ? 's' : ''}`);
  }

  return parts.join(' ');
}


function _formatPart(amount, unitKey, format) {
  const tbl = LABELS[format][unitKey];

  if (format === 'short') {
    return `${amount}${tbl}`;
  }

  const [singular, plural] = tbl;
  const word = amount > 1 ? plural : singular;
  return `${amount} ${word}`;
}


module.exports = {
  parseDuration,
  formatDuration,
};
