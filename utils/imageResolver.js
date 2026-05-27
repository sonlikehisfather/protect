'use strict';


const DEFAULT_MAX_BYTES   = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS  = 15_000;
const DEFAULT_USER_AGENT  = 'Mozilla/5.0 (compatible; DiscordBot)';

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

const TRUSTED_HOSTS = [
  'cdn.discordapp.com',
  'media.discordapp.net',
  'i.imgur.com',
  'imgur.com',
  'media.tenor.com',
  'tenor.com',
  'media.giphy.com',
  'giphy.com',
  'i.pinimg.com',
  'pinimg.com',
];

function isUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isImageUrl(value) {
  if (!isUrl(value)) return false;

  try {
    const { pathname, hostname } = new URL(value);
    const path = pathname.toLowerCase();

    if (IMAGE_EXTENSIONS.some(ext => path.endsWith(ext))) return true;

    if (TRUSTED_HOSTS.some(h => hostname === h || hostname.endsWith('.' + h))) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}


function resolveImageUrl(input) {
  const value = String(input || '').trim();
  if (!value) return null;
  return isUrl(value) ? value : null;
}


function resolveImageInput(message, input) {
  const value = String(input || '').trim();
  if (value) return value;

  const attachments = message?.attachments;
  if (!attachments) return null;

  const finder = typeof attachments.find === 'function'
    ? attachments
    : Array.isArray(attachments) ? attachments : null;

  if (!finder) return null;

  const attachment = finder.find(file =>
    file?.url && (
      (typeof file.contentType === 'string' && file.contentType.toLowerCase().startsWith('image/')) ||
      isImageUrl(file.url)
    )
  );

  return attachment?.url || null;
}


async function downloadImage(url, options = {}) {
  const maxBytes  = Number.isFinite(options.maxBytes)  ? options.maxBytes  : DEFAULT_MAX_BYTES;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const userAgent = options.userAgent || DEFAULT_USER_AGENT;

  if (!isUrl(url)) {
    return { ok: false, error: 'URL invalide.' };
  }

  if (typeof fetch !== 'function') {
    return { ok: false, error: 'fetch indisponible (Node 18+ requis).' };
  }

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      redirect : 'follow',
      signal   : controller.signal,
      headers  : {
        'User-Agent' : userAgent,
        'Accept'     : 'image/*,*/*;q=0.8',
      },
    });
  } catch (err) {
    clearTimeout(timer);
    if (err?.name === 'AbortError') {
      return { ok: false, error: 'Telechargement trop long (timeout).' };
    }
    return { ok: false, error: `Telechargement impossible : ${err?.message || 'erreur reseau'}.` };
  }
  clearTimeout(timer);

  if (!res.ok) {
    return { ok: false, error: `URL inaccessible (HTTP ${res.status}).` };
  }

  const rawCt = String(res.headers.get('content-type') || '').toLowerCase();
  const mime  = (rawCt.split(';')[0] || '').trim();

  if (!mime.startsWith('image/')) {
    return { ok: false, error: `Le contenu n'est pas une image (content-type: ${mime || 'inconnu'}).` };
  }

  const declaredSize = Number(res.headers.get('content-length') || 0);
  if (declaredSize && declaredSize > maxBytes) {
    return {
      ok    : false,
      error : `Image trop volumineuse (${Math.round(declaredSize / 1024 / 1024)} Mo, max ${Math.round(maxBytes / 1024 / 1024)} Mo).`,
    };
  }

  let buffer;
  try {
    const ab = await res.arrayBuffer();
    buffer   = Buffer.from(ab);
  } catch (err) {
    return { ok: false, error: `Lecture du fichier impossible : ${err?.message || 'erreur inconnue'}.` };
  }

  const validation = validateImageBuffer(buffer, mime, { maxBytes });
  if (!validation.ok) return validation;

  return {
    ok          : true,
    buffer,
    contentType : validation.contentType,
    dataUri     : `data:${validation.contentType};base64,${buffer.toString('base64')}`,
  };
}


function validateImageBuffer(buffer, contentType, options = {}) {
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : DEFAULT_MAX_BYTES;

  if (!Buffer.isBuffer(buffer) || buffer.byteLength === 0) {
    return { ok: false, error: 'Buffer image vide ou invalide.' };
  }

  if (buffer.byteLength > maxBytes) {
    return {
      ok    : false,
      error : `Image trop volumineuse (${Math.round(buffer.byteLength / 1024 / 1024)} Mo, max ${Math.round(maxBytes / 1024 / 1024)} Mo).`,
    };
  }

  const mime = String(contentType || '').toLowerCase().split(';')[0].trim();

  if (!mime.startsWith('image/')) {
    return { ok: false, error: `Content-type non-image (${mime || 'inconnu'}).` };
  }

  const normalized = mime === 'image/jpg' ? 'image/jpeg' : mime;

  return { ok: true, contentType: normalized };
}

module.exports = {
  isUrl,
  isImageUrl,
  resolveImageUrl,
  resolveImageInput,
  downloadImage,
  validateImageBuffer,
  DEFAULT_MAX_BYTES,
  DEFAULT_TIMEOUT_MS,
  IMAGE_EXTENSIONS,
  TRUSTED_HOSTS,
};
