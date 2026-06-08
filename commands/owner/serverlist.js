'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const PAGE_SIZE      = 25;
const IDLE_MS        = 300_000;
const TIMEOUT_MS     = 900_000;
const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder === 'function' &&
                           typeof TextDisplayBuilder === 'function';

module.exports = {
  help: {
    name        : 'serverlist',
    description : 'Affiche la liste des serveurs où se trouve le bot.',
    use         : 'serverlist',
    usage       : 'serverlist',
    aliases     : ['servers', 'guilds', 'guildlist'],
    category    : 'owner',
  },

  async run(client, message, args) {
    const guildId = message.guild.id;

    if (!perms.check(message, module.exports.help.name)) return;

    const cfg         = db.getGuildConfig(guildId);
    const deleteCmd   = Boolean(cfg?.autoDeleteInfoCmds);
    const deleteReply = Boolean(cfg?.autoDeleteInfoReplies);
    const deleteDelay = Number(cfg?.autoDeleteDelay ?? 5);

    if (deleteCmd) await message.delete().catch(() => {});

    const guilds = _getSortedGuilds(client);
    if (!guilds.length) {
      const e = await embed.replyError(message, 'Aucun serveur trouvé.', { timestamp: false }).catch(() => null);
      if (e && deleteReply) embed.scheduleDelete(e, deleteDelay);
      return;
    }

    const totalPages   = Math.max(1, Math.ceil(guilds.length / PAGE_SIZE));
    const totalMembers = guilds.reduce((s, g) => s + (g.memberCount || 0), 0);

    let page      = 0;
    let selected  = null;

    const buildPayload = (disabled = false) => {
      const slice  = guilds.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      const offset = page * PAGE_SIZE;

      const listLines = slice.map((g, i) =>
        `**${offset + i + 1}.** ${_escape(g.name)} \`${g.id}\` · ${g.memberCount ?? '?'} membres`
      );

      const headerText =
        `## ◈ Serverlist\n` +
        `-# ${guilds.length} serveurs · ${totalMembers} membres au total` +
        (totalPages > 1 ? ` · Page ${page + 1}/${totalPages}` : '');

      const detailText = selected ? _buildDetail(selected) : null;

      const selectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('local:sl:select')
          .setPlaceholder('◈ Sélectionner un serveur')
          .setDisabled(disabled)
          .addOptions(slice.map((g, i) => ({
            label      : _escape(g.name).slice(0, 100),
            value      : g.id,
            description: `${g.memberCount ?? '?'} membres · ${g.id}`.slice(0, 100),
            default    : selected?.id === g.id,
          })))
      );

      const navBtns = [];
      if (totalPages > 1) {
        navBtns.push(
          new ButtonBuilder().setCustomId('local:sl:prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(disabled || page === 0),
          new ButtonBuilder().setCustomId('local:sl:next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(disabled || page >= totalPages - 1),
        );
      }

      const actionBtns = [
        new ButtonBuilder().setCustomId('local:sl:invite').setLabel('Inviter').setStyle(ButtonStyle.Primary).setDisabled(disabled || !selected),
        new ButtonBuilder().setCustomId('local:sl:leave').setLabel('Quitter').setStyle(ButtonStyle.Danger).setDisabled(disabled || !selected),
        new ButtonBuilder().setCustomId('local:sl:close').setLabel('✖').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      ];

      const rows = [selectRow];
      if (navBtns.length) rows.push(new ActionRowBuilder().addComponents(...navBtns));
      rows.push(new ActionRowBuilder().addComponents(...actionBtns));

      if (V2_AVAILABLE) {
        try {
          const container = new ContainerBuilder();
          container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));
          container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
          container.addTextDisplayComponents(new TextDisplayBuilder().setContent(listLines.join('\n')));
          if (detailText) {
            container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(detailText));
          }
          for (const row of rows) container.addActionRowComponents(row);
          return { embeds: [], components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } };
        } catch {}
      }

      return {
        embeds: [embed.build(guildId, listLines.join('\n'), {
          title    : `Serverlist (${guilds.length})`,
          footer   : { text: `Page ${page + 1}/${totalPages} · ${guilds.length} serveurs` },
          timestamp: false,
        })],
        components      : rows,
        allowedMentions : { parse: [] },
      };
    };

    const panel = await message.channel.send(buildPayload()).catch(() => null);
    if (!panel) return;

    embed.registerPrivateInteraction(panel, message.author.id, TIMEOUT_MS);

    const collector = panel.createMessageComponentCollector({
      filter : i => i.user.id === message.author.id && i.message.id === panel.id,
      idle   : IDLE_MS,
      time   : TIMEOUT_MS,
    });

    collector.on('collect', async i => {
      try {
        const id = i.customId;

        if (id === 'local:sl:close') {
          await i.deferUpdate().catch(() => {});
          collector.stop('closed');
          return;
        }

        if (id === 'local:sl:prev') { page = Math.max(0, page - 1); selected = null; await i.deferUpdate().catch(() => {}); await panel.edit(buildPayload()).catch(() => {}); return; }
        if (id === 'local:sl:next') { page = Math.min(totalPages - 1, page + 1); selected = null; await i.deferUpdate().catch(() => {}); await panel.edit(buildPayload()).catch(() => {}); return; }

        if (id === 'local:sl:select') {
          selected = client.guilds.cache.get(i.values[0]) ?? null;
          await i.deferUpdate().catch(() => {});
          await panel.edit(buildPayload()).catch(() => {});
          return;
        }

        if (id === 'local:sl:invite') {
          if (!selected) { await i.deferUpdate().catch(() => {}); return; }
          const ch = selected.channels.cache
            .filter(c => c.type === 0 && c.permissionsFor(selected.members.me)?.has('CreateInstantInvite'))
            .sort((a, b) => a.rawPosition - b.rawPosition)
            .first();
          if (!ch) {
            await i.reply({ content: 'Aucun salon disponible pour créer une invitation.', flags: MessageFlags.Ephemeral }).catch(() => {});
            return;
          }
          const inv = await ch.createInvite({ maxAge: 86400, maxUses: 1, reason: `Serverlist - ${message.author.tag}` }).catch(() => null);
          if (!inv) { await i.reply({ content: 'Impossible de créer une invitation.', flags: MessageFlags.Ephemeral }).catch(() => {}); return; }
          await i.reply({ content: `**${_escape(selected.name)}** › ${inv.url}`, flags: MessageFlags.Ephemeral }).catch(() => {});
          return;
        }

        if (id === 'local:sl:leave') {
          await i.deferUpdate().catch(() => {});
          if (!selected) return;
          const leaving = selected;
          selected = null;
          await leaving.leave().catch(() => {});
          await panel.edit(buildPayload()).catch(() => {});
          return;
        }

      } catch (err) {
        if (err?.code !== 10062 && err?.code !== 40060) {
          console.error('[serverlist] collector error:', err?.message ?? err);
        }
      }
    });

    collector.on('end', (_, reason) => {
      embed.clearPrivateInteraction(panel);
      if (reason === 'closed') {
        panel.delete().catch(() => {});
        return;
      }
      panel.edit(buildPayload(true)).catch(() => {});
      if (deleteReply) embed.scheduleDelete(panel, deleteDelay);
    });
  },
};

