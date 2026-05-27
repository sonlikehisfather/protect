'use strict';


const { ChannelType } = require('discord.js');
const db    = require('../../core/database');
const embed = require('../../utils/embed');
const { parseDuration, formatDuration } = require('../../utils/parseDuration.js');

module.exports = {
  help: {
    name        : 'renew',
    description : 'Recrée un salon textuel ou vocal.',
    usage       : 'renew [salon] | renew embeddelay <nombre><s|m|h|d> on|off | renew embeddelay reset',
    aliases     : ['recreatechannel'],

    subcommands : [
      {
        name        : 'renew embeddelay',
        description : 'Configure la suppression automatique de l\'embed de confirmation après un renew.',
        usage       : 'renew embeddelay <nombre><s|m|h|d> on|off | renew embeddelay reset',
        category    : 'moderation',
      }
    ],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteLockReplies ?? config?.autoDeleteModReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    if (args[0]?.toLowerCase() === 'embeddelay') {
      return handleEmbedDelay(
        message,
        args.slice(1),
        guildId,
        config,
        deleteReply,
        deleteDelay
      );
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

    if (!isRenewable(channel)) {
      const sent = await embed.replyError(
        message,
        'Ce type de salon ne peut pas être recréé avec cette commande.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const oldPosition = channel.position;
    const oldParentId = channel.parentId ?? null;
    const oldName     = channel.name;
    const oldType     = channel.type;

    const baseData = {
      name : oldName,
      type : oldType,

      topic            : 'topic' in channel ? (channel.topic ?? null) : undefined,
      nsfw             : 'nsfw' in channel ? Boolean(channel.nsfw) : undefined,
      bitrate          : 'bitrate' in channel ? channel.bitrate : undefined,
      userLimit        : 'userLimit' in channel ? channel.userLimit : undefined,
      rateLimitPerUser : 'rateLimitPerUser' in channel ? channel.rateLimitPerUser : undefined,
      rtcRegion        : 'rtcRegion' in channel ? channel.rtcRegion : undefined,
      videoQualityMode : 'videoQualityMode' in channel ? channel.videoQualityMode : undefined,
      defaultAutoArchiveDuration :
        'defaultAutoArchiveDuration' in channel
          ? channel.defaultAutoArchiveDuration
          : undefined,

      permissionOverwrites: channel.permissionOverwrites.cache.map(overwrite => ({
        id    : overwrite.id,
        allow : overwrite.allow.bitfield,
        deny  : overwrite.deny.bitfield,
        type  : overwrite.type,
      })),

      parent : oldParentId,
      reason : `Salon recréé par ${message.author.username}`,
    };

    const created = await guild.channels.create(baseData).catch(() => null);

    if (!created) {
      const sent = await embed.replyError(
        message,
        'Impossible de recréer ce salon.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    await created.setPosition(oldPosition).catch(() => {});

    const deleted = await channel
      .delete(`Salon recréé par ${message.author.username}`)
      .catch(() => null);

    if (!deleted) {
      const sent = await created.send({
        embeds: [
          embed.build(
            guildId,
            "Le nouveau salon a été créé, mais l'ancien salon n'a pas pu être supprimé.",
            { timestamp: false }
          )
        ],
        allowedMentions: { repliedUser: false },
      }).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    const renewDeleteEnabled = Boolean(config?.autoDeleteRenewReply);
    const renewDeleteDelay   = config?.autoDeleteRenewDelay ?? deleteDelay;

    const sent = await created.send({
      embeds: [
        embed.build(
          guildId,
          `Le salon a été recréé par <@${message.author.id}>.`,
          { timestamp: false }
        )
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && renewDeleteEnabled) {
      embed.scheduleDelete(sent, renewDeleteDelay);
    }
  },
};

async function handleEmbedDelay(message, args, guildId, config, deleteReply, deleteDelay) {
  const first = args[0]?.toLowerCase();

  if (first === 'reset') {
    db.setGuildConfig(guildId, 'autoDeleteRenewReply', 0);
    db.setGuildConfig(guildId, 'autoDeleteRenewDelay', null);

    const globalDelay   = config?.autoDeleteDelay ?? 5;
    const globalEnabled = Boolean(config?.autoDeleteLockReplies ?? config?.autoDeleteModReplies);

    const sent = await embed.reply(
      message,
      `Suppression de l'embed remise aux valeurs par défaut.\nDélai global : \`${globalDelay}s\` - état : **${globalEnabled ? 'activé' : 'désactivé'}**.`,
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }

    return;
  }

  if (args.length < 2) {
    const sent = await embed.replyError(
      message,
      'Utilisation : `renew embeddelay <nombre><s|m|h|d> on|off | renew embeddelay reset`',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }

    return;
  }

  const rawDuration = first;
  const toggle      = args[1].toLowerCase();

  if (!['on', 'off'].includes(toggle)) {
    const sent = await embed.replyError(
      message,
      'Le second argument doit être `on`, `off` ou `reset`.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }

    return;
  }

  const seconds = parseDuration(rawDuration, {
    allowedUnits : ['s', 'm', 'h', 'd'],
    unit         : 's',
    minMs        : 1000,
    maxMs        : 7 * 24 * 3600 * 1000,
  });

  if (seconds === null) {
    const sent = await embed.replyError(
      message,
      'Durée invalide. Exemples : `30s`, `2m`, `1h`, `1d` (entre `1s` et `7d`).',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }

    return;
  }

  const enabled = toggle === 'on';

  db.setGuildConfig(guildId, 'autoDeleteRenewReply', enabled ? 1 : 0);
  db.setGuildConfig(guildId, 'autoDeleteRenewDelay', seconds);

  const durationLabel = formatDuration(seconds, { unit: 's', format: 'fr-long' });

  const sent = await embed.reply(
    message,
    enabled
      ? `Suppression automatique de l'embed activée - délai : \`${durationLabel}\`.`
      : `Suppression automatique de l'embed désactivée - délai enregistré : \`${durationLabel}\`.`,
    { timestamp: false }
  ).catch(() => null);

  if (sent && deleteReply) {
    embed.scheduleDelete(sent, deleteDelay);
  }
}

function resolveChannel(message, args) {
  const mentioned = message.mentions.channels.first();
  if (mentioned) return mentioned;

  const raw = args.join(' ').trim();
  if (!raw) return message.channel;

  const cleaned = raw.replace(/[<#>]/g, '').trim();
  if (/^\d{17,20}$/.test(cleaned)) {
    return message.guild.channels.cache.get(cleaned) ?? null;
  }

  const lowered = raw.toLowerCase();

  const exact = message.guild.channels.cache.find(c =>
    c.name?.toLowerCase() === lowered
  );
  if (exact) return exact;

  const partial = message.guild.channels.cache.find(c =>
    c.name?.toLowerCase().includes(lowered)
  );
  if (partial) return partial;

  return null;
}

function isRenewable(channel) {
  return [
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildVoice,
    ChannelType.GuildStageVoice,
  ].includes(channel.type);
}
