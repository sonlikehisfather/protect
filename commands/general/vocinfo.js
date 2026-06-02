'use strict';


const {
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const { resolveMember } = require('../../utils/memberResolver');

const PAGE_SIZE  = 10;
const IDLE_MS    = 300_000;
const TIMEOUT_MS = 900_000;

module.exports = {
  help: {
    name        : 'vocinfo',
    description : "Affiche les salons vocaux actifs et les stats vocales d'un membre.",
    usage       : 'vocinfo [user <mention/id/nom>]',
    aliases     : ['voiceinfo', 'vocalinfo'],
  },

  async run(client, message, args) {

    const guild = message.guild;
    if (!guild) return;

    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteInfoCmds);
    const deleteReply = Boolean(config?.autoDeleteInfoReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const sub = args?.[0]?.toLowerCase();
    if (sub === 'user') {
      return _handleUser(message, args.slice(1), guildId, deleteReply, deleteDelay);
    }

    const voiceChannels = guild.channels.cache.filter(
      c =>
        c.type === ChannelType.GuildVoice ||
        c.type === ChannelType.GuildStageVoice
    );

    await guild.members.fetch().catch(() => null);

    const activeChannels = voiceChannels.filter(
      vc => vc.members.size > 0
    );

    const emptyChannels = voiceChannels.filter(
      vc => vc.members.size === 0
    );

    const totalVoice     = voiceChannels.size;
    const totalActive    = activeChannels.size;
    const totalEmpty     = emptyChannels.size;

    const totalMembers = activeChannels.reduce(
      (acc, vc) => acc + vc.members.size,
      0
    );

    const lines = activeChannels
      .sort((a, b) => b.members.size - a.members.size)
      .map(vc =>
        `• <#${vc.id}> - ${vc.members.size} membre${vc.members.size > 1 ? 's' : ''}`
      );

    if (!lines.length) {

      const sent = await message.channel.send({
        embeds: [
          embed.build(
            guildId,
            null,
            {
              title  : 'Informations vocales',
              fields : [
                {
                  name  : 'Salons vocaux',
                  value : String(totalVoice),
                  inline: true,
                },
                {
                  name  : 'Membres connectés',
                  value : '0',
                  inline: true,
                },
                {
                  name  : 'Salons actifs',
                  value : '0',
                  inline: true,
                },
                {
                  name  : 'Salons vides',
                  value : String(totalEmpty),
                  inline: true,
                },
                {
                  name  : 'Liste',
                  value : 'Aucun salon vocal actif.',
                  inline: false,
                },
              ],
              timestamp : false,
            }
          )
        ],
        allowedMentions: { parse: [] },
      }).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    const pages = chunkArray(lines, PAGE_SIZE);
    let page = 0;

    const buildEmbed = () => embed.build(
      guildId,
      null,
      {
        title  : 'Informations vocales',
        fields : [
          {
            name  : 'Salons vocaux',
            value : String(totalVoice),
            inline: true,
          },
          {
            name  : 'Membres connectés',
            value : String(totalMembers),
            inline: true,
          },
          {
            name  : 'Salons actifs',
            value : String(totalActive),
            inline: true,
          },
          {
            name  : 'Salons vides',
            value : String(totalEmpty),
            inline: true,
          },
          {
            name  : 'Liste',
            value : pages[page].join('\n'),
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
          .setCustomId('vocinfo:prev')
          .setLabel('\u25C0')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || page === 0),

        new ButtonBuilder()
          .setCustomId('vocinfo:next')
          .setLabel('\u25B6')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || page >= pages.length - 1),

        new ButtonBuilder()
          .setCustomId('vocinfo:close')
          .setLabel('\u2716')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(disabled),
      ),
    ];

    const sent = await message.channel.send({
      embeds          : [buildEmbed()],
      components      : pages.length > 1 ? buildRows() : [],
      allowedMentions : { parse: [] },
    }).catch(() => null);

    if (!sent) return;

    if (deleteReply && pages.length <= 1) {
      embed.scheduleDelete(sent, deleteDelay);
    }

    if (pages.length <= 1) return;

    embed.registerPrivateInteraction(sent, message.author.id, TIMEOUT_MS);

    const collector = sent.createMessageComponentCollector({
      filter : i => i.user.id === message.author.id,
      idle   : IDLE_MS,
      time   : TIMEOUT_MS,
    });

    collector.on('collect', async interaction => {
      try {
        if (interaction.customId === 'vocinfo:close') {
          await interaction.deferUpdate().catch(() => {});
          embed.clearPrivateInteraction(sent);
          collector.stop('closed');
          await message.delete().catch(() => {});
          return sent.delete().catch(() => {});
        }

        if (interaction.customId === 'vocinfo:prev' && page > 0) {
          page--;
        }

        if (interaction.customId === 'vocinfo:next' && page < pages.length - 1) {
          page++;
        }

        await interaction.update({
          embeds     : [buildEmbed()],
          components : buildRows(),
        });
      } catch (err) {
        if (err?.code !== 10062 && err?.code !== 40060) {}
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

function chunkArray(array, size) {

  const chunks = [];

  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }

  return chunks;

}


async function _handleUser(message, args, guildId, deleteReply, deleteDelay) {
  const member = await resolveMember(message, args);

  if (!member) {
    const sent = await embed.replyError(
      message,
      'Utilisateur introuvable.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const stats   = db.getVoiceStats(guildId, member.id);
  const voiceCh = member.voice?.channel ?? null;
  const now     = Math.floor(Date.now() / 1000);

  let totalSeconds = stats?.totalSeconds ?? 0;
  let sessionStr   = '-';
  let sinceStr     = '-';
  let vocalStr     = 'Non';

  if (voiceCh) {
    vocalStr = `Oui - <#${voiceCh.id}>`;
    if (stats?.joinedAt) {
      const sessionSec = Math.max(0, now - stats.joinedAt);
      totalSeconds += sessionSec;
      sessionStr = _formatDuration(sessionSec);
      sinceStr   = `<t:${stats.joinedAt}:R>`;
    }
  } else if (stats?.joinedAt) {

    vocalStr = 'Non (session stale en DB)';
  }


  let channelVal = `> ${_code('-')}`;
  if (voiceCh) {
    channelVal = `> <#${voiceCh.id}>`;
  } else if (stats?.channelId) {
    channelVal = `> ${_code('Inconnu')}`;
  }


  const sinceVal = sinceStr.startsWith('<t:') ? `> ${sinceStr}` : `> ${_code(sinceStr)}`;

  let fiabilityStr = `> ${_code('OK')}`;
  if (stats?.lastStaleClearAt) {
    fiabilityStr = `> ⚠️ Session interrompue lors d'un redémarrage · <t:${stats.lastStaleClearAt}:R>`;
  }

  const fields = [
    { name: 'En vocal',          value: `> ${_code(voiceCh ? 'Oui' : 'Non')}`, inline: true },
    { name: 'Salon actuel',      value: channelVal,                              inline: true },
    { name: 'Depuis',            value: sinceVal,                                inline: true },
    { name: 'Session actuelle',  value: `> ${_code(sessionStr)}`,               inline: true },
    { name: 'Temps vocal total', value: `> ${_code(_formatDuration(totalSeconds))}`, inline: true },
    { name: 'Fiabilité',          value: fiabilityStr,                           inline: false },
  ];

  const sent = await message.channel.send({
    embeds: [
      embed.build(
        guildId,
        null,
        {
          title     : `Vocal - ${member.user.globalName ?? member.user.username}`,
          thumbnail : member.user.displayAvatarURL({ size: 128 }),
          fields,
          timestamp : false,
        }
      ),
    ],
    allowedMentions: { parse: [] },
  }).catch(() => null);

  if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
}

function _code(value) {
  return `\`${String(value ?? '-').replace(/`/g, "'")}\``;
}

function _formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0s';

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}min`);
  if (s > 0 || !parts.length) parts.push(`${s}s`);

  return parts.join(' ');
}