function _getSortedGuilds(client) {
  return [...client.guilds.cache.values()].sort((a, b) => {
    const diff = (b.memberCount || 0) - (a.memberCount || 0);
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });
}

function _buildDetail(guild) {
  const owner    = guild.ownerId ? `<@${guild.ownerId}>` : 'Inconnu';
  const created  = guild.createdTimestamp ? `<t:${Math.floor(guild.createdTimestamp / 1000)}:d>` : '?';
  const joined   = guild.joinedTimestamp  ? `<t:${Math.floor(guild.joinedTimestamp  / 1000)}:d>` : '?';
  const channels = guild.channels.cache.size;
  const roles    = guild.roles.cache.size;
  const boost    = guild.premiumSubscriptionCount ?? 0;

  return [
    `### ${_escape(guild.name)}`,
    `**ID** › \`${guild.id}\``,
    `**Propriétaire** › ${owner}`,
    `**Membres** › ${guild.memberCount ?? '?'}`,
    `**Salons** › ${channels} · **Rôles** › ${roles} · **Boosts** › ${boost}`,
    `**Créé** › ${created} · **Rejoint** › ${joined}`,
  ].join('\n');
}

function _escape(value) {
  return String(value || '').replace(/\*/g, '\\*').replace(/_/g, '\\_').replace(/`/g, "'").slice(0, 80);
}
