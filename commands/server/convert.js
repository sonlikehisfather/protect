'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  EmbedBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder === 'function' &&
                           typeof TextDisplayBuilder === 'function';
const IDLE_MS    = 300_000;
const TIMEOUT_MS = 900_000;
const PAGE_SIZE  = 10;

module.exports = {
  help: {
    name        : 'v2',
    description : 'Convertir et gérer tes templates d\'embed entre V1 et Components V2.',
    usage       : 'v2',
    aliases     : ['embedv2', 'tov2'],
  },

  async run(client, message, args) {
    const guildId = message.guild.id;

    if (!perms.check(message, module.exports.help.name)) {
      return embed.replyError(
        message,
        "Vous n'avez pas la permission d'utiliser cette commande.",
        { timestamp: false },
      ).catch(() => {});
    }

    const config = db.getGuildConfig(guildId);
    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) await message.delete().catch(() => {});

    const templates = db.listEmbeds(guildId);

    if (!templates.length) {
      let sent = null;
      if (embed.shouldUseV2(guildId, module.exports.help.name)) {
        try {
          const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
              '## Convertisseur V2\n\nAucun template sauvegardé.\n' +
              'Utilise `' + (config?.prefix || '+') + 'embed capture` pour en créer un.'
            ));
          sent = await message.channel.send({
            components      : [container],
            flags           : COMPONENTS_V2_FLAG,
            allowedMentions : { parse: [] },
          }).catch(() => null);
        } catch {}
      }
      if (!sent) {
        sent = await embed.sendEmbed(message.channel, guildId, 'Aucun template sauvegardé. Utilise `+embed capture` pour en créer un.', { timestamp: false });
      }
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    let page = 0;
    const pages = Math.ceil(templates.length / PAGE_SIZE);
    let selectedName = null;
    let busy = false;

    /* ── Helpers ────────────────────────────────────────────── */

    function _findTemplate(name) {
      return templates.find(t => t.name === name) || null;
    }

    function _embedToV2Components(data) {
      const components = [];
      const textParts = [];

      if (data.title) {
        textParts.push('## ' + data.title);
      }
      if (data.author) {
        textParts.push('> ' + data.author);
      }
      if (data.description) {
        textParts.push('', data.description);
      }
      if (Array.isArray(data.fields) && data.fields.length) {
        for (const f of data.fields) {
          textParts.push('', '**' + f.name + '**', f.value);
        }
      }
      if (data.footer) {
        textParts.push('', '-# ' + data.footer);
      }
      if (data.timestamp) {
        textParts.push('-# <t:' + Math.floor(Date.now() / 1000) + ':R>');
      }

      if (textParts.length) {
        components.push({
          type      : 10,
          content   : textParts.join('\n').slice(0, 4000),
        });
      }

      const mediaItems = [];
      if (data.thumbnail) {
        mediaItems.push({ url: typeof data.thumbnail === 'string' ? data.thumbnail : (data.thumbnail?.url || data.thumbnail) });
      }
      if (data.image) {
        mediaItems.push({ url: typeof data.image === 'string' ? data.image : (data.image?.url || data.image) });
      }
      if (mediaItems.length) {
        components.push({
          type  : 13,
          items : mediaItems,
        });
      }

      return components;
    }

    function _v2ToEmbedData(v2Data) {
      const result = {
        title       : null,
        description : null,
        author      : null,
        authorIcon  : null,
        footer      : null,
        footerIcon  : null,
        thumbnail   : null,
        image       : null,
        url         : null,
        color       : '#2B2D31',
        timestamp   : false,
        fields      : [],
      };

      const comps = v2Data.components || [];
      for (const comp of comps) {
        const type = comp?.type;
        if (type === 10 || type === 'textDisplay') {
          const content = comp.content || '';
          const lines = content.split('\n');
          let i = 0;
          if (lines[0]?.startsWith('## ')) {
            result.title = lines[0].slice(3).trim() || null;
            i = 1;
          }
          if (lines[i]?.startsWith('> ')) {
            result.author = lines[i].slice(2).trim() || null;
            i++;
          }
          const descLines = [];
          const fields = [];
          while (i < lines.length) {
            const line = lines[i];
            if (line.startsWith('-# ')) {
              if (!result.footer) result.footer = line.slice(3).trim();
            } else if (line.startsWith('**') && line.endsWith('**') && i + 1 < lines.length) {
              const fName = line.slice(2, -2).trim();
              const fValue = lines[i + 1] || '';
              fields.push({ name: fName, value: fValue, inline: false });
              i++;
            } else if (line === '' && descLines.length === 0 && i > 0) {
              // skip empty line between sections
            } else {
              descLines.push(line);
            }
            i++;
          }
          if (descLines.length) result.description = descLines.join('\n').trim() || null;
          if (fields.length) result.fields = fields;
        } else if (type === 13 || type === 'mediaGallery') {
          if (Array.isArray(comp.items)) {
            if (!result.thumbnail && comp.items[0]?.url) result.thumbnail = comp.items[0].url;
            if (!result.image && comp.items[1]?.url) result.image = comp.items[1].url;
            else if (!result.image && comp.items[0]?.url && result.thumbnail) result.image = comp.items[0].url;
          }
        }
      }
      return result;
    }

    function _buildLegacyEmbed(data) {
      const e = new EmbedBuilder().setColor(data.color || '#2B2D31');
      if (data.title)       e.setTitle(data.title.slice(0, 256));
      if (data.description) e.setDescription(data.description.slice(0, 4096));
      if (data.url)         e.setURL(data.url);
      if (data.timestamp)   e.setTimestamp();
      if (data.author)      e.setAuthor({ name: String(data.author).slice(0, 256), iconURL: data.authorIcon || undefined, url: data.authorUrl || undefined });
      if (data.footer)      e.setFooter({ text: String(data.footer).slice(0, 2048), iconURL: data.footerIcon || undefined });
      if (data.thumbnail)   e.setThumbnail(typeof data.thumbnail === 'string' ? data.thumbnail : (data.thumbnail?.url || data.thumbnail));
      if (data.image)       e.setImage(typeof data.image === 'string' ? data.image : (data.image?.url || data.image));
      if (Array.isArray(data.fields) && data.fields.length) {
        e.addFields(data.fields.slice(0, 25).map(f => ({
          name: String(f.name || '\u200b').slice(0, 256),
          value: String(f.value || '\u200b').slice(0, 1024),
          inline: f.inline ?? false,
        })));
      }
      return e;
    }

    function _rebuildV2Container(componentsJson) {
      if (!Array.isArray(componentsJson)) throw new Error('Invalid V2 JSON');
      let items = componentsJson;
      if (items.length === 1 && (items[0]?.type === 17 || items[0]?.type === 'container')) {
        items = items[0].components || [];
      }
      const container = new ContainerBuilder();
      let count = 0;
      const MAX = 40;
      for (const raw of items) {
        if (count >= MAX) break;
        const type = raw?.type;
        try {
          if (type === 10 || type === 'textDisplay') {
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(raw.content || ''));
            count++;
          } else if (type === 14 || type === 'separator') {
            const sep = new SeparatorBuilder();
            if (raw.spacing != null) sep.setSpacing(raw.spacing);
            if (raw.divider != null) sep.setDivider(raw.divider);
            container.addSeparatorComponents(sep);
            count++;
          } else if (type === 13 || type === 'mediaGallery') {
            const gallery = new MediaGalleryBuilder();
            if (Array.isArray(raw.items)) {
              for (const item of raw.items) {
                if (item?.url) gallery.addItems(new MediaGalleryItemBuilder().setURL(item.url));
              }
            }
            container.addMediaGalleryComponents(gallery);
            count++;
          } else if (type === 1 || type === 'actionRow') {
            const row = new ActionRowBuilder();
            if (Array.isArray(raw.components)) {
              for (const btn of raw.components) {
                if (btn?.type === 2 || btn?.type === 'button') {
                  const b = new ButtonBuilder();
                  if (btn.style != null) b.setStyle(btn.style);
                  if (btn.label) b.setLabel(String(btn.label).slice(0, 80));
                  if (btn.emoji) { try { b.setEmoji(btn.emoji); } catch {} }
                  if (btn.url) b.setURL(btn.url);
                  if (btn.custom_id) b.setCustomId(btn.custom_id);
                  if (btn.disabled) b.setDisabled(true);
                  row.addComponents(b);
                }
              }
            }
            if (row.components.length) {
              container.addActionRowComponents(row);
              count++;
            }
          }
        } catch {}
      }
      return container;
    }

    /* ── Panel builder ──────────────────────────────────────── */

    function _buildPanel() {
      const container = new ContainerBuilder();

      if (selectedName) {
        const t = _findTemplate(selectedName);
        if (!t) {
          selectedName = null;
        } else {
          const isV2    = Boolean(t.data?.isV2);
          const compCount = isV2 ? (t.data?.components?.length || 0) : 0;
          const fieldCount = !isV2 ? (t.data?.fields?.length || 0) : 0;

          const infoLines = [
            '## Template `' + t.name + '`',
            '',
            '**Type** › ' + (isV2 ? 'Components V2' : 'Embed classique'),
            '**Créé par** › <@' + t.createdBy + '>',
            isV2
              ? '**Composants** › ' + compCount + ' élément(s)'
              : '**Fields** › ' + fieldCount + ' champ(s)',
            '',
            '-# Aperçu › voir le rendu ・ Convertir › transformer',
          ];
          container.addTextDisplayComponents(new TextDisplayBuilder().setContent(infoLines.join('\n')));
          container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

          const btnRow = new ActionRowBuilder();

          if (isV2) {
            btnRow.addComponents(
              new ButtonBuilder().setCustomId('v2:preview').setLabel('Aperçu V2').setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId('v2:toV1').setLabel('Convertir en V1').setStyle(ButtonStyle.Secondary),
            );
          } else {
            btnRow.addComponents(
              new ButtonBuilder().setCustomId('v2:preview').setLabel('Aperçu V1').setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId('v2:toV2').setLabel('Convertir en V2').setStyle(ButtonStyle.Secondary),
            );
          }

          btnRow.addComponents(
            new ButtonBuilder().setCustomId('v2:back').setLabel('Retour').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('v2:close').setLabel('\u2716').setStyle(ButtonStyle.Danger),
          );

          container.addActionRowComponents(btnRow);
          return {
            components      : [container],
            flags           : COMPONENTS_V2_FLAG,
            allowedMentions : { parse: [] },
          };
        }
      }

      const slice = templates.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
      const header = '## Convertisseur V2\n\n' +
        templates.length + ' template(s) sauvegardé(s)' +
        (pages > 1 ? ' ・ Page ' + (page + 1) + '/' + pages : '') + '\n\n' +
        'Sélectionne un template pour le convertir :';
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(header));
      container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

      const options = slice.map((t, i) => {
        const idx = page * PAGE_SIZE + i;
        const isV2 = Boolean(t.data?.isV2);
        return {
          label       : (String(idx + 1).padStart(2, '0') + '. ' + t.name).slice(0, 100),
          value       : t.name,
          description : (isV2 ? 'Components V2' : 'Embed classique') + ' ・ par <@' + t.createdBy + '>'.slice(0, 100),
        };
      });

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('v2:select')
        .setPlaceholder('Choisir un template...')
        .addOptions(options);

      container.addActionRowComponents(new ActionRowBuilder().addComponents(selectMenu));

      const navRow = new ActionRowBuilder();
      if (pages > 1) {
        navRow.addComponents(
          new ButtonBuilder().setCustomId('v2:prev').setLabel('\u2190').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
          new ButtonBuilder().setCustomId('v2:next').setLabel('\u2192').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1),
        );
      }
      navRow.addComponents(new ButtonBuilder().setCustomId('v2:close').setLabel('\u2716').setStyle(ButtonStyle.Danger));
      container.addActionRowComponents(navRow);

      return {
        components      : [container],
        flags           : COMPONENTS_V2_FLAG,
        allowedMentions : { parse: [] },
      };
    }

    function _buildConfirmPanel(templateName, direction) {
      const container = new ContainerBuilder();
      const text = '## Confirmer la conversion\n\n' +
        'Template : `' + templateName + '`\n' +
        'Direction : ' + (direction === 'toV2' ? 'V1 \u2192 **Components V2**' : 'V2 \u2191 **Embed classique**') + '\n\n' +
        '-# Le template sera remplacé. Cette action est irréversible.';
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('v2:confirm:' + direction).setLabel('Confirmer').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('v2:cancel').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
        )
      );
      return {
        components      : [container],
        flags           : COMPONENTS_V2_FLAG,
        allowedMentions : { parse: [] },
      };
    }

    /* ── Send panel ──────────────────────────────────────────── */

    const _w = (p) => embed.wrapPayload(guildId, p, 'convert');
    const panel = await message.channel.send(_w(_buildPanel())).catch(() => null);
    if (!panel) return;

    embed.registerPrivateInteraction(panel, message.author.id, TIMEOUT_MS);

    const collector = panel.createMessageComponentCollector({
      filter: i => i.user.id === message.author.id,
      idle: IDLE_MS,
      time: TIMEOUT_MS,
    });

    collector.on('collect', async (i) => {
      const id = i.customId;

      if (busy) {
        await i.deferUpdate().catch(() => {});
        return;
      }

      /* ── Close ── */
      if (id === 'v2:close') {
        collector.stop('closed');
        await i.deferUpdate().catch(() => {});
        panel.delete().catch(() => {});
        message.delete().catch(() => {});
        return;
      }

      /* ── Pagination ── */
      if (id === 'v2:prev') {
        page = Math.max(0, page - 1);
        selectedName = null;
        await i.deferUpdate().catch(() => {});
        await panel.edit(_w(_buildPanel())).catch(() => {});
        return;
      }

      if (id === 'v2:next') {
        page = Math.min(pages - 1, page + 1);
        selectedName = null;
        await i.deferUpdate().catch(() => {});
        await panel.edit(_w(_buildPanel())).catch(() => {});
        return;
      }

      /* ── Back to list ── */
      if (id === 'v2:back') {
        selectedName = null;
        await i.deferUpdate().catch(() => {});
        await panel.edit(_w(_buildPanel())).catch(() => {});
        return;
      }

      /* ── Cancel confirm ── */
      if (id === 'v2:cancel') {
        await i.deferUpdate().catch(() => {});
        await panel.edit(_w(_buildPanel())).catch(() => {});
        return;
      }

      /* ── Select template ── */
      if (id === 'v2:select') {
        selectedName = i.values[0];
        await i.deferUpdate().catch(() => {});
        await panel.edit(_w(_buildPanel())).catch(() => {});
        return;
      }

      /* ── Preview ── */
      if (id === 'v2:preview') {
        if (!selectedName) { await i.deferUpdate().catch(() => {}); return; }
        const t = _findTemplate(selectedName);
        if (!t) { await i.deferUpdate().catch(() => {}); return; }
        const saved = db.getEmbed(guildId, t.name);
        if (!saved) {
          await i.reply({ content: 'Template introuvable.', flags: 64 }).catch(() => {});
          return;
        }

        if (saved.data?.isV2) {
          try {
            const container = _rebuildV2Container(saved.data.components);
            await i.reply({
              components      : [container],
              flags           : COMPONENTS_V2_FLAG | 64,
              allowedMentions : { parse: [] },
            }).catch(() => {});
          } catch {
            await i.reply({ content: 'Erreur lors de l\'aperçu V2.', flags: 64 }).catch(() => {});
          }
        } else {
          try {
            const previewEmbed = _buildLegacyEmbed(saved.data);
            await i.reply({
              embeds          : [previewEmbed],
              flags           : 64,
              allowedMentions : { parse: [] },
            }).catch(() => {});
          } catch {
            await i.reply({ content: 'Erreur lors de l\'aperçu V1.', flags: 64 }).catch(() => {});
          }
        }
        return;
      }

      /* ── Convert to V2 ── */
      if (id === 'v2:toV2') {
        if (!selectedName) { await i.deferUpdate().catch(() => {}); return; }
        await i.deferUpdate().catch(() => {});
        await panel.edit(_w(_buildConfirmPanel(selectedName, 'toV2'))).catch(() => {});
        return;
      }

      /* ── Convert to V1 ── */
      if (id === 'v2:toV1') {
        if (!selectedName) { await i.deferUpdate().catch(() => {}); return; }
        await i.deferUpdate().catch(() => {});
        await panel.edit(_w(_buildConfirmPanel(selectedName, 'toV1'))).catch(() => {});
        return;
      }

      /* ── Confirm conversion ── */
      if (id === 'v2:confirm:toV2' || id === 'v2:confirm:toV1') {
        if (!selectedName) { await i.deferUpdate().catch(() => {}); return; }
        const t = _findTemplate(selectedName);
        if (!t) {
          await i.deferUpdate().catch(() => {});
          await panel.edit(_w(_buildPanel())).catch(() => {});
          return;
        }

        busy = true;
        const saved = db.getEmbed(guildId, t.name);
        if (!saved) {
          busy = false;
          await i.deferUpdate().catch(() => {});
          await panel.edit(_w(_buildPanel())).catch(() => {});
          return;
        }

        const direction = id === 'v2:confirm:toV2' ? 'toV2' : 'toV1';

        try {
          if (direction === 'toV2') {
            if (saved.data?.isV2) {
              busy = false;
              await i.followUp({ content: 'Ce template est déjà en V2.', flags: 64 }).catch(() => {});
              await panel.edit(_w(_buildPanel())).catch(() => {});
              return;
            }
            const components = _embedToV2Components(saved.data);
            const newData = { isV2: true, components };
            db.saveEmbed(guildId, t.name, newData, message.author.id);
            const idx = templates.findIndex(tt => tt.name === t.name);
            if (idx >= 0) {
              templates[idx].data = newData;
              templates[idx].createdBy = message.author.id;
            }
          } else {
            if (!saved.data?.isV2) {
              busy = false;
              await i.followUp({ content: 'Ce template est déjà en V1.', flags: 64 }).catch(() => {});
              await panel.edit(_w(_buildPanel())).catch(() => {});
              return;
            }
            const embedData = _v2ToEmbedData(saved.data);
            db.saveEmbed(guildId, t.name, embedData, message.author.id);
            const idx = templates.findIndex(tt => tt.name === t.name);
            if (idx >= 0) {
              templates[idx].data = embedData;
              templates[idx].createdBy = message.author.id;
            }
          }

          const successText = direction === 'toV2'
            ? 'Template `' + t.name + '` converti en Components V2.'
            : 'Template `' + t.name + '` converti en Embed classique.';

          await i.deferUpdate().catch(() => {});
          await i.followUp({ content: successText, flags: 64, allowedMentions: { parse: [] } }).catch(() => {});
          busy = false;
          await panel.edit(_w(_buildPanel())).catch(() => {});
        } catch (err) {
          busy = false;
          await i.deferUpdate().catch(() => {});
          await i.followUp({ content: 'Erreur lors de la conversion : ' + String(err?.message || err), flags: 64 }).catch(() => {});
          await panel.edit(_w(_buildPanel())).catch(() => {});
        }
        return;
      }

      await i.deferUpdate().catch(() => {});
    });

    collector.on('end', (_, reason) => {
      embed.clearPrivateInteraction(panel);
      if (reason === 'closed') return;
      panel.edit({ ..._w(_buildPanel()), embeds: [] }).catch(() => {});
    });
  },
};
