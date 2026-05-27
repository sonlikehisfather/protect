'use strict';

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

exports.help = {
  name        : 'raidping',
  description : 'Configurer le rôle pingé lors d’un raid.',
  usage       : 'raidping <@rôle|off>',
};

exports.run = async (client, message, args) => {
  const guildId = message.guild.id;
  const config  = db.getGuildConfig(guildId);

  if (!perms.check(message, 'raidping')) return;

  const deleteCmd   = Boolean(config?.autoDeleteModCmds);
  const deleteReply = Boolean(config?.autoDeleteModReplies);
  const deleteDelay = config?.autoDeleteDelay ?? 5;

  if (deleteCmd) {
    await message.delete().catch(() => {});
  }

  if (args[0]?.toLowerCase() === 'off') {
    const currentRoleId = db.getAntiraidConfig(guildId)?.raidPingRole ?? null;
    if (!currentRoleId) {
      const sent = await embed.replyError(
        message,
        'Le raidping est déjà désactivé.',
        { timestamp: false }
      ).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    db.setAntiraidConfig(guildId, 'raidPingRole', null);

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          'Raidping désactivé.',
          { timestamp: false }
        )
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  const role = message.mentions.roles.first();
  if (!role) {
    const sent = await embed.replyError(
      message,
      'Mentionnez un rôle ou utilisez `off` pour désactiver le raidping.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
    return;
  }

  const currentRoleId = db.getAntiraidConfig(guildId)?.raidPingRole ?? null;
  if (currentRoleId === role.id) {
    const sent = await embed.replyError(
      message,
      `Le rôle <@&${role.id}> est déjà configuré comme raidping.`,
      { timestamp: false }
    ).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  db.setAntiraidConfig(guildId, 'raidPingRole', role.id);

  const sent = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        `Raidping configuré : <@&${role.id}>.`,
        { timestamp: false }
      )
    ],
    allowedMentions: { repliedUser: false },
  }).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
};
