'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

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
      const sent = await message.channel.send({
        embeds: [
          embed.build(
            guildId,
            null,
            {
              title     : 'Membres du rôle',
              authorName: role.name,
              fields    : [
                {
                  name  : 'Résultat',
                  value : 'Aucun membre ne possède ce rôle.',
                  inline: false,
                },
                {
                  name  : 'Rôle',
                  value : `<@&${role.id}>`,
                  inline: true,
                },
                {
                  name  : 'ID',
                  value : role.id,
                  inline: true,
                },
              ],
              timestamp : false,
            }
          )
        ],
        allowedMentions: {
          repliedUser: false,
        },
      }).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    const pages = chunkArray(members, PAGE_SIZE);
    let page = 0;

    const buildEmbed = () => embed.build(
      guildId,
      null,
      {
        title      : 'Membres du rôle',
        authorName : role.name,
        fields     : [
          {
            name  : 'Rôle',
            value : `<@&${role.id}>`,
            inline: true,
          },
          {
            name  : 'ID',
            value : role.id,
            inline: true,
          },
          {
            name  : 'Membres',
            value : String(members.length),
            inline: true,
          },
          {
            name  : 'Liste',
            value : pages[page].join('\n').slice(0, 1024),
            inline: false,
          },
        ],
        footer    : `Page ${page + 1}/${pages.length}`,
        timestamp : false,
      }
    );

    const buildRows = (disabled = false) => [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('rolemembers:prev')
          .setLabel('\u25C0')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || page === 0),
        new ButtonBuilder()
          .setCustomId('rolemembers:next')
          .setLabel('\u25B6')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || page >= pages.length - 1),
        new ButtonBuilder()
          .setCustomId('rolemembers:close')
          .setLabel('\u2716')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(disabled),
      ),
    ];

    const sent = await message.channel.send({
      embeds: [buildEmbed()],
      components: pages.length > 1 ? buildRows() : [],
      allowedMentions: {
        repliedUser: false,
      },
    }).catch(() => null);

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

        await i.update({
          embeds     : [buildEmbed()],
          components : buildRows(),
        });

      } catch (err) {
        if (err?.code !== 10062 && err?.code !== 40060) {
          console.error(err);
        }
      }
    });

    collector.on('end', (_, reason) => {
      embed.clearPrivateInteraction(sent);
      if (reason === 'closed') return;
      sent.edit({
        components: [],
      }).catch(() => {});
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
