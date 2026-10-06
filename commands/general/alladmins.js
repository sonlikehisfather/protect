'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require('discord.js');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder === 'function' &&
                           typeof TextDisplayBuilder === 'function';

const db    = require('../../core/database');
const embed = require('../../utils/embed');

const PAGE_SIZE  = 15;
const IDLE_MS    = 300_000;
const TIMEOUT_MS = 900_000;

module.exports = {
  help: {
    name        : 'alladmins',
    description : 'Affiche la liste des administrateurs du serveur.',
    usage       : 'alladmins',
    aliases     : ['admins', 'adminlist'],
  },

  async run(client, message) {

    const guild   = message.guild;
    if (!guild) return;

    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteInfoCmds);
    const deleteReply = Boolean(config?.autoDeleteInfoReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    if (guild.members.cache.size < guild.memberCount) {
      await guild.members.fetch().catch(() => null);
    }


    const admins = guild.members.cache
      .filter(member =>
        !member.user.bot &&
        member.permissions.has(PermissionFlagsBits.Administrator)
      )
      .sort((a, b) =>
        a.displayName.localeCompare(b.displayName, 'fr', { sensitivity: 'base' })
      )
      .map(member => formatMemberLine(member));

    if (!admins.length) {
      const text = '## Administrateurs du serveur\n\n> Aucun administrateur n\u2019a été trouvé sur ce serveur.';
      let sent = null;
      if (embed.shouldUseV2(guildId, module.exports.help.name)) {
        try {
          const container = new ContainerBuilder();
          container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
          sent = await message.channel.send({
            components      : [container],
            flags           : COMPONENTS_V2_FLAG,
            allowedMentions : { repliedUser: false },
          }).catch(() => null);
        } catch {}
      }
      if (!sent) {
        sent = await embed.sendEmbed(message.channel, guildId, null, {
            title     : 'Administrateurs du serveur',
            fields    : [{ name: 'Résultat', value: 'Aucun administrateur n’a été trouvé sur ce serveur.', inline: false }],
            timestamp : false,
          });
      }
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const pages = chunkArray(admins, PAGE_SIZE);
    let page = 0;

    const buildPayload = (disabled = false) => {
      const header = `## Administrateurs du serveur\n`;
      const body   = header + pages[page].join('\n');
      const footer = `-# Membres : ${admins.length} \u2022 Page ${page + 1}/${pages.length}`;

      const prevBtn = new ButtonBuilder()
        .setCustomId('alladmins:prev')
        .setLabel('\u2190')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || page === 0);
      const nextBtn = new ButtonBuilder()
        .setCustomId('alladmins:next')
        .setLabel('\u2192')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || page >= pages.length - 1);
      const closeBtn = new ButtonBuilder()
        .setCustomId('alladmins:close')
        .setLabel('\u2716')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled);
      const navRow = new ActionRowBuilder().addComponents(prevBtn, nextBtn, closeBtn);

      if (embed.shouldUseV2(guildId, module.exports.help.name)) {
        try {
          const container = new ContainerBuilder();
          container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
          container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
          container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footer));
          if (pages.length > 1) container.addActionRowComponents(navRow);
          return { embeds: [], components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { repliedUser: false } };
        } catch {}
      }

      return {
        embeds: [embed.build(guildId, null, {
          title  : 'Administrateurs du serveur',
          fields : [
            { name: 'Membres', value: String(admins.length), inline: true },
            { name: 'Permission', value: 'Administrateur', inline: true },
            { name: 'Liste', value: pages[page].join('\n'), inline: false },
          ],
          footer    : `Page ${page + 1}/${pages.length}`,
          timestamp : false,
        })],
        components: pages.length > 1 ? [navRow] : [],
        allowedMentions: { repliedUser: false },
      };
    };

    const sent = await message.channel.send(buildPayload()).catch(() => null);

    if (!sent) return;

    if (deleteReply && pages.length <= 1) {
      embed.scheduleDelete(sent, deleteDelay);
    }

    if (pages.length <= 1) {
      return;
    }

    embed.registerPrivateInteraction(sent, message.author.id, TIMEOUT_MS);

    const collector = sent.createMessageComponentCollector({
      filter : i => i.user.id === message.author.id,
      idle   : IDLE_MS,
      time   : TIMEOUT_MS,
    });

    collector.on('collect', async interaction => {
      try {
        if (interaction.customId === 'alladmins:close') {
          await interaction.deferUpdate().catch(() => {});
          embed.clearPrivateInteraction(sent);
          collector.stop('closed');
          return sent.delete().catch(() => {});
        }

        if (interaction.customId === 'alladmins:prev' && page > 0) {
          page--;
        }

        if (interaction.customId === 'alladmins:next' && page < pages.length - 1) {
          page++;
        }

        await interaction.update(buildPayload());

      } catch (err) {
        if (err?.code !== 10062 && err?.code !== 40060) {
          console.error(err);
        }
      }
    });

    collector.on('end', (_, reason) => {
      embed.clearPrivateInteraction(sent);
      if (reason === 'closed') return;
      sent.edit(buildPayload(true)).catch(() => {});
    });
  },
};

function formatMemberLine(member) {
  const suffix = member.displayName && member.displayName !== member.user.username
    ? ` (@${member.user.username})`
    : '';

  return `\u2022 <@${member.id}>${suffix}`;
}

function chunkArray(array, size) {
  const chunks = [];

  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }

  return chunks;
}
