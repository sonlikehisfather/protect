'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const db     = require('../../core/database');
const embed  = require('../../utils/embed');

const PAGE_SIZE  = 10;
const IDLE_MS    = 300_000;
const TIMEOUT_MS = 900_000;

module.exports = {
  help: {
    name        : 'mutelist',
    description : 'Affiche la liste des membres actuellement mute.',
    usage       : 'mutelist',
    aliases     : ['mlist', 'listmute'],
  },

  async run(client, message) {
    const guild   = message.guild;
    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;
    const muteRoleId  = config?.muteRoleId ?? null;

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    if (guild.members.cache.size < guild.memberCount)
      await guild.members.fetch().catch(() => null);

    const rows = new Map();

    for (const member of guild.members.cache.values()) {
      const lines = [];

      if (member.communicationDisabledUntilTimestamp && member.communicationDisabledUntilTimestamp > Date.now()) {
        lines.push(`timeout jusqu'à <t:${Math.floor(member.communicationDisabledUntilTimestamp / 1000)}:f>`);
      }

      if (muteRoleId && member.roles.cache.has(muteRoleId)) {
        lines.push('rôle mute');
      }

      if (lines.length) {
        rows.set(member.id, `• <@${member.id}> **${member.user.tag}** (\`${member.id}\`) - ${lines.join(' • ')}`);
      }
    }

    const entries = [...rows.values()];

    if (!entries.length) {
      const sent = await message.channel.send({
        embeds: [
          embed.build(guildId, 'Aucun membre n’est actuellement mute.', { timestamp: false })
        ],
        allowedMentions: { repliedUser: false },
      }).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const pages = [];
    for (let i = 0; i < entries.length; i += PAGE_SIZE) {
      const chunk = entries.slice(i, i + PAGE_SIZE);
      pages.push(
        embed.build(guildId, null, {
          title  : 'Liste des membres mute',
          fields : [
            {
              name  : 'Membres',
              value : chunk.join('\n'),
              inline: false,
            },
          ],
          footer    : `Page ${Math.floor(i / PAGE_SIZE) + 1}/${Math.ceil(entries.length / PAGE_SIZE)} • Total : ${entries.length}`,
          timestamp : false,
        })
      );
    }

    let current = 0;

    const buildRows = (disabled = false) => [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('mutelist:prev')
          .setLabel('\u2190')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || current === 0),
        new ButtonBuilder()
          .setCustomId('mutelist:next')
          .setLabel('\u2192')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || current === pages.length - 1),
        new ButtonBuilder()
          .setCustomId('mutelist:close')
          .setLabel('\u2716')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(disabled),
      ),
    ];

    const msg = await message.channel.send({
  embeds: [pages[current]],
  components: pages.length > 1 ? buildRows() : [],
  allowedMentions: { repliedUser: false },
}).catch(() => null);

    if (!msg) return;

    if (pages.length <= 1) {
  if (deleteReply) embed.scheduleDelete(msg, deleteDelay);
  return;
}

    embed.registerPrivateInteraction(msg, message.author.id, TIMEOUT_MS);

    const collector = msg.createMessageComponentCollector({
      filter : i => i.user.id === message.author.id,
      idle   : IDLE_MS,
      time   : TIMEOUT_MS,
    });

    collector.on('collect', async i => {
      try {
        if (i.customId === 'mutelist:close') {
          await i.deferUpdate().catch(() => {});
          embed.clearPrivateInteraction(msg);
          collector.stop('closed');
          await message.delete().catch(() => {});
          return msg.delete().catch(() => {});
        }

        if (i.customId === 'mutelist:prev' && current > 0) current--;
        if (i.customId === 'mutelist:next' && current < pages.length - 1) current++;

        await i.update({
          embeds: [pages[current]],
          components: buildRows(),
        });
      } catch (err) {
        if (err?.code !== 10062 && err?.code !== 40060) {
          console.error(err);
        }
      }
    });

    collector.on('end', (_, reason) => {
      embed.clearPrivateInteraction(msg);
      if (reason === 'closed') return;
      msg.edit({ components: [] }).catch(() => {});
    });
  },
};
