'use strict';

const {
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require('discord.js');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

exports.help = {
  name       : 'unbl',
  description: 'Retirer un membre de la blacklist de ce serveur.',
  use        : 'unbl <@membre/ID>',
  usage      : 'unbl <@membre/ID>',
  category   : 'owner',
};

exports.run = async (client, message, args) => {
  const authorId = message.author.id;
  const guildId  = message.guild.id;

  if (!_canManage(message)) {
    return embed.replyError(message, 'Permission refusée.');
  }

  if (!args[0]) {
    return embed.replyError(message, 'Utilisation : `unbl <@membre/ID>`');
  }

  const target =
    message.mentions.users.first() ??
    await client.users.fetch(args[0]).catch(() => null);

  if (!target) {
    return embed.replyError(message, 'Utilisateur introuvable.');
  }

  if (db.isWet(target.id)) {
    return embed.replyError(message, `${target.username} est wet et ne peut être débanni qu’avec \`unwet\`.`);
  }

  const entry = db.getBlacklistEntry(guildId, target.id);

  if (!entry) {
    return embed.replyError(message, `${target.username} n'est pas dans la blacklist.`);
  }

  const progressDescription =
    `**Membre :** <@${target.id}> (\`${target.id}\`)\n\n` +
    `Retrait de la blacklist et débannissement en cours sur ce serveur...`;
  const panel = await message.channel.send(
    _statusPayload(guildId, `Unblacklist de ${target.username}`, progressDescription)
  ).catch(() => null);

  if (!panel) {
    return embed.replyError(message, 'Impossible d’afficher le suivi de l’unblacklist.');
  }

  try {
    db.removeBlacklist(guildId, target.id);
  } catch {
    const failure =
      `**Membre :** <@${target.id}> (\`${target.id}\`)\n\n` +
      `Impossible de retirer cette entrée de la blacklist de ce serveur.`;
    await panel.edit(_statusPayload(guildId, 'Unblacklist non effectué', failure)).catch(() => {});
    return;
  }

  const unbanned = await message.guild.bans.remove(target.id, 'Blacklist retirée')
    .then(() => true)
    .catch(() => false);
  const resultDescription =
    `**Membre :** <@${target.id}> (\`${target.id}\`)\n` +
    `**Blacklist retirée sur :** ${message.guild.name}\n` +
    `**Débannissement :** ${unbanned ? 'réussi' : 'échoué (le membre reste banni)'}`;

  return panel.edit(_statusPayload(guildId, 'Unblacklist terminé', resultDescription))
    .catch(() => {});
};

function _canManage(message) {
  const { author, guild, member } = message;
  if (perms.isBuyer(author.id) || perms.isOwner(guild.id, author.id)) return true;

  const roleIds = member.roles.cache.map(role => role.id);
  return db.getCmdTargets(guild.id, 'unbl').some(target =>
    (target.targetType === 'user' && target.targetId === author.id) ||
    (target.targetType === 'role' && roleIds.includes(target.targetId))
  );
}

function _statusPayload(guildId, title, description) {
  if (embed.shouldUseV2(guildId, module.exports.help.name)) {
    try {
      const container = new ContainerBuilder();
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n\n${description}`));
      return {
        embeds          : [],
        components      : [container],
        flags           : COMPONENTS_V2_FLAG,
        allowedMentions : { parse: [] },
      };
    } catch {}
  }

  return {
    embeds          : [embed.build(guildId, description, { title, timestamp: false })],
    components      : [],
    allowedMentions : { parse: [] },
  };
}
