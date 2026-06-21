'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const TIMEOUT = 120_000;
const PAGE_SIZE = 10;

module.exports = {
  help: {
    name        : 'myembeds',
    description : 'Gérer tes templates d\'embed sauvegardés (lister, voir, supprimer).',
    usage       : 'myembeds',
    aliases     : [],
  },

  async run(client, message, args) {
    const guildId = message.guild.id;

    if (!perms.check(message, module.exports.help.name)) {
      return embed.replyError(
        message,
        "Vous n'avez pas la permission d'utiliser cette commande.",
        { timestamp: false }
      ).catch(() => {});
    }

    const config = db.getGuildConfig(guildId);
    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) await message.delete().catch(() => {});

    const templates = db.listEmbeds(guildId);

    if (!templates.length) {
      const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `## Mes templates\n\nAucun template sauvegardé.\nUtilise \`${config?.prefix || '+'}embed capture\` pour en créer un.`
        ));
      const sent = await message.channel.send({
        components      : [container],
        flags           : COMPONENTS_V2_FLAG,
        allowedMentions : { parse: [] },
      }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    let page = 0;
    const pages = Math.ceil(templates.length / PAGE_SIZE);
    let selectedName = null;
    let busy = false;

    const _buildPanel = () => {
      const container = new ContainerBuilder();

      if (selectedName) {
        const t = templates.find(t => t.name === selectedName);
        if (!t) {
          selectedName = null;
        } else {
          const isV2 = t.data?.isV2;
          const infoLines = [
            `## Template \`${t.name}\``,
            ``,
            `**Type** : ${isV2 ? 'Components V2 ◈' : 'Embed classique'}`,
            `**Créé par** : <@${t.createdBy}>`,
            ``,
            `-# Clique sur **Aperçu** pour voir • **Supprimer** pour effacer • **Retour** pour la liste`,
          ].join('\n');
          container.addTextDisplayComponents(new TextDisplayBuilder().setContent(infoLines));
          container.addSeparatorComponents(new SeparatorBuilder().setSpacing(1));
          container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('mye:preview').setLabel('Aperçu').setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId('mye:delete').setLabel('Supprimer').setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId('mye:back').setLabel('Retour').setStyle(ButtonStyle.Secondary),
              new ButtonBuilder().setCustomId('mye:close').setLabel('✖').setStyle(ButtonStyle.Secondary),
            )
          );
          return {
            components      : [container],
            flags           : COMPONENTS_V2_FLAG,
            allowedMentions : { parse: [] },
          };
        }
      }

      const slice = templates.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
      const header = `## Mes templates\n\n${templates.length} template(s) sauvegardé(s)${pages > 1 ? ` ・ Page ${page + 1}/${pages}` : ''}\n\nSélectionne un template dans le menu ci-dessous :`;
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(header));
      container.addSeparatorComponents(new SeparatorBuilder().setSpacing(1));

      const options = slice.map((t, i) => {
        const idx = page * PAGE_SIZE + i;
        const v2Tag = t.data?.isV2 ? ' ◈ V2' : '';
        return {
          label  : `${String(idx + 1).padStart(2, '0')}. ${t.name}`.slice(0, 100),
          value  : t.name,
          description : `${t.data?.isV2 ? 'Components V2' : 'Embed'} ・ par <@${t.createdBy}>`.slice(0, 100),
        };
      });

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('mye:select')
        .setPlaceholder('Choisir un template...')
        .addOptions(options);

      container.addActionRowComponents(new ActionRowBuilder().addComponents(selectMenu));

      const navRow = new ActionRowBuilder();
      if (pages > 1) {
        navRow.addComponents(
          new ButtonBuilder().setCustomId('mye:prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
          new ButtonBuilder().setCustomId('mye:next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1),
        );
      }
      navRow.addComponents(new ButtonBuilder().setCustomId('mye:close').setLabel('✖').setStyle(ButtonStyle.Danger));
      container.addActionRowComponents(navRow);

      return {
        components      : [container],
        flags           : COMPONENTS_V2_FLAG,
        allowedMentions : { parse: [] },
      };
    };

    const panel = await message.channel.send(_buildPanel()).catch(() => null);
    if (!panel) return;

    embed.registerPrivateInteraction(panel, message.author.id, TIMEOUT);

    const collector = panel.createMessageComponentCollector({
      filter: i => i.user.id === message.author.id,
      time: TIMEOUT,
    });

    collector.on('collect', async (i) => {
      const id = i.customId;

      if (busy) {
        await i.deferUpdate().catch(() => {});
        return;
      }

      if (id === 'mye:close') {
        collector.stop('closed');
        await i.deferUpdate().catch(() => {});
        panel.delete().catch(() => {});
        message.delete().catch(() => {});
        return;
      }

      if (id === 'mye:prev') {
        page = Math.max(0, page - 1);
        selectedName = null;
        await i.deferUpdate().catch(() => {});
        await panel.edit(_buildPanel()).catch(() => {});
        return;
      }

      if (id === 'mye:next') {
        page = Math.min(pages - 1, page + 1);
        selectedName = null;
        await i.deferUpdate().catch(() => {});
        await panel.edit(_buildPanel()).catch(() => {});
        return;
      }

      if (id === 'mye:back') {
        selectedName = null;
        await i.deferUpdate().catch(() => {});
        await panel.edit(_buildPanel()).catch(() => {});
        return;
      }

      if (id === 'mye:select') {
        selectedName = i.values[0];
        await i.deferUpdate().catch(() => {});
        await panel.edit(_buildPanel()).catch(() => {});
        return;
      }

      if (id === 'mye:preview') {
        if (!selectedName) {
          await i.deferUpdate().catch(() => {});
          return;
        }
        const t = templates.find(t => t.name === selectedName);
        if (!t) {
          await i.deferUpdate().catch(() => {});
          return;
        }
        const saved = db.getEmbed(guildId, t.name);
        if (!saved) {
          await i.reply({ content: 'Template introuvable.', flags: 64 }).catch(() => {});
          return;
        }

        if (saved.data?.isV2) {
          try {
            const embedMod = require('./embed');
            const container = embedMod._rebuildV2Container
              ? embedMod._rebuildV2Container(saved.data.components)
              : null;
            if (container) {
              await i.reply({
                components      : [container],
                flags           : COMPONENTS_V2_FLAG | 64,
                allowedMentions : { parse: [] },
              }).catch(() => {});
            } else {
              await i.reply({ content: 'Aperçu V2 indisponible.', flags: 64 }).catch(() => {});
            }
          } catch {
            await i.reply({ content: 'Erreur lors de l\'aperçu V2.', flags: 64 }).catch(() => {});
          }
          return;
        }

        const d = saved.data;
        const previewEmbed = new EmbedBuilder();
        if (d.title)       previewEmbed.setTitle(d.title);
        if (d.description) previewEmbed.setDescription(d.description);
        if (d.color)       previewEmbed.setColor(d.color);
        if (d.url)         previewEmbed.setURL(d.url);
        if (d.timestamp)   previewEmbed.setTimestamp();
        if (d.author)      previewEmbed.setAuthor({ name: d.author.name ?? d.author, iconURL: d.author.icon_url ?? d.authorIcon ?? undefined, url: d.author.url ?? d.authorUrl ?? undefined });
        if (d.footer)      previewEmbed.setFooter({ text: d.footer.text ?? d.footer, iconURL: d.footer.icon_url ?? d.footerIcon ?? undefined });
        if (d.thumbnail)   previewEmbed.setThumbnail(d.thumbnail.url ?? d.thumbnail);
        if (d.image)       previewEmbed.setImage(d.image.url ?? d.image);
        if (Array.isArray(d.fields) && d.fields.length) {
          previewEmbed.addFields(d.fields.map(f => ({ name: f.name, value: f.value, inline: f.inline ?? false })));
        }
        await i.reply({
          embeds          : [previewEmbed],
          flags           : 64,
          allowedMentions : { parse: [] },
        }).catch(() => {});
        return;
      }

      if (id === 'mye:delete') {
        if (!selectedName) {
          await i.deferUpdate().catch(() => {});
          return;
        }
        const t = templates.find(t => t.name === selectedName);
        if (!t) {
          await i.deferUpdate().catch(() => {});
          return;
        }

        const confirmContainer = new ContainerBuilder()
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## Supprimer \`${t.name}\` ?\n\nCette action est irréversible.`
          ))
          .addActionRowComponents(
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('mye:delyes').setLabel('Supprimer').setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId('mye:delno').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
            )
          );

        await i.deferUpdate().catch(() => {});
        await panel.edit({
          components      : [confirmContainer],
          flags           : COMPONENTS_V2_FLAG,
          allowedMentions : { parse: [] },
        }).catch(() => {});

        const confirmCollector = panel.createMessageComponentCollector({
          filter: x => x.user.id === message.author.id && (x.customId === 'mye:delyes' || x.customId === 'mye:delno'),
          time: 30_000,
          max: 1,
        });

        confirmCollector.on('collect', async (x) => {
          if (x.customId === 'mye:delyes') {
            db.deleteEmbed(guildId, t.name);
            const delIdx = templates.findIndex(tt => tt.name === t.name);
            if (delIdx >= 0) templates.splice(delIdx, 1);
            selectedName = null;
            if (templates.length === 0) {
              collector.stop('deleted_all');
              await x.deferUpdate().catch(() => {});
              const emptyContainer = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                  `## Mes templates\n\nTous les templates ont été supprimés.\nUtilise \`${config?.prefix || '+'}embed capture\` pour en créer un.`
                ));
              await panel.edit({
                components      : [emptyContainer],
                flags           : COMPONENTS_V2_FLAG,
                allowedMentions : { parse: [] },
              }).catch(() => {});
              if (deleteReply) embed.scheduleDelete(panel, deleteDelay);
              return;
            }
            const newPages = Math.ceil(templates.length / PAGE_SIZE);
            if (page >= newPages) page = Math.max(0, newPages - 1);
            await x.deferUpdate().catch(() => {});
            await panel.edit(_buildPanel()).catch(() => {});
          } else {
            await x.deferUpdate().catch(() => {});
            await panel.edit(_buildPanel()).catch(() => {});
          }
        });

        confirmCollector.on('end', (_, reason) => {
          if (reason === 'time') {
            panel.edit(_buildPanel()).catch(() => {});
          }
        });
        return;
      }

      await i.deferUpdate().catch(() => {});
    });

    collector.on('end', (_, reason) => {
      embed.clearPrivateInteraction(panel);
      if (reason === 'closed' || reason === 'deleted_all') return;
      panel.edit({ ..._buildPanel(), embeds: [] }).catch(() => {});
    });
  },
};
