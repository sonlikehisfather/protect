'use strict';

const {
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require('discord.js');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder === 'function' &&
                           typeof TextDisplayBuilder === 'function';

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
      const text = '## Top invitations\n\n> Aucune invitation enregistr\u00e9e pour ce serveur.';
      let sent = null;
      if (embed.shouldUseV2(guildId, module.exports.help.name)) {
        try {
          const container = new ContainerBuilder();
          container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
          sent = await message.channel.send({
            components      : [container],
            flags           : COMPONENTS_V2_FLAG,
            allowedMentions : { parse: [] },
          }).catch(() => null);
        } catch {}
      }
      if (!sent) {
        sent = await embed.sendEmbed(message.channel, guildId, 'Aucune invitation enregistr\u00e9e pour ce serveur.', { timestamp: false });
      }
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const lines = rows.map((r, i) => {
      const total = r.regular + r.bonus;
      return `**${i + 1}.** <@${r.userId}> \u2022 \`${total}\` *(${r.regular} reg \u2022 ${r.bonus} bonus \u2022 ${r.left_count} partis)*`;
    });

    const text = `## Top invitations\n\n${lines.join('\n')}`;

    let sent = null;

    if (embed.shouldUseV2(guildId, module.exports.help.name)) {
      try {
        const container = new ContainerBuilder();
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
        sent = await message.channel.send({
          components      : [container],
          flags           : COMPONENTS_V2_FLAG,
          allowedMentions : { parse: [] },
        }).catch(() => null);
      } catch {}
    }

    if (!sent) {
      sent = await embed.sendEmbed(message.channel, guildId, lines.join('\n'), { title: 'Top invitations', timestamp: false });
    }
    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
  },
};
