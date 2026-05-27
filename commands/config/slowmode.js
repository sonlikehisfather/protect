'use strict';


const { parseDuration, formatDuration } = require('../../utils/parseDuration.js');
const {
  ChannelType,
  PermissionsBitField,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');
const config = require('../../config.json');

module.exports = {
  help: {
    name        : 'slowmode',
    description : 'Définit ou retire le mode lent d\'un salon.',
    usage       : 'slowmode <durée|off> [salon]',
    aliases     : ['slow', 'ratelimit'],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;

    if (!perms.check(message, 'slowmode')) return;

    const guildConfig = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(guildConfig?.autoDeleteModCmds);
    const deleteReply = Boolean(guildConfig?.autoDeleteLockReplies ?? guildConfig?.autoDeleteModReplies);
    const deleteDelay = guildConfig?.autoDeleteDelay ?? 5;
    const prefix      = guildConfig?.prefix ?? config.prefix ?? '+';

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

    if (!me || !me.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      const sent = await embed.replyError(
        message,
        'Je n\'ai pas la permission de gérer les salons.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      const sent = await embed.replyError(
        message,
        'Vous devez avoir la permission de gérer les salons.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const parsed  = parseArguments(message, args);
    const channel = parsed.channel;
    const value   = parsed.value;

    if (!channel) {
      const sent = await embed.replyError(
        message,
        `Aucun salon trouvé pour : \`${args.join(' ') || 'inconnu'}\``,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (!isSlowmodeChannel(channel)) {
      const sent = await embed.replyError(
        message,
        'Le mode lent ne peut être modifié que sur un salon textuel.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (!value) {
      const sent = await embed.replyError(
        message,
        `Utilisation : \`${prefix}slowmode <durée|off> [salon]\``,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    let seconds;

    if (['off', '0', 'none', 'disable'].includes(value.toLowerCase())) {
      seconds = 0;
    } else {
      const parsedMs = parseDuration(value);

      if (!parsedMs) {
        const sent = await embed.replyError(
          message,
          'Durée invalide. Exemples : `5s`, `30s`, `1m`, `5m`, ou `off`.',
          { timestamp: false }
        ).catch(() => null);

        if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      seconds = Math.floor(parsedMs / 1000);
    }

    if (seconds < 0 || seconds > 21600) {
      const sent = await embed.replyError(
        message,
        'Le mode lent doit être compris entre `0s` et `6h`.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if ((channel.rateLimitPerUser ?? 0) === seconds) {
      const sent = await embed.replyError(
        message,
        seconds === 0
          ? 'Le mode lent est déjà désactivé dans ce salon.'
          : `Le mode lent est déjà défini sur **${formatSlowmode(seconds)}** dans ce salon.`,
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const edited = await channel.setRateLimitPerUser(
      seconds,
      `Slowmode modifié par ${message.author.username}`
    ).catch(() => null);

    if (!edited) {
      const sent = await embed.replyError(
        message,
        'Impossible de modifier le mode lent de ce salon.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          seconds === 0
            ? `Le mode lent a été désactivé dans <#${channel.id}>.`
            : `Le mode lent de <#${channel.id}> a été défini sur **${formatSlowmode(seconds)}**.`,
          { timestamp: false }
        ),
      ],
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
  },
};

function parseArguments(message, args) {
  if (!args.length) {
    return { channel: message.channel, value: null };
  }

  const mentioned = message.mentions.channels.first();

  if (mentioned) {
    const remaining = args.filter(arg => !arg.includes(mentioned.id));

    return {
      channel : mentioned,
      value   : remaining.join(' ').trim() || null,
    };
  }

  const first = args[0];
  const cleaned = first.replace(/[<#>]/g, '').trim();

  if (/^\d{17,20}$/.test(cleaned)) {
    const channel = message.guild.channels.cache.get(cleaned) ?? null;

    return {
      channel,
      value: args.slice(1).join(' ').trim() || null,
    };
  }

  const last = args[args.length - 1];
  const lastCleaned = last.replace(/[<#>]/g, '').trim();

  if (/^\d{17,20}$/.test(lastCleaned)) {
    const channel = message.guild.channels.cache.get(lastCleaned) ?? null;

    return {
      channel,
      value: args.slice(0, -1).join(' ').trim() || null,
    };
  }

  const fullRaw = args.join(' ').trim();
  const lowered = fullRaw.toLowerCase();

  const exactChannel = message.guild.channels.cache.find(c =>
    c.name?.toLowerCase() === lowered
  );

  if (exactChannel) {
    return {
      channel: exactChannel,
      value  : null,
    };
  }

  if (args.length >= 2) {
    const possibleDuration = args[0];
    const channelQuery = args.slice(1).join(' ').trim().toLowerCase();

    const exactAfterDuration = message.guild.channels.cache.find(c =>
      c.name?.toLowerCase() === channelQuery
    );

    if (exactAfterDuration) {
      return {
        channel: exactAfterDuration,
        value  : possibleDuration,
      };
    }

    const partialAfterDuration = message.guild.channels.cache.find(c =>
      c.name?.toLowerCase().includes(channelQuery)
    );

    if (partialAfterDuration) {
      return {
        channel: partialAfterDuration,
        value  : possibleDuration,
      };
    }

    const possibleValue = args.slice(-1).join(' ').trim();
    const channelBeforeValue = args.slice(0, -1).join(' ').trim().toLowerCase();

    const exactBeforeValue = message.guild.channels.cache.find(c =>
      c.name?.toLowerCase() === channelBeforeValue
    );

    if (exactBeforeValue) {
      return {
        channel: exactBeforeValue,
        value  : possibleValue,
      };
    }

    const partialBeforeValue = message.guild.channels.cache.find(c =>
      c.name?.toLowerCase().includes(channelBeforeValue)
    );

    if (partialBeforeValue) {
      return {
        channel: partialBeforeValue,
        value  : possibleValue,
      };
    }
  }

  return {
    channel: message.channel,
    value  : fullRaw,
  };
}

function isSlowmodeChannel(channel) {
  return channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildAnnouncement;
}

function formatSlowmode(seconds) {
  if (!seconds) return '0s';
  return formatDuration(seconds, { unit: 's', format: 'fr-long' }) || `${seconds}s`;
}
