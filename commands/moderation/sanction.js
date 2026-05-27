'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');

const PAGE_SIZE  = 10;
const IDLE_MS    = 300_000;
const TIMEOUT_MS = 900_000;

module.exports = {
  help: {
    name        : 'sanction',
    description : 'Affiche l’historique des sanctions d’un utilisateur.',
    usage       : 'sanctions <membre>',
    aliases     : ['infractions', 'sanction', 'history'],
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    const target = await resolveUser(client, message, args);

    if (!target) {
      const sent = await embed.replyError(
        message,
        'Utilisateur introuvable.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    const sanctions = db.getSanctions(guildId, target.id);

    if (!sanctions.length) {
      const sent = await message.channel.send({
        embeds: [
          embed.build(
            guildId,
            `**${target.tag}** n'a aucune sanction.`,
            { timestamp: false }
          )
        ],
        allowedMentions: { repliedUser: false },
      }).catch(() => null);

      if (deleteCmd) {
        await message.delete().catch(() => {});
      }

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const displayLines = buildGroupedSanctionLines(sanctions);
    const pages = chunkArray(displayLines, PAGE_SIZE);

    let current = 0;

    const buildEmbed = () => {
      const lines = pages[current] ?? [];

      return embed.build(guildId, null, {
        title     : `Sanctions de ${target.tag}`,
        thumbnail : target.displayAvatarURL({ dynamic: true, size: 512 }),
        fields    : [
          {
            name   : `${sanctions.length} sanction(s)`,
            value  : lines.join('\n').slice(0, 1024) || 'Aucune sanction.',
            inline : false,
          },
        ],
        footer    : `Page ${current + 1}/${pages.length}`,
        timestamp : false,
      });
    };

    const buildRows = (disabled = false) => [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('local:sanctions:prev')
          .setLabel('\u25C0')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || current === 0),

        new ButtonBuilder()
          .setCustomId('local:sanctions:next')
          .setLabel('\u25B6')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || current >= pages.length - 1),

        new ButtonBuilder()
          .setCustomId('local:sanctions:close')
          .setLabel('\u2716')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(disabled),
      ),
    ];

    const msg = await message.channel.send({
      embeds          : [buildEmbed()],
      components      : pages.length > 1 ? buildRows() : [],
      allowedMentions : { repliedUser: false },
    }).catch(() => null);

    if (!msg) return;

    if (deleteReply && pages.length <= 1) {
      embed.scheduleDelete(msg, deleteDelay);
    }

    if (pages.length <= 1) {
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
        if (i.customId === 'local:sanctions:close') {
          await i.deferUpdate().catch(() => {});
          embed.clearPrivateInteraction(msg);
          collector.stop('closed');
          return msg.delete().catch(() => {});
        }

        if (i.customId === 'local:sanctions:prev' && current > 0) {
          current--;
        }

        if (i.customId === 'local:sanctions:next' && current < pages.length - 1) {
          current++;
        }

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
      embed.clearPrivateInteraction(msg);
      if (reason === 'closed') return;
      msg.edit({
        components: [],
      }).catch(() => {});
    });
  },
};

async function resolveUser(client, message, args) {
  const mention = message.mentions.users.first();
  if (mention) return mention;

  const raw = args[0]?.trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[<@!>]/g, '').trim();

  if (/^\d{17,20}$/.test(cleaned)) {
    return client.users.fetch(cleaned).catch(() => null);
  }

  const lowered = raw.toLowerCase();

  let member = message.guild.members.cache.find(m =>
    m.user.username.toLowerCase() === lowered ||
    (m.user.globalName && m.user.globalName.toLowerCase() === lowered) ||
    m.displayName.toLowerCase() === lowered
  );

  if (member) return member.user;

  const fetchedMembers = await message.guild.members.fetch().catch(() => null);
  if (!fetchedMembers) return null;

  member = fetchedMembers.find(m =>
    m.user.username.toLowerCase() === lowered ||
    (m.user.globalName && m.user.globalName.toLowerCase() === lowered) ||
    m.displayName.toLowerCase() === lowered
  );

  return member?.user ?? null;
}

function buildGroupedSanctionLines(sanctions) {
  const groups = {
    automod   : [],
    moderation: [],
    thresholds: [],
  };

  sanctions.forEach(sanction => {
    const category = getSanctionCategory(sanction);
    groups[category].push(sanction);
  });

  const lines = [];

  if (groups.automod.length) {
    lines.push(`**${getGroupTitle('automod', groups.automod)}**`);

    groups.automod.forEach((sanction, index) => {
      lines.push(formatSanctionLine(sanction, index + 1));
    });
  }

  if (groups.moderation.length) {
    if (lines.length) lines.push('');
    lines.push('**Modération**');

    groups.moderation.forEach((sanction, index) => {
      lines.push(formatSanctionLine(sanction, index + 1));
    });
  }

  if (groups.thresholds.length) {
    if (lines.length) lines.push('');
    lines.push('**Seuils automatiques**');

    groups.thresholds.forEach((sanction, index) => {
      lines.push(formatSanctionLine(sanction, index + 1));
    });
  }

  return lines;
}

function getSanctionCategory(sanction) {
  const reason = sanction.reason ?? '';

  if (reason.startsWith('Automod -')) {
    return 'automod';
  }

  if (reason.startsWith('Seuil de warns atteint')) {
    return 'thresholds';
  }

  return 'moderation';
}

function getGroupTitle(groupName, group) {
  if (groupName === 'automod') {
    const first = group[0];

    if (first?.reason?.startsWith('Automod -')) {
      const source = first.reason
        .replace('Automod -', '')
        .trim();

      return `Automod - ${source}`;
    }

    return 'Automod';
  }

  if (groupName === 'moderation') {
    return 'Modération';
  }

  if (groupName === 'thresholds') {
    return 'Seuils automatiques';
  }

  return groupName;
}

function formatSanctionLine(sanction, index) {
  const typeLabels = {
    warn   : 'WARN',
    mute   : 'MUTE',
    kick   : 'KICK',
    ban    : 'BAN',
    unmute : 'UNMUTE',
    unban  : 'UNBAN',
  };

  const label = typeLabels[sanction.type] ?? sanction.type.toUpperCase();
  const date  = sanction.createdAt ? `<t:${sanction.createdAt}:d>` : 'Date inconnue';

  const reason = formatSanctionReason(sanction);
  const mod    = sanction.moderatorId ? ` • <@${sanction.moderatorId}>` : '';

  return `\`${index}.\` **${label}** • ${date}${mod}${reason ? ` • ${reason}` : ''}`;
}

function formatSanctionReason(sanction) {
  const reason = sanction.reason?.trim();

  if (!reason || reason === 'Aucune raison fournie') {
    return '';
  }

  if (reason.startsWith('Automod -')) {
    return '';
  }

  if (reason.startsWith('Seuil de warns atteint')) {
    return reason
      .replace('Seuil de warns atteint', 'Seuil atteint')
      .trim();
  }

  return reason;
}

function chunkArray(array, size) {
  const chunks = [];

  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }

  return chunks;
}
