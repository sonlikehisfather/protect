'use strict';


const db    = require('../../core/database');
const embed = require('../../utils/embed');

module.exports = {
  help: {
    name        : 'delsanction',
    description : 'Supprime une sanction précise de l’historique d’un utilisateur.',
    usage       : 'delsanction <membre> <numéro>',
    aliases     : ['removesanction'],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    const target = await resolveUser(client, message, [args[0]]);

    if (!target) {
      const sent = await embed.replyError(
        message,
        'Utilisateur introuvable.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const index = parseInt(args[1], 10);

    if (!index || isNaN(index) || index < 1) {
      const sent = await embed.replyError(
        message,
        'Vous devez fournir un numéro de sanction valide.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const sanctions = db.getSanctions(guildId, target.id);

    if (!sanctions.length) {
      const sent = await embed.replyError(
        message,
        `**${target.tag}** n'a aucune sanction.`,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const sanction = sanctions[index - 1];

    if (!sanction) {
      const sent = await embed.replyError(
        message,
        `La sanction n°${index} est introuvable.`,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const deleted = deleteSanction(db, sanction.id);

    if (!deleted) {
      const sent = await embed.replyError(
        message,
        'La suppression de la sanction a échoué.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `La sanction n°**${index}** de **${target.tag}** a été supprimée.`,
          {
            fields: [
              {
                name  : 'Type',
                value : formatTypeLabel(sanction.type),
                inline: true,
              },
              {
                name  : 'Raison',
                value : sanction.reason ?? 'Aucune raison',
                inline: false,
              },
            ],
            timestamp: false,
          }
        )
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
  },
};

async function resolveUser(client, message, args) {
  const mention = message.mentions.users.first();
  if (mention) return mention;

  const raw = args.join(' ').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[<@!>]/g, '').trim();

  if (/^\d{17,20}$/.test(cleaned)) {
    return client.users.fetch(cleaned).catch(() => null);
  }

  const lowered = raw.toLowerCase();

  let member = message.guild.members.cache.find(m =>
    m.user.username.toLowerCase() === lowered ||
    (m.user.globalName && m.user.globalName.toLowerCase() === lowered) ||
    m.displayName.toLowerCase() === lowered
  );

  if (member) return member.user;

  const fetchedMembers = await message.guild.members.fetch().catch(() => null);
  if (!fetchedMembers) return null;

  member = fetchedMembers.find(m =>
    m.user.username.toLowerCase() === lowered ||
    (m.user.globalName && m.user.globalName.toLowerCase() === lowered) ||
    m.displayName.toLowerCase() === lowered
  );

  return member?.user ?? null;
}

function formatTypeLabel(type) {
  const map = {
    warn   : 'WARN',
    mute   : 'MUTE',
    kick   : 'KICK',
    ban    : 'BAN',
    unmute : 'UNMUTE',
    unban  : 'UNBAN',
  };

  return map[type] ?? String(type || 'inconnu').toUpperCase();
}

function deleteSanction(databaseModule, sanctionId) {
  try {
    if (typeof databaseModule.deleteSanction === 'function') {
      databaseModule.deleteSanction(sanctionId);
      return true;
    }

    if (typeof databaseModule.softDeleteSanction === 'function') {
      databaseModule.softDeleteSanction(sanctionId);
      return true;
    }

    return false;
  } catch {
    return false;
  }
}
