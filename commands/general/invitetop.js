'use strict';

const db    = require('../../core/database');
const embed = require('../../utils/embed');

module.exports = {
  help: {
    name        : 'invitetop',
    description : 'Classement des invitations du serveur.',
    usage       : 'invitetop',
    aliases     : ['invtop', 'invlb'],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;

    const config      = db.getGuildConfig(guildId);
    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) await message.delete().catch(() => {});

    const rows = db.getInviteLeaderboard(guildId, 10);

    if (!rows.length) {
      const sent = await message.channel.send({
        embeds: [embed.build(guildId, 'Aucune invitation enregistrée pour ce serveur.', { timestamp: false })],
        allowedMentions: { parse: [] },
      }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const lines = rows.map((r, i) => {
      const total = r.regular + r.bonus;
      return `**${i + 1}.** <@${r.userId}> ・ \`${total}\` *(${r.regular} reg · ${r.bonus} bonus · ${r.left_count} partis)*`;
    });

    const sent = await message.channel.send({
      embeds: [embed.build(guildId, lines.join('\n'), { title: 'Top invitations', timestamp: false })],
      allowedMentions: { parse: [] },
    }).catch(() => null);
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
  },
};
