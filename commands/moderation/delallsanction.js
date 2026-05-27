'use strict';


const db    = require('../../core/database');
const embed = require('../../utils/embed');

module.exports = {
  help: {
    name        : 'delallsanction',
    description : 'Supprime toutes les sanctions d’un utilisateur.',
    usage       : 'delallsanction <membre>',
    aliases     : ['clearinfractions', 'clearsanctions'],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    const target = await resolveUser(client, message, args);

    if (!target) {
      const sent = await embed.replyError(
        message,
        'Utilisateur introuvable.',
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

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const deletedCount = deleteAllSanctions(db, sanctions);

    if (deletedCount <= 0) {
      const sent = await embed.replyError(
        message,
        'La suppression des sanctions a échoué.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          `**${deletedCount}** sanction(s) de **${target.tag}** ont été supprimée(s).`,
          { timestamp: false }
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

function deleteAllSanctions(databaseModule, sanctions) {
  let count = 0;

  try {
    if (typeof databaseModule.deleteSanction === 'function') {
      for (const sanction of sanctions) {
        databaseModule.deleteSanction(sanction.id);
        count++;
      }
      return count;
    }

    if (typeof databaseModule.softDeleteSanction === 'function') {
      for (const sanction of sanctions) {
        databaseModule.softDeleteSanction(sanction.id);
        count++;
      }
      return count;
    }

    return 0;
  } catch {
    return count;
  }
}
