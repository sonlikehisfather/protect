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
    name        : 'banlist',
    description : 'Affiche la liste des membres actuellement bannis.',
    usage       : 'banlist',
    aliases     : ['blist', 'listban'],
  },

  async run(client, message) {
    const guild   = message.guild;
    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const bans = await _fetchAllBans(guild);

    if (!bans || !bans.size) {
      const sent = await message.channel.send({
        embeds: [
          embed.build(guildId, 'Aucun membre n’est actuellement banni.', {
            timestamp: false,
          }),
        ],
        allowedMentions: { repliedUser: false },
      }).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    const entries = [];

    for (const ban of bans.values()) {
      const user   = ban.user;
      const userId = user?.id ?? null;
      const tag    = user?.tag ?? 'Utilisateur inconnu';

      let status = 'ban permanent';
      let reason = ban.reason?.trim() || null;

      if (userId) {
        const activeTempBans = db.getActiveSanctionsByType(guildId, userId, 'tempban');

        if (activeTempBans?.length) {
          const tempBan = activeTempBans
            .filter(s => s.expiresAt && s.active)
            .sort((a, b) => (b.expiresAt || 0) - (a.expiresAt || 0))[0];

          if (tempBan?.expiresAt) {
            status = `tempban jusqu'à <t:${tempBan.expiresAt}:f>`;
          }

          if (!reason && tempBan?.reason?.trim()) {
            reason = tempBan.reason.trim();
          }
        }
      }

      if (!reason) {
        reason = 'Aucune raison';
      }

      entries.push(
        userId
          ? `• <@${userId}> **${tag}** (\`${userId}\`) - ${status} • ${reason}`
          : `• **${tag}** (\`Inconnu\`) - ${status} • ${reason}`
      );
    }

    const pages = [];
    for (let i = 0; i < entries.length; i += PAGE_SIZE) {
      const chunk = entries.slice(i, i + PAGE_SIZE);

      pages.push(
        embed.build(guildId, null, {
          title  : 'Liste des membres bannis',
          fields : [
            {
              name   : 'Membres',
              value  : chunk.join('\n'),
              inline : false,
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
          .setCustomId('banlist:prev')
          .setLabel('\u25C0')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || current === 0),

        new ButtonBuilder()
          .setCustomId('banlist:next')
          .setLabel('\u25B6')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled || current === pages.length - 1),

        new ButtonBuilder()
          .setCustomId('banlist:close')
          .setLabel('\u2716')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(disabled),
      ),
    ];

    const msg = await message.channel.send({
      embeds     : [pages[current]],
      components : buildRows(),
      allowedMentions: { repliedUser: false },
    }).catch(() => null);

    if (!msg) return;

    embed.registerPrivateInteraction(msg, message.author.id, TIMEOUT_MS);

    const collector = msg.createMessageComponentCollector({
      filter : i => i.user.id === message.author.id,
      idle   : IDLE_MS,
      time   : TIMEOUT_MS,
    });

    collector.on('collect', async i => {
      try {
        if (i.customId === 'banlist:close') {
          await i.deferUpdate().catch(() => {});
          embed.clearPrivateInteraction(msg);
          collector.stop('closed');
          return msg.delete().catch(() => {});
        }

        if (i.customId === 'banlist:prev' && current > 0) current--;
        if (i.customId === 'banlist:next' && current < pages.length - 1) current++;

        await i.update({
          embeds     : [pages[current]],
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
      msg.edit({ components: [] }).catch(() => {});
    });
  },
};


async function _fetchAllBans(guild) {
  const MAX_PAGES = 50;
  const PAGE_LIMIT = 1000;
  const all = new Map();
  let after;

  for (let i = 0; i < MAX_PAGES; i++) {
    const opts = { limit: PAGE_LIMIT, cache: false };
    if (after) opts.after = after;

    const batch = await guild.bans.fetch(opts).catch(() => null);
    if (!batch || batch.size === 0) break;

    for (const [id, ban] of batch) all.set(id, ban);

    if (batch.size < PAGE_LIMIT) break;


    let maxId = after;
    for (const id of batch.keys()) {
      if (!maxId || BigInt(id) > BigInt(maxId)) maxId = id;
    }
    if (!maxId || maxId === after) break;
    after = maxId;
  }

  return all;
}
