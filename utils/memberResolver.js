'use strict';


async function resolveMember(message, args) {
  const raw = args[0]?.trim();
  if (!raw) return null;

  const guild = message.guild;


  const mentionMatch = raw.match(/^<@!?(\d{17,20})>$/);
  if (mentionMatch) {
    const id = mentionMatch[1];
    return guild.members.cache.get(id)
      ?? await guild.members.fetch(id).catch(() => null);
  }

  const cleaned = raw.replace(/[<@!>]/g, '').trim();
  if (/^\d{17,20}$/.test(cleaned)) {
    return guild.members.cache.get(cleaned)
      ?? await guild.members.fetch(cleaned).catch(() => null);
  }

  const lowered = raw.toLowerCase();

  let member = guild.members.cache.find(m =>
    m.user.username.toLowerCase()                         === lowered ||
    (m.user.globalName && m.user.globalName.toLowerCase() === lowered) ||
    m.displayName.toLowerCase()                           === lowered
  );
  if (member) return member;

  const fetchedMembers = await guild.members.fetch().catch(() => null);
  if (!fetchedMembers) return null;

  member = fetchedMembers.find(m =>
    m.user.username.toLowerCase()                         === lowered ||
    (m.user.globalName && m.user.globalName.toLowerCase() === lowered) ||
    m.displayName.toLowerCase()                           === lowered
  );

  return member ?? null;
}

module.exports = { resolveMember };
