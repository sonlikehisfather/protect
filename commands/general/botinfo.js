'use strict';


const os = require('os');
const db    = require('../../core/database');
const embed = require('../../utils/embed');

module.exports = {
  help: {
    name        : 'botinfo',
    description : 'Affiche les informations du bot.',
    usage       : 'botinfo',
    aliases     : ['bi', 'aboutbot', 'infobot'],
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

    if (guild.members.cache.size === 0) {
      await guild.members.fetch().catch(() => null);
    }

    const botUser = client.user;

    const createdAt = botUser.createdTimestamp
      ? Math.floor(botUser.createdTimestamp / 1000)
      : null;

    const uptimeSeconds = Math.floor((client.uptime ?? 0) / 1000);
    const ping = Math.round(client.ws.ping || 0);

    const humanCount = guild.members.cache.filter(m => !m.user.bot).size;
    const botCount   = guild.members.cache.filter(m => m.user.bot).size;
    const totalCount = guild.memberCount ?? (humanCount + botCount);

    const fields = [
      {
        name  : 'Bot',
        value : `<@${botUser.id}>`,
        inline: true,
      },
      {
        name  : 'ID',
        value : botUser.id,
        inline: true,
      },
      {
        name  : 'Ping',
        value : `${ping} ms`,
        inline: true,
      },
      {
        name  : 'Serveur',
        value : guild.name,
        inline: true,
      },
      {
        name  : 'Membres',
        value : `Total : **${formatNumber(totalCount)}**\nHumains : **${formatNumber(humanCount)}**\nBots : **${formatNumber(botCount)}**`,
        inline: true,
      },
      {
        name  : 'Uptime',
        value : formatDuration(uptimeSeconds),
        inline: true,
      },
      {
        name  : 'Node.js',
        value : process.version,
        inline: true,
      },
      {
        name  : 'Discord.js',
        value : getDiscordJsVersion(),
        inline: true,
      },
      {
        name  : 'Plateforme',
        value : `${os.platform()} ${os.arch()}`,
        inline: true,
      },
      {
        name  : 'Mémoire',
        value : `${formatMemory(process.memoryUsage().rss)} RSS`,
        inline: true,
      },
      {
        name  : 'Créé le',
        value : createdAt
          ? `<t:${createdAt}:F>\n<t:${createdAt}:R>`
          : 'Inconnu',
        inline: true,
      },
    ];

    const sent = await message.channel.send({
      embeds: [
        embed.build(
          guildId,
          null,
          {
            title      : 'Informations du bot',
            authorName : botUser.username,
            authorIcon : botUser.displayAvatarURL({ dynamic: true, size: 256 }),
            thumbnail  : botUser.displayAvatarURL({ dynamic: true, size: 512 }),
            fields,
            timestamp  : false,
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

function formatDuration(totalSeconds) {
  if (!totalSeconds || totalSeconds <= 0) {
    return '0s';
  }

  const days    = Math.floor(totalSeconds / 86400);
  const hours   = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];

  if (days) parts.push(`${days}j`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds || !parts.length) parts.push(`${seconds}s`);

  return parts.join(' ');
}

function formatMemory(bytes) {
  if (!bytes || bytes <= 0) {
    return '0 MB';
  }

  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(1)} MB`;
}

function formatNumber(value) {
  return new Intl.NumberFormat('fr-FR').format(value ?? 0);
}

function getDiscordJsVersion() {
  try {
    return require('discord.js').version ?? 'Inconnue';
  } catch {
    return 'Inconnue';
  }
}
