'use strict';

const { loadImage } = require('skia-canvas');

const CACHE = new Map();
const TTL = 5 * 60 * 1000;

async function loadAvatar(url) {
  const cached = CACHE.get(url);
  if (cached && Date.now() - cached.ts < TTL) {
    return cached.img;
  }
  const img = await loadImage(url);
  CACHE.set(url, { img, ts: Date.now() });
  if (CACHE.size > 50) {
    const oldest = CACHE.keys().next().value;
    CACHE.delete(oldest);
  }
  return img;
}

function clearAvatarCache() {
  CACHE.clear();
}

module.exports = { loadAvatar, clearAvatarCache };
