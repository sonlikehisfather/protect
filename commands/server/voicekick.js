'use strict';


const {
  PermissionsBitField,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

module.exports = {
  help: {
    name        : 'voicekick',
    description : 'Déconnecte un ou plusieurs membres de leur salon vocal actuel.',
    usage       : 'voicekick <membre>',
    aliases     : [],
    multi       : true,
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;

    if (!perms.check(message, 'voicekick')) return;

    const config = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

    if (!me || !me.permissions.has(PermissionsBitField.Flags.MoveMembers)) {
      const sent = await embed.replyError(
        message,
        'Je n\'ai pas la permission de déplacer des membres.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (!args.length) {
      const sent = await embed.replyError(
        message,
        `Utilisation : \`${message.prefix || '+'}voicekick <membre>\``,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const targets = await _resolveMembers(guild, message, args);

    if (!targets.length) {
      const sent = await embed.replyError(
        message,
        'Aucun membre valide trouvé.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    let kicked         = 0;
    let failed         = 0;
    let notConnected   = 0;
    let protectedCount = 0;

    for (const member of targets) {
      if (!member.voice?.channelId) {
        notConnected++;
        continue;
      }

      if (perms.isProtected(member.id, guildId, member)) {
        protectedCount++;
        continue;
      }

      if (
        message.member.id !== guild.ownerId &&
        member.roles.highest.position >= message.member.roles.highest.position
      ) {
        protectedCount++;
        continue;
      }

      const ok = await member.voice.disconnect(
        `Voicekick par ${message.author.username}`
      ).then(() => true).catch(() => false);

      if (ok) kicked++; else failed++;
    }

    const text =
      `**Membres ciblés**\n` +
      `\`${targets.length}\`\n\n` +
      `**Déconnectés**\n` +
      `\`${kicked}\`\n\n` +
      `**Non connectés**\n` +
      `\`${notConnected}\`\n\n` +
      `**Protégés**\n` +
      `\`${protectedCount}\`\n\n` +
      `**Échecs**\n` +
      `\`${failed}\``;

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          text,
          {
            title     : 'Voicekick terminé',
            timestamp : false,
          }
        ),
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
  },
};

async function _resolveMembers(guild, message, args) {
  const members = new Map();

  for (const member of message.mentions.members.values()) {
    members.set(member.id, member);
  }

  for (const arg of args) {
    const clean = arg.replace(/[<@!>]/g, '');

    if (!/^\d{17,20}$/.test(clean)) continue;

    const member =
      guild.members.cache.get(clean) ??
      await guild.members.fetch(clean).catch(() => null);

    if (member) {
      members.set(member.id, member);
    }
  }

  return [...members.values()];
}
