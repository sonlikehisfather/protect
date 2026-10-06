'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
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
const IDLE_MS    = 300_000;
const TIMEOUT_MS = 900_000;

module.exports = {
  help: {
    name        : 'embedmode',
    description : 'Configurer le mode d\'affichage des embeds (V1, V2, Auto) avec exceptions par commande.',
    usage       : 'embedmode',
    aliases     : ['emmode', 'emode'],
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

    let mode = config?.embedMode || 'auto';
    let exceptions = [];
    if (config?.embedModeExceptions) {
      try { exceptions = JSON.parse(config.embedModeExceptions); } catch {}
    }

    let view = 'main';
    let busy = false;

    const allCommands = [];
    for (const [key, cmd] of client.commands.entries()) {
      const name = cmd?.help?.name;
      if (name && !allCommands.includes(name)) allCommands.push(name);
    }
    allCommands.sort();

    /* ── Helpers ────────────────────────────────────────────── */

    function _save() {
      db.setGuildConfig(guildId, 'embedMode', mode);
      db.setGuildConfig(guildId, 'embedModeExceptions', JSON.stringify(exceptions));
    }

    function _modeLabel(m) {
      if (m === 'v2') return 'Components V2';
      if (m === 'v1') return 'Embed classique (V1)';
      return 'Auto (détecté automatiquement)';
    }

    function _modeIcon(m) {
      if (m === 'v2') return '\u25C8';
      if (m === 'v1') return '\u25C6';
      return '\u25C7';
    }

    /* ── Panel builder ──────────────────────────────────────── */

    function _buildPanel() {
      const container = new ContainerBuilder();

      if (view === 'exceptions') {
        const lines = [
          '## Exceptions',
          '',
          'Commandes qui **bypass** le mode `' + mode + '` actuel.',
          '',
        ];

        if (exceptions.length) {
          for (const ex of exceptions) {
            lines.push('- `' + ex + '`');
          }
        } else {
          lines.push('*Aucune exception.*');
        }

        lines.push('', '-# Ajoute ou retire des commandes via le menu ci-dessous');
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

        const selectOptions = allCommands.slice(0, 25).map(cmdName => ({
          label      : cmdName.slice(0, 100),
          value      : cmdName,
          description: (exceptions.includes(cmdName) ? 'Exception active' : 'Clique pour basculer').slice(0, 100),
          default    : exceptions.includes(cmdName),
        }));

        container.addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('em:excselect')
              .setPlaceholder('Sélectionner des commandes...')
              .setMinValues(0)
              .setMaxValues(Math.min(selectOptions.length, 25))
              .addOptions(selectOptions),
          )
        );

        container.addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('em:back').setLabel('Retour').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('em:clearexc').setLabel('Tout effacer').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('em:close').setLabel('\u2716').setStyle(ButtonStyle.Secondary),
          )
        );

        return {
          components      : [container],
          flags           : COMPONENTS_V2_FLAG,
          allowedMentions : { parse: [] },
        };
      }

      const lines = [
        '## Mode d\'affichage des embeds',
        '',
        '**Mode actuel** › ' + _modeIcon(mode) + ' ' + _modeLabel(mode),
        '',
        '**Exceptions** › ' + exceptions.length + ' commande(s)',
        '',
        '-# Choisis un mode ou gère les exceptions',
      ];
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
      container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('em:auto')
            .setLabel('Auto')
            .setStyle(mode === 'auto' ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(mode === 'auto'),
          new ButtonBuilder()
            .setCustomId('em:v1')
            .setLabel('V1')
            .setStyle(mode === 'v1' ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(mode === 'v1'),
          new ButtonBuilder()
            .setCustomId('em:v2')
            .setLabel('V2')
            .setStyle(mode === 'v2' ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(mode === 'v2'),
        )
      );

      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('em:exceptions').setLabel('Exceptions').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('em:close').setLabel('\u2716').setStyle(ButtonStyle.Danger),
        )
      );

      return {
        components      : [container],
        flags           : COMPONENTS_V2_FLAG,
        allowedMentions : { parse: [] },
      };
    }

    const _w = (p) => embed.wrapPayload(guildId, p, 'embedmode');

    /* ── Send panel ──────────────────────────────────────────── */

    let panel = await message.channel.send(_w(_buildPanel())).catch(() => null);
    if (!panel) return;

    let collector;

    function _attachCollector(p) {
      embed.registerPrivateInteraction(p, message.author.id, TIMEOUT_MS);
      const col = p.createMessageComponentCollector({
        filter: i => i.user.id === message.author.id,
        idle: IDLE_MS,
        time: TIMEOUT_MS,
      });

      col.on('collect', async (i) => {
        const id = i.customId;

        if (busy) {
          await i.deferUpdate().catch(() => {});
          return;
        }

        /* ── Close ── */
        if (id === 'em:close') {
          col.stop('closed');
          await i.deferUpdate().catch(() => {});
          p.delete().catch(() => {});
          message.delete().catch(() => {});
          return;
        }

        /* ── Back ── */
        if (id === 'em:back') {
          view = 'main';
          await i.deferUpdate().catch(() => {});
          await p.edit(_w(_buildPanel())).catch(() => {});
          return;
        }

        /* ── Mode selection ── */
        if (id === 'em:auto' || id === 'em:v1' || id === 'em:v2') {
          const newMode = id.slice(3);
          if (mode === newMode) {
            await i.deferUpdate().catch(() => {});
            return;
          }
          mode = newMode;
          _save();
          await i.deferUpdate().catch(() => {});
          const newPanel = await message.channel.send(_w(_buildPanel())).catch(() => null);
          if (newPanel) {
            embed.clearPrivateInteraction(p);
            p.delete().catch(() => {});
            panel = newPanel;
            col.stop('replaced');
            _attachCollector(newPanel);
          } else {
            await p.edit(_w(_buildPanel())).catch(() => {});
          }
          return;
        }

        /* ── Go to exceptions view ── */
        if (id === 'em:exceptions') {
          view = 'exceptions';
          await i.deferUpdate().catch(() => {});
          await p.edit(_w(_buildPanel())).catch(() => {});
          return;
        }

        /* ── Clear exceptions ── */
        if (id === 'em:clearexc') {
          exceptions = [];
          _save();
          await i.deferUpdate().catch(() => {});
          await p.edit(_w(_buildPanel())).catch(() => {});
          return;
        }

        /* ── Exception select menu ── */
        if (id === 'em:excselect') {
          const selected = i.values || [];
          exceptions = selected.slice(0, 50);
          _save();
          await i.deferUpdate().catch(() => {});
          await p.edit(_w(_buildPanel())).catch(() => {});
          return;
        }

        await i.deferUpdate().catch(() => {});
      });

      col.on('end', (_, reason) => {
        embed.clearPrivateInteraction(p);
        if (reason === 'closed' || reason === 'replaced') return;
        p.edit({ ..._w(_buildPanel()), embeds: [] }).catch(() => {});
      });

      return col;
    }

    collector = _attachCollector(panel);
  },
};
