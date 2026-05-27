'use strict';


const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');
const { xpForLevel, levelFromXp } = require('../../modules/levels');

exports.help = {
  name       : 'xp',
  description: 'Gérer l\'XP des membres.',
  use        : 'xp <add|remove|reset|resetall|set> <@membre> [montant]',
  aliases    : ['setxp', 'managexp'],
  category   : 'levels',
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  const sub     = args[0]?.toLowerCase();

  if (!perms.check(message, 'xp')) return;

  if (!sub) return _sendHelp(message);

  switch (sub) {
    case 'add': {
      const { target, amount, error } = await _parseTargetAmount(message, args);
      if (error) return embed.replyError(message, error);

      db.addXpDirect(guildId, target.id, amount);

      const data = _recalculateLevel(guildId, target.id);
      return embed.reply(
        message,
        `**+${amount} XP** → <@${target.id}> (total : **${data.xp} XP**, niv. **${data.level}**)`
      );
    }

    case 'remove': {
      const { target, amount, error } = await _parseTargetAmount(message, args);
      if (error) return embed.replyError(message, error);

      db.removeXpDirect(guildId, target.id, amount);

      const data = _recalculateLevel(guildId, target.id);
      return embed.reply(
        message,
        `**-${amount} XP** → <@${target.id}> (total : **${data.xp} XP**, niv. **${data.level}**)`
      );
    }

    case 'set': {
      const { target, amount, error } = await _parseTargetAmount(message, args);
      if (error) return embed.replyError(message, error);

      const newLevel = _calcLevelFromXp(amount, guildId);
      db.setLevel(guildId, target.id, newLevel, amount);

      return embed.reply(
        message,
        `XP de <@${target.id}> défini à **${amount}** (niv. **${newLevel}**).`
      );
    }

    case 'reset': {
      const target = await _resolveMember(message, args[1]);
      if (!target) {
        return embed.replyError(message, 'Mentionnez un membre ou fournissez un ID.');
      }

      db.resetLevelUser(guildId, target.id);
      return embed.reply(message, `XP de <@${target.id}> réinitialisé.`);
    }

    case 'resetall': {
      await embed.reply(
        message,
        'Êtes-vous sûr de vouloir reset l\'XP de **tous les membres** ? Répondez `confirmer` dans les 15 secondes.'
      );

      const filter = m =>
        m.author.id === message.author.id &&
        m.content.toLowerCase() === 'confirmer';

      const collected = await message.channel.awaitMessages({
        filter,
        max : 1,
        time: 15_000,
      }).catch(() => null);

      if (!collected?.size) {
        return embed.reply(message, 'Reset annulé.');
      }

      db.resetLevelsGuild(guildId);

      return embed.reply(message, 'XP de tous les membres réinitialisé.');
    }

    default:
      return _sendHelp(message);
  }
};


async function _resolveMember(message, raw) {
  return message.mentions.members.first()
    ?? (raw ? await message.guild.members.fetch(raw).catch(() => null) : null);
}

async function _parseTargetAmount(message, args) {
  const target = await _resolveMember(message, args[1]);
  if (!target) {
    return { error: 'Mentionnez un membre ou fournissez un ID.' };
  }

  const amount = parseInt(args[2], 10);
  if (isNaN(amount) || amount <= 0) {
    return { error: 'Montant invalide (nombre positif requis).' };
  }

  return { target, amount };
}

function _recalculateLevel(guildId, userId) {
  const data     = db.getLevel(guildId, userId);
  const newLevel = _calcLevelFromXp(data.xp, guildId);

  db.setLevel(guildId, userId, newLevel, data.xp);

  return {
    ...db.getLevel(guildId, userId),
    level: newLevel,
  };
}

function _calcLevelFromXp(xp, guildId) {
  try {
    const config = db.getGuildConfig(guildId);
    return config?.levelCumul ? levelFromXp(xp) : _calcClassicLevel(xp);
  } catch {
    return _calcClassicLevel(xp);
  }
}

function _calcClassicLevel(xp) {
  let level = 0;

  while (xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level++;
  }

  return level;
}

function _sendHelp(message) {
  return embed.reply(message, null, {
    title : 'Gestion XP',
    fields: [
      {
        name  : 'xp add <@membre> <montant>',
        value : 'Ajouter de l\'XP',
        inline: false,
      },
      {
        name  : 'xp remove <@membre> <montant>',
        value : 'Retirer de l\'XP',
        inline: false,
      },
      {
        name  : 'xp set <@membre> <montant>',
        value : 'Définir un XP précis',
        inline: false,
      },
      {
        name  : 'xp reset <@membre>',
        value : 'Remettre l\'XP à zéro',
        inline: false,
      },
      {
        name  : 'xp resetall',
        value : 'Reset l\'XP de tout le serveur',
        inline: false,
      },
    ],
    timestamp: false,
  });
}
