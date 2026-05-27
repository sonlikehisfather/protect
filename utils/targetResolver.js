'use strict';


async function resolveOne(guild, input) {
  input = input.trim();
  if (!input) return { member: null, ambiguous: false };

  const mentionMatch = input.match(/^<@!?(\d{17,20})>$/);
  if (mentionMatch) {
    const id = mentionMatch[1];
    const cached = guild.members.cache.get(id);
    if (cached) return { member: cached, ambiguous: false };
    const fetched = await guild.members.fetch(id).catch(() => null);
    return { member: fetched, ambiguous: false };
  }

  const cleaned = input.replace(/[<@!>]/g, '').trim();
  if (/^\d{17,20}$/.test(cleaned)) {
    const cached = guild.members.cache.get(cleaned);
    if (cached) return { member: cached, ambiguous: false };
    const fetched = await guild.members.fetch(cleaned).catch(() => null);
    return { member: fetched, ambiguous: false };
  }

  const lowered = input.toLowerCase();
  const matches = guild.members.cache.filter(m =>
    m.user.username.toLowerCase() === lowered ||
    (m.user.globalName && m.user.globalName.toLowerCase() === lowered) ||
    m.displayName.toLowerCase() === lowered
  );

  if (matches.size === 1) return { member: matches.first(), ambiguous: false };
  if (matches.size > 1)  return { member: null, ambiguous: true };

  return { member: null, ambiguous: false };
}


async function resolveTargets(guild, args, options = {}) {
  const maxTargets   = options.maxTargets   ?? 10;
  const maxNameWords = options.maxNameWords ?? 3;

  if (options.fetchAllForNames) {
    await guild.members.fetch().catch(() => null);
  }

  const members     = [];
  const notFound    = [];
  const ambiguous   = [];
  const rawTargets  = [];
  const seen        = new Set();
  let   dupsSkipped = 0;
  let   consumed    = 0;

  function addOrDedup(member, raw) {
    if (seen.has(member.id)) {
      dupsSkipped++;
    } else {
      members.push(member);
      seen.add(member.id);
      rawTargets.push(raw);
    }
  }

  while (consumed < args.length && members.length < maxTargets) {
    const token = args[consumed];

    if (token === ',') {
      consumed++;
      continue;
    }


    if (typeof token === 'string' && token.includes(',,')) {
      const segments = token.split(/,{2,}/).map(s => s.trim()).filter(Boolean);

      let segIdx  = 0;
      let stopped = false;

      for (; segIdx < segments.length; segIdx++) {
        if (members.length >= maxTargets) break;

        const seg = segments[segIdx];
        const r = await resolveOne(guild, seg);

        if (r.member) {
          addOrDedup(r.member, seg);
        } else if (r.ambiguous) {
          ambiguous.push(seg);
        } else {
          stopped = true;
          break;
        }
      }

      if (stopped) {
        const remaining = segments.slice(segIdx).join(',,');
        const rest      = args.slice(consumed + 1);
        const reason    = (remaining + (rest.length ? ' ' + rest.join(' ') : '')).trim();

        return {
          members,
          notFound,
          ambiguous,
          duplicatesSkipped: dupsSkipped,
          reason,
          rawTargets,
          limitExceeded: false,
        };
      }


      if (members.length >= maxTargets && segIdx < segments.length) {
        const remaining = segments.slice(segIdx).join(',,');
        const rest      = args.slice(consumed + 1);
        const reason    = (remaining + (rest.length ? ' ' + rest.join(' ') : '')).trim();

        return {
          members,
          notFound,
          ambiguous,
          duplicatesSkipped: dupsSkipped,
          reason,
          rawTargets,
          limitExceeded: true,
        };
      }

      consumed++;
      continue;
    }

    if (token.includes(',')) {
      const parts = token.split(',').map(p => p.trim()).filter(Boolean);
      for (const part of parts) {
        const result = await resolveOne(guild, part);
        if (result.member) {
          addOrDedup(result.member, part);
        } else if (result.ambiguous) {
          ambiguous.push(part);
        } else {
          notFound.push(part);
        }
      }
      consumed++;
      if (members.length > maxTargets) {
        const reason = args.slice(consumed).join(' ').trim();
        return {
          members, notFound, ambiguous,
          duplicatesSkipped: dupsSkipped,
          reason, rawTargets, limitExceeded: true,
        };
      }
      continue;
    }

    const result = await resolveOne(guild, token);

    if (result.member) {
      addOrDedup(result.member, token);
      consumed++;
      continue;
    }

    if (result.ambiguous) {
      ambiguous.push(token);
      consumed++;
      continue;
    }

    let found = false;
    const maxLen = Math.min(maxNameWords, args.length - consumed);

    for (let len = 2; len <= maxLen; len++) {
      const multi = args.slice(consumed, consumed + len).join(' ');
      const mResult = await resolveOne(guild, multi);

      if (mResult.member) {
        addOrDedup(mResult.member, multi);
        consumed += len;
        found = true;
        break;
      }

      if (mResult.ambiguous) {
        ambiguous.push(multi);
        consumed += len;
        found = true;
        break;
      }
    }

    if (!found) break;
  }


  let limitExceeded = false;
  if (members.length >= maxTargets && consumed < args.length) {
    limitExceeded = await _looksLikeTarget(guild, args, consumed, maxNameWords);
  }

  const reason = args.slice(consumed).join(' ').trim();

  return {
    members,
    notFound,
    ambiguous,
    duplicatesSkipped: dupsSkipped,
    reason,
    rawTargets,
    limitExceeded,
  };
}

async function _looksLikeTarget(guild, args, index, maxNameWords) {
  const token = args[index];
  if (!token) return false;

  if (/^<@!?\d{17,20}>$/.test(token)) return true;

  if (/^\d{17,20}$/.test(token)) return true;

  if (token.includes(',')) {
    const parts = token.split(',').map(p => p.trim()).filter(Boolean);
    return parts.some(p => /^<@!?\d{17,20}>$/.test(p) || /^\d{17,20}$/.test(p));
  }

  const single = await resolveOne(guild, token);
  if (single.member || single.ambiguous) return true;

  const maxLen = Math.min(maxNameWords, args.length - index);
  for (let len = 2; len <= maxLen; len++) {
    const multi = args.slice(index, index + len).join(' ');
    const mResult = await resolveOne(guild, multi);
    if (mResult.member || mResult.ambiguous) return true;
  }

  return false;
}

module.exports = { resolveTargets, resolveOne };
