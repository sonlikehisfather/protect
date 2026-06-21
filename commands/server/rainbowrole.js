'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');

const db = require('../../core/database');
const embed = require('../../utils/embed');

function _hexToInt(hex) {
  if (!hex) return 0x2B2D31;
  try {
    return parseInt(hex.replace('#', ''), 16);
  } catch (e) {
    return 0x2B2D31;
  }
}

function _hexToHsl(hex) {
  const normalized = hex.replace('#', '');
  const r = parseInt(normalized.slice(0, 2), 16) / 255;
  const g = parseInt(normalized.slice(2, 4), 16) / 255;
  const b = parseInt(normalized.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }

  return { h, s: s * 100, l: l * 100 };
}

function _hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
}

function _getNextRainbowColor(previous = null, mode = 'rainbow', paletteSize = 7) {
  const normalizedMode = ['rainbow', 'gradient', 'base'].includes(mode) ? mode : 'base';

  const previousHsl = previous ? _hexToHsl(previous) : { h: Math.floor(Math.random() * 360), s: 75, l: 55 };
  const direction = Math.random() < 0.5 ? -1 : 1;
  const hueShiftMin = 90;
  const hueShiftMax = 180;
  const hueShift = hueShiftMin + Math.random() * (hueShiftMax - hueShiftMin);
  const hue = (previousHsl.h + hueShift * direction + 360) % 360;

  if (normalizedMode === 'base') {
    const saturation = 40 + Math.random() * 45;
    const light = 20 + Math.random() * 55;
    return _hslToHex(hue, saturation, light);
  }

  if (normalizedMode === 'gradient') {
    const saturation = Math.max(55, Math.min(92, previousHsl.s + (Math.random() < 0.5 ? -1 : 1) * 8));
    const light = Math.max(30, Math.min(80, previousHsl.l + (Math.random() < 0.5 ? -1 : 1) * 8));
    return _hslToHex(hue, saturation, light);
  }

  const saturation = 45 + Math.random() * 40;
  const light = Math.max(20, Math.min(75, previousHsl.l + (Math.random() < 0.5 ? -1 : 1) * 12));

  return _hslToHex(hue, saturation, light);
}

function _getNextRainbowColors(previous = null, mode = 'rainbow', paletteSize = 7) {
  const normalizedMode = ['rainbow', 'gradient', 'base'].includes(mode) ? mode : 'base';
  const primary = _getNextRainbowColor(previous, normalizedMode, paletteSize);

  if (normalizedMode === 'gradient') {
    const primaryHsl = _hexToHsl(primary);
    const hueShift = 120 + Math.random() * 60;
    const secondaryHue = (primaryHsl.h + hueShift + 360) % 360;
    const saturation = Math.max(55, Math.min(92, primaryHsl.s + (Math.random() < 0.5 ? -1 : 1) * 10));
    const light = Math.max(35, Math.min(75, primaryHsl.l + (Math.random() < 0.5 ? -1 : 1) * 10));
    const secondary = _hslToHex(secondaryHue, saturation, light);
    return [primary, secondary];
  }

  return [primary];
}

async function _applyImmediateRainbowRole(guild, row) {
  if (!guild || !row || !row.roleId) return;

  const role = guild.roles.cache.get(row.roleId);
  if (!role) return;

  const botMember = guild.members?.me ?? await guild.members.fetchMe().catch(() => null);
  const botRolePosition = botMember?.roles?.highest?.position ?? null;
  const rolePosition = role.position;
  const editableDetails = {
    editable: role.editable,
    managed: role.managed,
    position: rolePosition,
    botRolePosition,
    botCanManageRoles: botMember?.permissions?.has?.('ManageRoles') ?? null,
    botMemberCached: Boolean(guild.members?.me),
    botMemberFetched: Boolean(botMember),
  };

  if (!role.editable) {
    db.updateRainbowRole(guild.id, row.roleId, { active: 0 });
    return { error: 'not_editable' };
  }

  const previousColor = row.color || (role.color ? `#${role.color.toString(16).padStart(6, '0')}` : null);
  const nextColors = _getNextRainbowColors(previousColor, row.mode, row.paletteSize);
  const nextColor = nextColors[0];
  const nextRun = new Date(Date.now() + (Number(row.interval) || 60) * 1000).toISOString();

  const toInt = (c) => typeof c === 'string' ? Number(`0x${c.replace('#', '')}`) : c;
  const colorsObj = {
    primaryColor: toInt(nextColors[0]),
    secondaryColor: nextColors[1] !== undefined ? toInt(nextColors[1]) : undefined,
  };

  try {
    await role.edit({ colors: colorsObj, reason: 'Rainbow role immediate update' });
    db.updateRainbowRole(guild.id, row.roleId, {
      nextRun,
      color: nextColor,
    });
  } catch (err) {
    if (err?.code === 50013) {
      db.updateRainbowRole(guild.id, row.roleId, { active: 0 });
      return { error: 'missing_permissions' };
    }
    console.error('[rainbowrole] immediate update failed:', err?.message || err);
    return { error: 'unknown' };
  }
}

