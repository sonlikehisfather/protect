'use strict';


const db = require('../core/database');


const LEVELS = {
  EVERYONE: 'everyone',
  PUBLIC: 'public',
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
  8: 8,
  9: 9,
  OWNER: 'owner',
  BUYER: 'buyer',
};


function getSuperAdminId() {
  return process.env.BUYER_ID;
}

function getBuyerId() {
  return getSuperAdminId();
}

function isSuperAdmin(userId) {
  return userId === getSuperAdminId();
}

function isBuyer(userId) {
  if (isSuperAdmin(userId)) return true;
  try {
    return db.isGlobalBuyer(userId);
  } catch {
    return false;
  }
}


function isOwner(guildId, userId) {
  return db.isOwner(guildId, userId);
}

function isGlobalBuyer(userId) {
  return isBuyer(userId);
}


function check(message, commandName) {

  const { member, guild, channel } = message;
  if (!member || !guild) return false;

  const userId  = member.id;
  const guildId = guild.id;

  if (isBuyer(userId)) return true;

  const required =
    db.getCmdPerm(guildId, commandName)
    ?? 'everyone';

  if (required === 'buyer') {
    return isBuyer(userId);
  }

  if (isOwner(guildId, userId)) {
    return true;
  }

  if (required === 'owner') {
    return isOwner(guildId, userId);
  }

  if (required === 'everyone') {
    return true;
  }

  if (required === 'public') {

    const config = db.getGuildConfig(guildId);
    if (config?.publicEnabled) return true;

    const publicChannels =
      db.getPublicChannels(guildId);

    if (!Array.isArray(publicChannels))
      return false;

    return publicChannels.some(c =>
      typeof c === 'string'
        ? c === channel.id
        : c.channelId === channel.id
    );
  }


  const requiredLevel =
    parseInt(required, 10);

  if (isNaN(requiredLevel))
    return false;

  return (
    getMemberLevel(member, guildId)
    >= requiredLevel
  );
}


function getMemberLevel(member, guildId) {

  const permLevels =
    db.getPermLevels(guildId);

  if (!permLevels.length)
    return 0;

  const memberRoleIds =
    member.roles.cache.map(r => r.id);

  let highest = 0;

  for (const row of permLevels) {

    const match =
      (row.targetType === 'user'
        && row.targetId === member.id)

      ||

      (row.targetType === 'role'
        && memberRoleIds.includes(row.targetId));

    if (match && row.level > highest) {
      highest = row.level;
    }
  }

  return highest;
}

function _getMemberLevel(member, guildId) {
  return getMemberLevel(member, guildId);
}


function hasLevel(member, guildId, minLevel) {

  if (!member)
    return false;

  if (isBuyer(member.id))
    return true;

  if (isOwner(guildId, member.id))
    return true;

  return (
    getMemberLevel(member, guildId)
    >= minLevel
  );
}


function isProtected(
  targetId,
  guildId,
  targetMember = null
) {


  if (isBuyer(targetId))
    return true;

  if (targetId === process.env.CLIENT_ID)
    return true;


  if (isOwner(guildId, targetId))
    return true;


  const whitelist =
    db.getAntiraidWhitelist(guildId);

  for (const entry of whitelist) {

    if (
      entry.targetType === 'user'
      &&
      entry.targetId === targetId
    ) return true;

    if (
      entry.targetType === 'role'
      &&
      targetMember?.roles.cache.has(entry.targetId)
    ) return true;
  }

  return false;
}


function parsePerm(input) {

  if (!input)
    return null;

  const s =
    input.toLowerCase().trim();

  const withPrefix =
    s.match(/^perm([1-9])$/);

  if (withPrefix)
    return withPrefix[1];

  if (/^[1-9]$/.test(s))
    return s;

  if (
    ['owner', 'buyer', 'public', 'everyone']
    .includes(s)
  ) return s;

  return null;
}


function permLabel(perm) {

  const labels = {
    buyer   : 'Buyer',
    owner   : 'Owner',
    public  : 'Public',
    everyone: 'Everyone',
  };

  if (labels[perm])
    return labels[perm];

  if (/^[1-9]$/.test(perm))
    return `Perm ${perm}`;

  return perm;
}


function canEditPerm(message, targetPerm, guildId = null) {

  if (!message?.author)
    return false;

  const userId = message.author.id;


  if (isSuperAdmin(userId))
    return true;


  if (isBuyer(userId)) {

    if (targetPerm === 'buyer')
      return false;

    return true;
  }


  if (guildId && isOwner(guildId, userId)) {

    if (targetPerm === 'buyer')
      return false;

    if (targetPerm === 'owner')
      return false;

    return true;
  }

  return false;
}


module.exports = {

  LEVELS,

  isSuperAdmin,
  isBuyer,
  isGlobalBuyer,
  getBuyerId,
  getSuperAdminId,
  isOwner,

  check,

  getMemberLevel,
  hasLevel,

  isProtected,

  parsePerm,
  permLabel,

  canEditPerm,

};
