'use strict';


const db    = require('../../core/database');
const embed = require('../../utils/embed');

module.exports = {
  help: {
    name        : 'baninfo',
    description : 'Affiche les informations d’un utilisateur banni.',
    usage       : 'baninfo <id>',
    aliases     : ['binfo', 'infoban'],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    const userId = args[0]?.trim();

    if (!userId || !/^\d{17,20}$/.test(userId)) {
      const sent = await embed.replyError(
        message,
        'Veuillez fournir un ID Discord valide.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const ban = await guild.bans.fetch(userId).catch(() => null);

    if (!ban) {
      const sent = await embed.replyError(
        message,
        'Cet utilisateur n’est pas banni.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const activeBan = db.getActiveSanction
      ? db.getActiveSanction(guildId, userId, 'ban')
      : null;

    let statusText = 'Banni définitivement';
    let endText    = 'Aucune';
    let reasonText = ban.reason || 'Aucune raison fournie';
    let modText    = 'Inconnu';

    if (activeBan) {
      if (activeBan.reason) {
        reasonText = activeBan.reason;
      }

      if (activeBan.moderatorId) {
        modText = await _resolveModeratorTag(client, guild, activeBan.moderatorId);
      }

      if (activeBan.duration && activeBan.createdAt) {
        const endTs = activeBan.createdAt + activeBan.duration;

        if (endTs > Math.floor(Date.now() / 1000)) {
          statusText = 'Banni temporairement';
          endText    = `<t:${endTs}:f>`;
        }
      }
    }

    const sent = await message.channel.send({
      embeds: [
        embed.build(guildId, null, {
          title  : 'Informations du bannissement',
          fields : [
            {
              name  : 'Utilisateur',
              value : `<@${ban.user.id}> (${ban.user.tag}) \`${ban.user.id}\``,
              inline: false,
            },
            {
              name  : 'Profil',
              value : `https://discord.com/users/${ban.user.id}`,
              inline: false,
            },
            {
              name  : 'Statut',
              value : statusText,
              inline: false,
            },
            {
              name  : 'Fin du bannissement',
              value : endText,
              inline: false,
            },
            {
              name  : 'Modérateur',
              value : modText,
              inline: false,
            },
            {
              name  : 'Raison',
              value : _truncate(reasonText),
              inline: false,
            },
          ],
          timestamp: false,
        })
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
  },
};

async function _resolveModeratorTag(client, guild, moderatorId) {
  if (!moderatorId) return 'Inconnu';

  if (client.user?.id === moderatorId) {
    return client.user.tag;
  }

  const member = await guild.members.fetch(moderatorId).catch(() => null);
  if (member) return member.user.tag;

  const user = await client.users.fetch(moderatorId).catch(() => null);
  if (user) return user.tag;

  return `<@${moderatorId}> (\`${moderatorId}\`)`;
}

function _truncate(text, max = 300) {
  const value = String(text || 'Aucune raison fournie').trim();
  const cut   = value.length <= max ? value : `${value.slice(0, max - 3)}...`;
  return embed.breakLongTokens(cut);
}
