'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder === 'function' &&
                           typeof TextDisplayBuilder === 'function' &&
                           typeof SeparatorBuilder === 'function';

const IDLE_MS    = 180_000;
const TIMEOUT_MS = 600_000;

module.exports = {
  help: {
    name       : 'setalias',
    description: 'Gérer les alias personnalisés de commandes pour ce serveur.',
    usage      : 'setalias',
    aliases    : [],
    permission : {
      level : 'owner',
      label : 'Owner',
    },
  },

  async run(client, message) {
    if (!perms.check(message, module.exports.help.name)) return;

    const guild   = message.guild;
    const guildId = guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    if (deleteCmd) await message.delete().catch(() => {});

    const allCmds = _getCommandList(client);

    const buildPanelText = () => {
      const allAliases = db.getCmdAliases(guildId);
      let lines = '`Aucun alias configuré sur ce serveur.`';
      if (allAliases.length) {
        const grouped = {};
        for (const { alias, commandName } of allAliases) {
          if (!grouped[commandName]) grouped[commandName] = [];
          grouped[commandName].push(alias);
        }
        lines = Object.entries(grouped)
          .map(([cmd, aliases]) => `**${cmd}** → ${aliases.map(a => `\`${a}\``).join(', ')}`)
          .join('\n');
      }
      return [
        '## ◈ Gestion des alias',
        '',
        '**Alias configurés sur ce serveur :**',
        lines,
        '',
        '*Utilise les boutons pour ajouter ou supprimer des alias.*',
      ].join('\n');
    };

    const buildPayload = () => {
      const text = buildPanelText();

      const addBtn = new ButtonBuilder()
        .setCustomId('sa:add')
        .setLabel('✔ Ajouter un alias')
        .setStyle(ButtonStyle.Success);

      const removeBtn = new ButtonBuilder()
        .setCustomId('sa:remove')
        .setLabel('✖ Supprimer un alias')
        .setStyle(ButtonStyle.Danger);

      const closeBtn = new ButtonBuilder()
        .setCustomId('sa:close')
        .setLabel('✖ Fermer')
        .setStyle(ButtonStyle.Secondary);

      const btnRow = new ActionRowBuilder().addComponents(addBtn, removeBtn, closeBtn);

      if (V2_AVAILABLE) {
        try {
          const accent    = _hexToInt(embed.getGuildColor(guildId));
          const container = new ContainerBuilder().setAccentColor(accent);
          container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
          container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
          container.addActionRowComponents(btnRow);
          return {
            embeds          : [],
            components      : [container],
            flags           : COMPONENTS_V2_FLAG,
            allowedMentions : { parse: [] },
          };
        } catch {}
      }

      return {
        embeds: [embed.build(guildId, null, {
          title      : '◈ Gestion des alias',
          description: text.replace(/^## ◈ Gestion des alias\n/, ''),
          timestamp  : false,
        })],
        components      : [btnRow],
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

    collector.on('collect', async interaction => {
      const id = interaction.customId;

      if (id === 'sa:close') {
        await interaction.deferUpdate().catch(() => {});
        embed.clearPrivateInteraction(panel);
        collector.stop('closed');
        return;
      }

      if (id === 'sa:add') {
        const modal = new ModalBuilder()
          .setCustomId('sa:modal:add')
          .setTitle('Ajouter un alias')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('sa:input:cmd')
                .setLabel('Commande (nom exact)')
                .setStyle(TextInputStyle.Short)
                .setMinLength(1).setMaxLength(32)
                .setPlaceholder('ex: ban, mute, kick...')
                .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('sa:input:aliases')
                .setLabel('Alias séparés par des virgules')
                .setStyle(TextInputStyle.Short)
                .setMinLength(1).setMaxLength(100)
                .setPlaceholder('ex: b, bannir, bann')
                .setRequired(true)
            ),
          );
        await interaction.showModal(modal).catch(() => {});

        const submit = await interaction.awaitModalSubmit({
          filter : i => i.user.id === message.author.id && i.customId === 'sa:modal:add',
          time   : 120_000,
        }).catch(() => null);
        if (!submit) return;

        const cmdInput   = submit.fields.getTextInputValue('sa:input:cmd')?.toLowerCase().trim();
        const aliasInput = submit.fields.getTextInputValue('sa:input:aliases')?.toLowerCase().trim();
        await submit.deferUpdate().catch(() => {});

        if (!allCmds.includes(cmdInput)) {
          const err = await message.channel.send({ embeds: [embed.build(guildId,
            `Commande \`${cmdInput}\` introuvable.`, { timestamp: false, color: '#2b2d31' })] }).catch(() => null);
          if (err) embed.scheduleDelete(err, 3);
          return;
        }

        const aliases = aliasInput.split(',').map(a => a.trim().toLowerCase()).filter(Boolean);
        const errors  = [];
        const added   = [];

        for (const alias of aliases) {
          if (!/^[a-z0-9_-]+$/.test(alias)) { errors.push(`\`${alias}\` invalide`); continue; }
          const nativeMatch = client.commands.get(alias);
          if (nativeMatch) {
            const isAlias = nativeMatch.help?.name !== alias;
            errors.push(isAlias
              ? `\`${alias}\` est déjà un alias natif de **${nativeMatch.help?.name}**`
              : `\`${alias}\` est déjà une commande existante`
            );
            continue;
          }
          const ex = db.getCmdAlias(guildId, alias);
          if (ex) { errors.push(`\`${alias}\` déjà attribué à **${ex.commandName}**`); continue; }
          db.addCmdAlias(guildId, alias, cmdInput);
          added.push(alias);
        }

        if (errors.length) {
          const errMsg = await message.channel.send({ embeds: [embed.build(guildId,
            (added.length ? `Ajouté(s) : ${added.map(a => `\`${a}\``).join(', ')}\n` : '') +
            `Erreur(s) : ${errors.join(', ')}`, { timestamp: false, color: '#2b2d31' })] }).catch(() => null);
          if (errMsg) embed.scheduleDelete(errMsg, 3);
        }

        await panel.edit(buildPayload()).catch(() => {});
        return;
      }

      if (id === 'sa:remove') {
        await interaction.deferUpdate().catch(() => {});

        const allAliases = db.getCmdAliases(guildId);
        if (!allAliases.length) return;

        const grouped = {};
        for (const { alias, commandName } of allAliases) {
          if (!grouped[commandName]) grouped[commandName] = [];
          grouped[commandName].push(alias);
        }
        const cmdNames     = Object.keys(grouped).sort();
        const RM_PAGE_SIZE = 25;
        let rmPage         = 0;
        let rmSelectedCmd  = null;

        const buildRemovePayload = () => {
          const totalPages = Math.ceil(cmdNames.length / RM_PAGE_SIZE);
          const pageCmds   = cmdNames.slice(rmPage * RM_PAGE_SIZE, (rmPage + 1) * RM_PAGE_SIZE);

          const cmdOpts = pageCmds.map(n => ({
            label      : n,
            value      : n,
            default    : n === rmSelectedCmd,
            description: `${grouped[n].length} alias : ${grouped[n].slice(0, 3).join(', ')}${grouped[n].length > 3 ? '…' : ''}`,
          }));

          const rows = [
            new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId('sa:rm:selectCmd')
                .setPlaceholder('◈ Choisir une commande')
                .addOptions(cmdOpts)
            ),
          ];

          if (rmSelectedCmd && grouped[rmSelectedCmd]) {
            const aliasOpts = grouped[rmSelectedCmd].map(a => ({ label: a, value: a }));
            rows.push(
              new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                  .setCustomId('sa:rm:selectAlias')
                  .setPlaceholder('◈ Alias à supprimer')
                  .setMinValues(1)
                  .setMaxValues(aliasOpts.length)
                  .addOptions(aliasOpts)
              )
            );
          }

          const navBtns = [];
          if (totalPages > 1) {
            navBtns.push(
              new ButtonBuilder().setCustomId('sa:rm:prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(rmPage === 0),
              new ButtonBuilder().setCustomId('sa:rm:next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(rmPage >= totalPages - 1),
            );
          }
          navBtns.push(new ButtonBuilder().setCustomId('sa:rm:cancel').setLabel('✖ Annuler').setStyle(ButtonStyle.Secondary));
          rows.push(new ActionRowBuilder().addComponents(...navBtns));

          const headerText =
            `## ◈ Supprimer un alias` +
            (totalPages > 1 ? ` ・ Page ${rmPage + 1}/${totalPages}` : '') +
            `\n*Sélectionne la commande puis les alias à retirer.*`;

          if (V2_AVAILABLE) {
            try {
              const accent    = _hexToInt(embed.getGuildColor(guildId));
              const container = new ContainerBuilder().setAccentColor(accent);
              container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));
              container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
              for (const row of rows) container.addActionRowComponents(row);
              return { embeds: [], components: [container], flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] } };
            } catch {}
          }
          return {
            embeds: [embed.build(guildId, null, { title: '◈ Supprimer un alias', description: headerText.replace(/^## ◈ Supprimer un alias[^\n]*\n/, ''), timestamp: false })],
            components: rows, allowedMentions: { parse: [] },
          };
        };

        await panel.edit(buildRemovePayload()).catch(() => {});

        const rmCollector = panel.createMessageComponentCollector({
          filter : i => i.user.id === message.author.id && i.message.id === panel.id,
          idle   : 60_000,
          time   : 120_000,
        });

        rmCollector.on('collect', async rmI => {
          const rid = rmI.customId;
          if (rid === 'sa:rm:cancel') {
            await rmI.deferUpdate().catch(() => {});
            rmCollector.stop('done');
            return;
          }
          if (rid === 'sa:rm:prev') {
            rmPage = Math.max(0, rmPage - 1);
            await rmI.deferUpdate().catch(() => {});
            await panel.edit(buildRemovePayload()).catch(() => {});
            return;
          }
          if (rid === 'sa:rm:next') {
            rmPage = Math.min(Math.ceil(cmdNames.length / RM_PAGE_SIZE) - 1, rmPage + 1);
            await rmI.deferUpdate().catch(() => {});
            await panel.edit(buildRemovePayload()).catch(() => {});
            return;
          }
          if (rid === 'sa:rm:selectCmd') {
            rmSelectedCmd = rmI.values[0];
            await rmI.deferUpdate().catch(() => {});
            await panel.edit(buildRemovePayload()).catch(() => {});
            return;
          }
          if (rid === 'sa:rm:selectAlias') {
            await rmI.deferUpdate().catch(() => {});
            for (const alias of rmI.values) db.removeCmdAlias(guildId, alias);
            rmCollector.stop('done');
            return;
          }
        });

        rmCollector.on('end', async () => {
          await panel.edit(buildPayload()).catch(() => {});
        });

        return;
      }
    });

    collector.on('end', (_, reason) => {
      embed.clearPrivateInteraction(panel);
      if (reason === 'closed') {
        panel.delete().catch(() => {});
        if (!deleteCmd) message.delete().catch(() => {});
        return;
      }
      panel.edit({ components: [] }).catch(() => {});
      if (deleteReply) embed.scheduleDelete(panel, deleteDelay);
    });
  },
};

function _getCommandList(client) {
  const names = new Set();
  for (const [key, cmd] of client.commands.entries()) {
    if (cmd.help?.name === key) names.add(key);
  }
  return [...names].sort();
}

function _getNativeAliases(client, commandName) {
  const aliases = [];
  for (const [key, cmd] of client.commands.entries()) {
    if (cmd.help?.name === commandName && key !== commandName) aliases.push(key);
  }
  return aliases;
}

function _hexToInt(hex) {
  const cleaned = String(hex || '').replace('#', '');
  const n = parseInt(cleaned, 16);
  return Number.isNaN(n) ? 0x2f3136 : n;
}