function _resolveRole(guild, input) {
  if (!input) return null;
  const mention = input.match(/^<@&?(\d+)>$/);
  if (mention) {
    return guild.roles.cache.get(mention[1]) || null;
  }

  if (/^\d+$/.test(input)) {
    return guild.roles.cache.get(input) || null;
  }

  return guild.roles.cache.find((role) => role.name.toLowerCase() === input.toLowerCase()) || null;
}

function _formatRole(row, guild) {
  const role = guild.roles.cache.get(row.roleId);
  const roleName = role ? `**${role.name}**` : `**Rôle supprimé**`;
  const status = row.active ? '[ACTIF]' : '[DESACTIVÉ]';
  return `${roleName} • ${status} • \`${row.interval}s\``;
}

module.exports = {
  help: {
    name        : 'rainbowrole',
    description : 'Configure un rôle change de couleur automatiquement.',
    usage       : 'rainbowrole ',
    aliases     : ['rainbow'],
    category    : 'server',
  },

  async run(client, message, args) {
    const guildId = message.guild.id;
    const guild = message.guild;
    const config = db.getGuildConfig(guildId);
    const deleteCmd = Boolean(config?.autoDeleteInfoCmds);
    const deleteReply = Boolean(config?.autoDeleteInfoReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const state = {
      selectedRoleId: null,
      view: 'main',
    };

    const intervalOptions = [10, 15, 30, 60, 120, 300];
    const modeOptions = [
      { value: 'rainbow', label: '◈ Arc-en-ciel', description: 'Couleurs vives qui changent radicalement' },
      { value: 'gradient', label: '◑ Dégradé', description: 'Deux couleurs complémentaires en transition' },
      { value: 'base', label: '◉ Solide', description: 'Une couleur unie et saturée' },
    ];

    const buildPayload = (disabled = false) => {
      const entries = db.getRainbowRoles(guildId);
      const selectedRoleExists = state.selectedRoleId && entries.some(e => e.roleId === state.selectedRoleId);
      if (!selectedRoleExists && entries.length) {
        state.selectedRoleId = entries[0].roleId;
      }

      const selectedRow = state.selectedRoleId ? entries.find((row) => row.roleId === state.selectedRoleId) : null;
      const selectedRole = state.selectedRoleId ? guild.roles.cache.get(state.selectedRoleId) : null;
      const lines = [];

      if (!entries.length) {
        lines.push('-# Aucun rôle configuré pour le moment.');
        lines.push('-# Sélectionnez un rôle ci-dessous pour commencer.');
      } else {
        for (const row of entries) {
          const isSelected = row.roleId === state.selectedRoleId;
          const role = guild.roles.cache.get(row.roleId);
          const roleName = role ? `<@&${row.roleId}>` : `*(rôle supprimé)*`;
          const statusDot = row.active ? '◆' : '◇';
          const modeLbl = modeOptions.find((m) => m.value === row.mode)?.label || row.mode;
          const arrow = isSelected ? '**»**' : '\u00a0\u00a0';
          lines.push(`${arrow} ${statusDot} ${roleName} ・ ${modeLbl} ・ \`${row.interval}s\``);
        }
      }

      const details = [];
      if (selectedRole) {
        details.push(`### ${selectedRole}`);
        if (selectedRow) {
          const stateIcon = selectedRow.active ? '◆ **Actif**' : '◇ **Désactivé**';
          const modeLbl = modeOptions.find((m) => m.value === selectedRow.mode)?.label || selectedRow.mode;
          const colorPreview = selectedRow.color ? `\`${selectedRow.color}\`` : '`・`';
          details.push('');
          details.push(`${stateIcon}`);
          details.push(`› Intervalle : \`${selectedRow.interval}s\``);
          details.push(`› Style : ${modeLbl}`);
          details.push(`› Dernière couleur : ${colorPreview}`);
        } else {
          details.push('');
          details.push('-# Nouveau rôle ・ configurez l\'intervalle et le style ci-dessous,');
          details.push('-# puis cliquez sur **Enregistrer**.');
        }
      } else {
        details.push('### Aucun rôle sélectionné');
        details.push('-# Utilisez le menu ci-dessous pour choisir un rôle à configurer.');
      }

      const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('rr:select')
        .setPlaceholder('» Sélectionner un rôle à configurer')
        .setMinValues(1)
        .setMaxValues(1);

      const intervalSelect = new StringSelectMenuBuilder()
        .setCustomId('rr:setInterval')
        .setPlaceholder('» Intervalle de changement')
        .setMinValues(1)
        .setMaxValues(1)
        .setDisabled(!selectedRole);

      intervalSelect.addOptions(
        intervalOptions.map((seconds) => ({
          label: seconds < 60 ? `${seconds} secondes` : `${seconds / 60} minute${seconds / 60 > 1 ? 's' : ''}`,
          value: String(seconds),
          description: `Changer la couleur toutes les ${seconds}s`,
          default: selectedRow?.interval === seconds,
        }))
      );

      const modeSelect = new StringSelectMenuBuilder()
        .setCustomId('rr:setMode')
        .setPlaceholder('» Style de couleur')
        .setMinValues(1)
        .setMaxValues(1)
        .setDisabled(!selectedRole);

      modeSelect.addOptions(
        modeOptions.map((option) => ({
          label: option.label,
          value: option.value,
          description: option.description,
          default: selectedRow?.mode === option.value,
        }))
      );


      const accent = _hexToInt(embed.getGuildColor(guildId));
      const headerLines = entries.length
        ? [`## ◈ Rainbow Role ・ ${entries.length} rôle${entries.length > 1 ? 's' : ''} configuré${entries.length > 1 ? 's' : ''}`, '', ...lines]
        : ['## ◈ Rainbow Role', '', ...lines];

      const container = new ContainerBuilder().setAccentColor(accent)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerLines.join('\n')))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(['### ◈ Configuration', '', ...details].join('\n')))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(new ActionRowBuilder().addComponents(roleSelect))
        .addActionRowComponents(new ActionRowBuilder().addComponents(intervalSelect))
        .addActionRowComponents(new ActionRowBuilder().addComponents(modeSelect))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('rr:save')
              .setLabel('» Enregistrer')
              .setStyle(ButtonStyle.Success)
              .setDisabled(disabled || !selectedRole),
            new ButtonBuilder()
              .setCustomId('rr:toggle')
              .setLabel(selectedRow?.active ? '◇ Désactiver' : '◆ Activer')
              .setStyle(selectedRow?.active ? ButtonStyle.Secondary : ButtonStyle.Primary)
              .setDisabled(disabled || !selectedRole),
            new ButtonBuilder()
              .setCustomId('rr:remove')
              .setLabel('× Supprimer')
              .setStyle(ButtonStyle.Danger)
              .setDisabled(disabled || !selectedRow),
            new ButtonBuilder()
              .setCustomId('rr:refresh')
              .setLabel('↺')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(disabled),
          )
        )
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('rr:list')
              .setLabel('☰ Liste')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(disabled),
            new ButtonBuilder()
              .setCustomId('rr:close')
              .setLabel('× Fermer')
              .setStyle(ButtonStyle.Danger)
              .setDisabled(disabled),
          )
        );

      

      if (state.view === 'list') {
        const listContainer = new ContainerBuilder().setAccentColor(accent)
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(['## Configuration Rainbow Role', '', ...lines].join('\n')))
          .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

        let all = [];
        if (typeof db.getRainbowRoles === 'function') {
          all = db.getRainbowRoles(guildId) || [];
        } else if (db._db) {
          try {
            all = db._db.prepare('SELECT * FROM rainbow_roles WHERE guildId = ?').all(guildId) || [];
          } catch (e) {
            all = [];
          }
        }

        const options = all.map(r => {
          const role = guild.roles.cache.get(r.roleId);
          const roleLabel = role ? role.name : `Rôle ${r.roleId}`;
          return { label: roleLabel.slice(0, 100), value: r.roleId };
        });

        const listDisplay = all.map(r => {
          const role = guild.roles.cache.get(r.roleId);
          const roleName = role ? `**${role.name}**` : `**Rôle ${r.roleId}**`;
          const status = r.active ? '[ACTIF]' : '[DESACTIVÉ]';
          return `${roleName}\n  └ mode: \`${r.mode}\` • intervalle: \`${r.interval}s\` • ${status}`;
        });

        const selectOptions = options.slice(0, 25);
        if (selectOptions.length) {
          listContainer.addActionRowComponents(
            new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId('rr:listSelect')
                .setPlaceholder('Sélectionner un config...')
                .addOptions(selectOptions)
                .setMinValues(1)
                .setMaxValues(1)
            )
          );
        } else {
          listContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent('\nAucune configuration enregistrée.'));
        }

        listContainer.addActionRowComponents(new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('rr:listEdit').setLabel('Éditer').setStyle(ButtonStyle.Primary).setDisabled(!options.length),
          new ButtonBuilder().setCustomId('rr:listRemove').setLabel('Supprimer').setStyle(ButtonStyle.Danger).setDisabled(!options.length),
          new ButtonBuilder().setCustomId('rr:back').setLabel('Retour').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('rr:close').setLabel('✖').setStyle(ButtonStyle.Danger)
        ));

        return {
          components: [listContainer],
          flags: MessageFlags.IsComponentsV2,
          allowedMentions: { parse: [] },
        };
      }

      return {
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      };
    };

    const action = args[0]?.toLowerCase();

    if (!action || action === 'list' || action === 'help') {
      let sent = null;
      try {
        sent = await message.reply(buildPayload());
      } catch (err) {
        console.error('[rainbowrole] failed to send reply:', err?.message || err);
        sent = null;
      }

      if (!sent) return;

      embed.registerPrivateInteraction(sent, message.author.id);

      const collector = sent.createMessageComponentCollector({
        filter: i => i.user.id === message.author.id,
        idle: 300_000,
        time: 900_000,
      });
      collector.on('collect', async (interaction) => {
        try {
          if (interaction.isStringSelectMenu() || interaction.isRoleSelectMenu()) {
            const selectedRoleId = state.selectedRoleId;
            const current = selectedRoleId ? db.getRainbowRole(guildId, selectedRoleId) : null;

            if (interaction.customId === 'rr:select') {
              state.selectedRoleId = interaction.values[0];
              await interaction.deferUpdate().catch(() => {});
              try {
                await sent.edit(buildPayload());
              } catch (e) {
                console.error('[rainbowrole] failed to edit after rr:select', e?.message || e);
              }
              return;
            }

            if (interaction.customId === 'rr:setInterval') {
              const seconds = Number(interaction.values[0]);
              if (Number.isInteger(seconds) && seconds >= 10 && state.selectedRoleId) {
                db.setRainbowRole(guildId, state.selectedRoleId, {
                  mode: current?.mode ?? 'rainbow',
                  paletteSize: current?.paletteSize ?? 7,
                  active: current?.active ?? true,
                  interval: seconds,
                  nextRun: new Date(Date.now() + seconds * 1000).toISOString(),
                });
              }
              await interaction.deferUpdate().catch(() => {});
              try {
                await sent.edit(buildPayload());
              } catch (e) {
                console.error('[rainbowrole] failed to edit after rr:setInterval', e?.message || e);
              }
              return;
            }

            if (interaction.customId === 'rr:setMode') {
              const mode = interaction.values[0];
              if (state.selectedRoleId) {
                const row = db.setRainbowRole(guildId, state.selectedRoleId, {
                  mode,
                  paletteSize: current?.paletteSize ?? 7,
                  active: current?.active ?? true,
                  interval: current?.interval ?? 60,
                  nextRun: new Date(Date.now() + (current?.interval ?? 60) * 1000).toISOString(),
                });
                if (row && row.active) {
                  await _applyImmediateRainbowRole(guild, row);
                }
              }
              await interaction.deferUpdate().catch(() => {});
              try {
                await sent.edit(buildPayload());
              } catch (e) {
                console.error('[rainbowrole] failed to edit after rr:setMode', e?.message || e);
              }
              return;
            }
          }

          if (interaction.customId === 'rr:save') {
            await interaction.deferUpdate().catch(() => {});
            const sel = state.selectedRoleId;
            if (sel) {
              const cur = db.getRainbowRole(guildId, sel) || {};
              const row = db.setRainbowRole(guildId, sel, {
                mode: cur.mode ?? 'rainbow',
                paletteSize: cur.paletteSize ?? 7,
                active: cur.active ?? 1,
                interval: cur.interval ?? 60,
                nextRun: new Date(Date.now() + (cur.interval ?? 60) * 1000).toISOString(),
              });
              if (row && row.active) {
                await _applyImmediateRainbowRole(guild, row);
              }
            }
            try {
              await sent.edit(buildPayload());
            } catch (e) {
              console.error('[rainbowrole] failed to edit after rr:save', e?.message || e);
            }
            return;
          }

          if (interaction.customId === 'rr:list') {
            await interaction.deferUpdate().catch(() => {});
            state.view = 'list';
            try {
              await sent.edit(buildPayload());
            } catch (e) {
              console.error('[rainbowrole] failed to switch to list view', e?.message || e);
            }
            return;
          }

          if (interaction.customId === 'rr:listSelect') {
            if (interaction.isStringSelectMenu()) {
              const val = interaction.values[0];
              state.selectedRoleId = val;
              state.view = 'main';
            }
            await interaction.deferUpdate().catch(() => {});
            try {
              await sent.edit(buildPayload());
            } catch (e) {
              console.error('[rainbowrole] failed to edit after rr:listSelect', e?.message || e);
            }
            return;
          }

          if (interaction.customId === 'rr:listRemove') {
            await interaction.deferUpdate().catch(() => {});
            const sel = state.selectedRoleId;
            if (sel && typeof db.removeRainbowRole === 'function') {
              db.removeRainbowRole(guildId, sel);
              state.selectedRoleId = null;
            } else if (sel && db._db) {
              try {
                db._db.prepare('DELETE FROM rainbow_roles WHERE guildId = ? AND roleId = ?').run(guildId, sel);
                state.selectedRoleId = null;
              } catch (e) {}
            }
            try {
              await sent.edit(buildPayload());
            } catch (e) {
              console.error('[rainbowrole] failed to edit after rr:listRemove', e?.message || e);
            }
            return;
          }

          if (interaction.customId === 'rr:listEdit') {
            await interaction.deferUpdate().catch(() => {});
            state.view = 'main';
            try {
              await sent.edit(buildPayload());
            } catch (e) {
              console.error('[rainbowrole] failed to edit after rr:listEdit', e?.message || e);
            }
            return;
          }

          if (interaction.customId === 'rr:back') {
            await interaction.deferUpdate().catch(() => {});
            state.view = 'main';
            try {
              await sent.edit(buildPayload());
            } catch (e) {
              console.error('[rainbowrole] failed to edit after rr:back', e?.message || e);
            }
            return;
          }

          if (interaction.customId === 'rr:close') {
            await interaction.deferUpdate().catch(() => {});
            embed.clearPrivateInteraction(sent);
            collector.stop('closed');
            await Promise.all([
              sent.delete().catch(() => {}),
              message.delete().catch(() => {}),
            ]);
            return;
          }

          if (interaction.customId === 'rr:refresh') {
            await interaction.deferUpdate().catch(() => {});
            try {
              await sent.edit(buildPayload());
            } catch (e) {
              console.error('[rainbowrole] failed to edit after rr:refresh', e?.message || e);
            }
            return;
          }

          if (interaction.customId === 'rr:toggle') {
            await interaction.deferUpdate().catch(() => {});
            const selectedRoleId = state.selectedRoleId;
            if (selectedRoleId) {
              const current = db.getRainbowRole(guildId, selectedRoleId);
              const active = current ? !Boolean(current.active) : true;
              const row = db.setRainbowRole(guildId, selectedRoleId, {
                active,
                interval: current?.interval ?? 60,
                mode: current?.mode ?? 'rainbow',
                paletteSize: current?.paletteSize ?? 7,
                nextRun: new Date(Date.now() + (current?.interval ?? 60) * 1000).toISOString(),
              });
              if (row && row.active) {
                const applyResult = await _applyImmediateRainbowRole(guild, row);
                if (applyResult?.error) {
                  const errMsg = applyResult.error === 'missing_permissions' || applyResult.error === 'not_editable'
                    ? '‼ Permissions insuffisantes ・ le bot ne peut pas modifier ce rôle (hiérarchie ou permissions manquantes).'
                    : '‼ Erreur lors de l\'application de la couleur.';
                  await interaction.followUp({ content: errMsg, flags: 64 }).catch(() => {});
                }
              }
            }
            try {
              await sent.edit(buildPayload());
            } catch (e) {
              console.error('[rainbowrole] failed to edit after rr:toggle', e?.message || e);
            }
            return;
          }

          if (interaction.customId === 'rr:remove') {
            await interaction.deferUpdate().catch(() => {});
            const selectedRoleId = state.selectedRoleId;
            if (selectedRoleId) {
              db.removeRainbowRole(guildId, selectedRoleId);
              state.selectedRoleId = null;
            }
            try {
              await sent.edit(buildPayload());
            } catch (e) {
              console.error('[rainbowrole] failed to edit after rr:remove', e?.message || e);
            }
            return;
          }
        } catch (err) {
          if (err?.code !== 10062 && err?.code !== 40060) {
            console.error('[rainbowrole] interaction error:', err.message);
          }
        }
      });

      collector.on('end', (_, reason) => {
        embed.clearPrivateInteraction(sent);
        if (reason === 'closed') return;
        sent.edit(buildPayload(true)).catch(() => {});
      });

      if (deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }

    if (['remove', 'delete', 'off', 'disable'].includes(action)) {
      const roleArg = args[1];
      const role = _resolveRole(guild, roleArg);
      if (!role) {
        const sent = await embed.replyError(message, 'Rôle introuvable. Mentionnez un rôle valide.');
        if (deleteReply && sent) embed.scheduleDelete(sent, deleteDelay);
        return;
      }

      db.removeRainbowRole(guildId, role.id);
      const sent = await embed.reply(message, `Configuration arc-en-ciel supprimée pour ${role}.`);
      if (deleteReply && sent) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const role = _resolveRole(guild, args[0]);
    if (!role) {
      const sent = await embed.replyError(message, 'Rôle introuvable. Mentionnez un rôle valide.');
      if (deleteReply && sent) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const current = db.getRainbowRole(guildId, role.id);
    let active = true;
    let interval = current?.interval ?? 60;
    let messageText = null;

    if (args[1]) {
      const option = args[1].toLowerCase();
      if (option === 'on' || option === 'enable') {
        active = true;
      } else if (option === 'off' || option === 'disable') {
        active = false;
      } else {
        const parsed = Number(option);
        if (!Number.isInteger(parsed) || parsed < 10) {
          const sent = await embed.replyError(message, 'Intervalle invalide. Utilisez un nombre de secondes supérieur ou égal à 10.');
          if (deleteReply && sent) embed.scheduleDelete(sent, deleteDelay);
          return;
        }

        interval = parsed;
      }
    }

    let row;
    if (current) {
      row = db.updateRainbowRole(guildId, role.id, {
        active,
        interval,
        nextRun: new Date(Date.now() + interval * 1000).toISOString(),
      });
      messageText = `Configuration mise à jour pour ${role}.`;
    } else {
      row = db.setRainbowRole(guildId, role.id, {
        active,
        interval,
        nextRun: new Date(Date.now() + interval * 1000).toISOString(),
      });
      messageText = `Rôle arc-en-ciel activé pour ${role}.`;
    }

    if (active) {
      messageText += ` Changement de couleur toutes les ${interval} secondes.`;
    } else {
      messageText += ' Cette configuration est désactivée.';
    }

    let sent = null;
    try {
      console.log('[rainbowrole] sending confirmation reply:', messageText);
      sent = await embed.reply(message, messageText);
      console.log('[rainbowrole] confirmation sent id=', sent?.id);
    } catch (err) {
      console.error('[rainbowrole] failed to send confirmation:', err?.message || err);
      sent = null;
    }
    if (deleteReply && sent) embed.scheduleDelete(sent, deleteDelay);
  },
};
