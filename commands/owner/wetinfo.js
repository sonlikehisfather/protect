'use strict';

const {
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);

module.exports = {
  help: {
    name        : 'wetinfo',
    description : 'Afficher les informations de wet d’un utilisateur.',
    usage       : 'wetinfo <@membre/ID>',
    category    : 'owner',
    defaultPermission: 'buyer',
    selfManaged : true,
  },

  async run(client, message, args) {
    if (!_canView(message)) {
      return embed.replyError(message, 'Permission refusée.');
    }

    const userId = message.mentions.users.first()?.id
      ?? args[0]?.replace(/[<@!>]/g, '');
    if (!userId || !/^\d{17,20}$/.test(userId)) {
      return embed.replyError(message, 'Utilisation : `wetinfo <@membre/ID>`');
    }

    const entry = db.getWetEntry(userId);
    if (!entry) {
      const target = await client.users.fetch(userId).catch(() => null);
      const label = target ? `<@${target.id}>` : `\`${userId}\``;
      return embed.replyError(message, `${label} n’est pas wet.`);
    }

    const target = await client.users.fetch(userId).catch(() => null);
    const title = target
      ? `<@${userId}> \`${userId}\``
      : `\`${userId}\``;
    const body = [
      `## ${title}`,
      '',
      `**Statut** › Wet`,
      `**Raison** › ${entry.reason || 'Aucune raison fournie'}`,
      `**Wet par** › <@${entry.addedBy}>`,
      '',
      `-# Wet depuis <t:${entry.addedAt}:f>`,
    ].join('\n');

    if (embed.shouldUseV2(message.guild.id, module.exports.help.name)) {
      const container = new ContainerBuilder();
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
      return message.channel.send({
        embeds          : [],
        components      : [container],
        flags           : COMPONENTS_V2_FLAG,
        allowedMentions : { parse: [] },
      });
    }

    return message.channel.send({
      embeds: [embed.build(message.guild.id, body, { timestamp: false })],
      allowedMentions: { parse: [] },
    });
  },
};

function _canView(message) {
  const { author, guild, member } = message;
  if (perms.isBuyer(author.id)) return true;

  const roleIds = member.roles.cache.map(role => role.id);
  return db.getCmdTargets(guild.id, 'wet').some(target =>
    (target.targetType === 'user' && target.targetId === author.id) ||
    (target.targetType === 'role' && roleIds.includes(target.targetId))
  );
}
