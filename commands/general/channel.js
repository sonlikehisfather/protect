'use strict';


const { ChannelType, PermissionFlagsBits } = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');

const CHANNEL_TYPE_LABELS = {
  [ChannelType.GuildText]         : 'Textuel',
  [ChannelType.DM]                : 'Message privé',
  [ChannelType.GuildVoice]        : 'Vocal',
  [ChannelType.GroupDM]           : 'Groupe privé',
  [ChannelType.GuildCategory]     : 'Catégorie',
  [ChannelType.GuildAnnouncement] : 'Annonces',
  [ChannelType.AnnouncementThread]: 'Thread annonce',
  [ChannelType.PublicThread]      : 'Thread public',
  [ChannelType.PrivateThread]     : 'Thread privé',
  [ChannelType.GuildStageVoice]   : 'Stage',
  [ChannelType.GuildForum]        : 'Forum',
  [ChannelType.GuildMedia]        : 'Média',
};

module.exports = {
  help: {
    name        : 'channel',
    description : 'Affiche les informations relatives à un salon.',
    usage       : 'channel [salon]',
    aliases     : ['channelinfo', 'ci'],
  },

  async run(client, message, args) {

    const guild   = message.guild;
    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteInfoCmds);
    const deleteReply = Boolean(config?.autoDeleteInfoReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const channel = resolveChannel(message, args);

    if (!channel) {
      const sent = await embed.replyError(
        message,
        `Aucun salon trouvé pour : \`${args.join(' ') || 'inconnu'}\``,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    const createdAt = channel.createdTimestamp
      ? Math.floor(channel.createdTimestamp / 1000)
      : null;

    const typeLabel =
      CHANNEL_TYPE_LABELS[channel.type] ?? `Type ${channel.type}`;

    const category =
      channel.parentId
        ? `<#${channel.parentId}>`
        : 'Aucune';

    const isNsfw =
      'nsfw' in channel
        ? (channel.nsfw ? 'Oui' : 'Non')
        : 'Non';

    const slowmode =
      'rateLimitPerUser' in channel && typeof channel.rateLimitPerUser === 'number'
        ? formatSlowmode(channel.rateLimitPerUser)
        : 'Aucun';

    const topic =
      'topic' in channel && channel.topic
        ? channel.topic.slice(0, 1024)
        : null;

    const bitrate =
      'bitrate' in channel && typeof channel.bitrate === 'number'
        ? `${Math.floor(channel.bitrate / 1000)} kbps`
        : null;

    const userLimit =
      'userLimit' in channel && typeof channel.userLimit === 'number'
        ? (channel.userLimit > 0 ? String(channel.userLimit) : 'Aucune')
        : null;


    const everyoneRole = guild.roles.everyone;
    const visibility =
      channel.permissionsFor(everyoneRole)?.has(PermissionFlagsBits.ViewChannel)
        ? 'Public'
        : 'Restreint';

       let accessCount = 0;

try {

  const members =
    await guild.members.fetch();

  accessCount =
    members.filter(member =>
      channel
        .permissionsFor(member)
        ?.has(PermissionFlagsBits.ViewChannel)
    ).size;

}
catch {

  accessCount = guild.memberCount;

}

    const fields = [
      {
        name  : 'Salon',
        value : `<#${channel.id}>`,
        inline: true,
      },
      {
        name  : 'ID',
        value : channel.id,
        inline: true,
      },
      {
        name  : 'Type',
        value : typeLabel,
        inline: true,
      },
      {
        name  : 'Catégorie',
        value : category,
        inline: true,
      },
      {
        name  : 'Position',
        value : String(channel.position ?? 0),
        inline: true,
      },
      {
        name  : 'NSFW',
        value : isNsfw,
        inline: true,
      },
      {
        name  : 'Visibilité',
        value : visibility,
        inline: true,
      },
       {
        name  : 'Accès',
        value : `**${accessCount}** membres`,
        inline: true,
      },
      {
        name  : 'Mode lent',
        value : slowmode,
        inline: true,
      },
    ];

    if (bitrate !== null) {
      fields.push({
        name  : 'Bitrate',
        value : bitrate,
        inline: true,
      });
    }

    if (userLimit !== null) {
      fields.push({
        name  : 'Limite utilisateurs',
        value : userLimit,
        inline: true,
      });
    }

    if (createdAt) {
      fields.push({
        name  : 'Créé le',
        value : `<t:${createdAt}:F>\n<t:${createdAt}:R>`,
        inline: true,
      });
    }

    if (topic) {
      fields.push({
        name  : 'Sujet',
        value : topic,
        inline: false,
      });
    }

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          null,
          {
            title      : 'Informations salon',
            authorName : channel.name
              ? `#${channel.name}`
              : 'Salon',
            fields,
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

  },
};

function resolveChannel(message, args) {

  const mentionedChannel =
    message.mentions.channels.first();

  if (mentionedChannel) return mentionedChannel;

  const raw =
    args.join(' ').trim();

  if (!raw) return message.channel;

  const cleaned =
    raw.replace(/[<#>]/g, '').trim();

  if (/^\d{17,20}$/.test(cleaned)) {
    return message.guild.channels.cache.get(cleaned) ?? null;
  }

  const lowered =
    raw.toLowerCase();

  const exactChannel =
    message.guild.channels.cache.find(c =>
      c.name?.toLowerCase() === lowered
    );

  if (exactChannel) return exactChannel;

  const partialChannel =
    message.guild.channels.cache.find(c =>
      c.name?.toLowerCase().includes(lowered)
    );

  if (partialChannel) return partialChannel;

  return null;

}

function formatSlowmode(seconds) {

  if (!seconds) return 'Aucun';
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remain  = seconds % 60;

  if (minutes < 60) {
    return remain ? `${minutes}m ${remain}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const mins  = minutes % 60;

  return mins ? `${hours}h ${mins}m` : `${hours}h`;

}
