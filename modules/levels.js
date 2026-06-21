'use strict';


const db           = require('../core/database');
const embed        = require('../utils/embed');
const errorHandler = require('../utils/errorHandler');
const { replaceVariables } = require('../utils/variables');

const XP_COOLDOWN_DEFAULT = 60;
const XP_MIN              = 15;
const XP_MAX              = 25;


function xpForLevel(level) {
  return 5 * (level ** 2) + 50 * level + 100;
}


function levelFromXp(xp) {
  let level = 0;
  let total = 0;
  while (total + xpForLevel(level) <= xp) {
    total += xpForLevel(level);
    level++;
  }
  return level;
}


async function process(client, message) {
  const { guild, member } = message;
  const guildId = guild.id;

  try {
    const config = db.getGuildConfig(guildId);
    if (!config?.levelEnabled) return;

    if (db.isXpIgnoredChannel(guildId, message.channel.id)) return;

    const now  = Math.floor(Date.now() / 1000);
    const data = db.getLevel(guildId, member.id);

    const cooldown = db.getXpChannelCooldown(guildId, message.channel.id) ?? XP_COOLDOWN_DEFAULT;
    if (now - data.lastXpAt < cooldown) return;

    let xpGain = Math.floor(Math.random() * (XP_MAX - XP_MIN + 1)) + XP_MIN;

    const multipliers = db.getXpRoleMultipliers(guildId);
    if (multipliers.length > 0) {
      const memberRoles = member.roles.cache;
      let bestMultiplier = 1.0;
      for (const { roleId, multiplier } of multipliers) {
        if (memberRoles.has(roleId) && multiplier > bestMultiplier) {
          bestMultiplier = multiplier;
        }
      }
      xpGain = Math.round(xpGain * bestMultiplier);
    }

    db.addXp(guildId, member.id, xpGain);

    const updated   = db.getLevel(guildId, member.id);
    const oldLevel  = data.level;
    const newLevel  = config.levelCumul
      ? levelFromXp(updated.xp)
      : _calcLevel(updated.xp);

    if (newLevel > oldLevel) {
      db.setLevel(guildId, member.id, newLevel, updated.xp);
      await _onLevelUp(client, message, newLevel, guildId, config);
    }

  } catch (err) {
    errorHandler.handle(err, { source: 'levels.process', guildId });
  }
}

function _calcLevel(xp) {
  let level = 0;
  while (xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level++;
  }
  return level;
}

async function _onLevelUp(client, message, newLevel, guildId, config) {
  try {

    const text = replaceVariables(
      config.levelUpMessage ?? 'GG {user}, tu passes niveau **{level}** !',
      {
        user   : message.author,
        member : message.member,
        guild  : message.guild,
        client,
        extras : { level: String(newLevel) },
      },
    );

    const channel = config.levelUpChannel
      ? message.guild.channels.cache.get(config.levelUpChannel) ?? message.channel
      : message.channel;

    if (channel?.isTextBased()) {

      const sent = await channel.send({
        embeds: [embed.build(guildId, text)],
      }).catch(() => null);

      if (sent) {
        setTimeout(() => {
          sent.delete().catch(() => {});
        }, config.levelDeleteDelay ?? 7000);
      }

    }

    try {
      const guildConfig = db.getGuildConfig(guildId);
      if (guildConfig?.levelLogChannel) {
        const logChannel = message.guild.channels.cache.get(guildConfig.levelLogChannel);
        if (logChannel?.isTextBased()) {
          await logChannel.send({
            embeds: [embed.build(guildId, null, {
              title       : 'Niveau gagné',
              description : `${message.author} a atteint le niveau **${newLevel}**`,
              color       : '#FEE75C',
              timestamp   : true,
            })],
            allowedMentions: { parse: [] },
          }).catch(() => {});
        }
      }
    } catch {}

    const serverLevelRoles = db.getLevelRoles(guildId);
    const casinoLevelRoles = db.getCasinoLevelRoles(guildId);
    if (!serverLevelRoles.length && !casinoLevelRoles.length) return;

    const guild  = message.guild;
    const member = message.member;

    const me = guild.members.me
      ?? await guild.members.fetchMe().catch(() => null);

    if (!me || !me.permissions.has('ManageRoles')) return;

    // Server level roles: respect levelCumul setting
    const serverToAdd = config.levelCumul
      ? serverLevelRoles.filter(r => r.level <= newLevel)
      : serverLevelRoles.filter(r => r.level === newLevel);
    const serverToRemove = config.levelCumul
      ? []
      : serverLevelRoles.filter(r => r.level !== newLevel && r.level < newLevel);

    // Casino level roles: always replace (remove old level role, give new one)
    const casinoToAdd    = casinoLevelRoles.filter(r => r.level === newLevel);
    const casinoToRemove = casinoLevelRoles.filter(r => r.level < newLevel);

    const toAdd    = [...serverToAdd,    ...casinoToAdd];
    const toRemove = [...serverToRemove, ...casinoToRemove];

    for (const row of toAdd) {
      const role = guild.roles.cache.get(row.roleId);
      if (!role || role.managed || role.id === guild.id) continue;
      if (role.position >= me.roles.highest.position) continue;
      if (member.roles.cache.has(role.id)) continue;
      await member.roles.add(role, 'Level up').catch(() => {});
    }

    for (const row of toRemove) {
      const role = guild.roles.cache.get(row.roleId);
      if (!role || role.managed || role.id === guild.id) continue;
      if (role.position >= me.roles.highest.position) continue;
      if (!member.roles.cache.has(role.id)) continue;
      await member.roles.remove(role, 'Level up').catch(() => {});
    }

  } catch (err) {
    errorHandler.handle(err, { source: 'levels.onLevelUp', guildId });
  }
}

module.exports = { process, xpForLevel, levelFromXp };
