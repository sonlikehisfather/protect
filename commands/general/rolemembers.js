'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
    name        : 'rolemembers',
    description : 'Affiche la liste des membres possédant un rôle.',
    usage       : 'rolemembers <rôle>',
    aliases     : ['rmembers', 'roleusers'],
  },

  async run(client, message, args) {

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

    try {
      await guild.members.fetch();
    } catch {}

    const role = resolveRole(message, args);

    if (!role) {
      const sent = await embed.replyError(
        message,
        `Aucun rôle trouvé pour : \`${args.join(' ') || 'inconnu'}\``,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    const members = role.members
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr', { sensitivity: 'base' }))
      .map(member => formatMemberLine(member));

    if (!members.length) {
      const text = '## Membres du r\u00f4le\n\n> ' + role.name + '\n\nAucun membre ne poss\u00e8de ce r\u00f4le.\n<@&' + role.id + '> \u2022 ' + role.id;
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
            title     : 'Membres du r\u00f4le',
            authorName: role.name,
            fields    : [
              { name: 'R\u00e9sultat', value: 'Aucun membre ne poss\u00e8de ce r\u00f4le.', inline: false },
              { name: 'R\u00f4le', value: `<@&${role.id}>`, inline: true },
              { name: 'ID', value: role.id, inline: true },
            ],
            timestamp : false,
          });
      }
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const pages = chunkArray(members, PAGE_SIZE);
    let page = 0;

const buildPayload = (disabled = false) => {
      const header = '## Membres du r\u00f4le\n> ' + role.name + '';
      const body   = header + '\n' + pages[page].join('\n').slice(0, 3500);
      const footer = '-# R\u00f4le : <@&' + role.id + '> \u2022 ' + members.length + ' membre(s) \u2022 Page ' + (page + 1) + '/' + pages.length;

      const prevBtn = new ButtonBuilder()
        .setCustomId('rolemembers:prev')
        .setLabel('\u2190')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || page === 0);
      const nextBtn = new ButtonBuilder()
        .setCustomId('rolemembers:next')
        .setLabel('\u2192')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || page >= pages.length - 1);
      const closeBtn = new ButtonBuilder()
        .setCustomId('rolemembers:close')
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
          title      : 'Membres du r\u00f4le',
          authorName : role.name,
          fields     : [
            { name: 'R\u00f4le', value: `<@&${role.id}>`, inline: true },
            { name: 'ID', value: role.id, inline: true },
            { name: 'Membres', value: String(members.length), inline: true },
            { name: 'Liste', value: pages[page].join('\n').slice(0, 1024), inline: false },
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

if (pages.length <= 1) {
  if (deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
  return;
}

embed.registerPrivateInteraction(sent, message.author.id, TIMEOUT_MS);

const collector = sent.createMessageComponentCollector({
      filter : i => i.user.id === message.author.id,
      idle   : IDLE_MS,
      time   : TIMEOUT_MS,
    });

    collector.on('collect', async i => {
      try {
        if (i.customId === 'rolemembers:close') {
          await i.deferUpdate().catch(() => {});
          embed.clearPrivateInteraction(sent);
          collector.stop('closed');
          await message.delete().catch(() => {});
          return sent.delete().catch(() => {});
        }

        if (i.customId === 'rolemembers:prev' && page > 0) page--;
        if (i.customId === 'rolemembers:next' && page < pages.length - 1) page++;

        await i.update(buildPayload());

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

function resolveRole(message, args) {

  const mentionedRole = message.mentions.roles.first();
  if (mentionedRole) return mentionedRole;

  const raw = args.join(' ').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[<@&>]/g, '').trim();

  if (/^\d{17,20}$/.test(cleaned)) {
    return message.guild.roles.cache.get(cleaned) ?? null;
  }

  const lowered = raw.toLowerCase();

  const exactRole = message.guild.roles.cache.find(r =>
    r.name.toLowerCase() === lowered
  );
  if (exactRole) return exactRole;

  const partialRole = message.guild.roles.cache.find(r =>
    r.name.toLowerCase().includes(lowered)
  );
  if (partialRole) return partialRole;

  return null;
}

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
