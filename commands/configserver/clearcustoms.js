'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');
const TIMEOUTS = require('../../utils/interactionTimeouts');

const MAX_EMPTY_DISPLAY = 20;

module.exports = {
  help: {
    name        : 'clearcustoms',
    description : 'Supprime toutes les custom commands ou seulement les vides.',
    use         : 'clearcustoms [empty]',
    usage       : 'clearcustoms [empty]',
    aliases     : ['clearcc'],
    category    : 'configserver',
  },

  async run(client, message, args) {
    const guildId = message.guild.id;

    if (!perms.check(message, module.exports.help.name)) {
      return embed.replyError(
        message,
        "Vous n'avez pas la permission d'utiliser cette commande.",
        { timestamp: false }
      );
    }

    const config = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const sub = args[0]?.toLowerCase();

    if (sub === 'empty' || sub === 'vides') {
      return _handleEmpty(message, guildId, deleteReply, deleteDelay);
    }

    const count = db.countCustomCommands(guildId);

    if (count === 0) {
      const sent = await embed.reply(
        message,
        'Aucune custom command à supprimer.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('local:clearcc:confirm')
        .setLabel(`Supprimer ${count} commande(s)`)
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('local:clearcc:cancel')
        .setLabel('Annuler')
        .setStyle(ButtonStyle.Secondary)
    );

    const confirmMsg = await message.reply({
      embeds: [
        embed.build(
          guildId,
          `Supprimer **${count}** custom command(s) ? Cette action est irréversible.`,
          { timestamp: false }
        ),
      ],
      components      : [confirmRow],
      allowedMentions : { repliedUser: false, parse: [] },
    }).catch(() => null);

    if (!confirmMsg) return;

    embed.registerPrivateInteraction(confirmMsg, message.author.id, TIMEOUTS.CONFIRM_TIME_MS);

    try {
      const interaction = await confirmMsg.awaitMessageComponent({
        componentType : ComponentType.Button,
        filter        : i => i.user.id === message.author.id,
        time          : TIMEOUTS.CONFIRM_TIME_MS,
      });

      embed.clearPrivateInteraction(confirmMsg);

      if (interaction.customId === 'local:clearcc:confirm') {
        db.clearCustomCommands(guildId);

        await interaction.update({
          embeds     : [embed.build(guildId, `**${count}** custom command(s) supprimée(s).`, { timestamp: false })],
          components : [],
        }).catch(() => {});
      } else {
        await interaction.update({
          embeds     : [embed.build(guildId, 'Suppression annulée.', { timestamp: false })],
          components : [],
        }).catch(() => {});
      }
    } catch {
      embed.clearPrivateInteraction(confirmMsg);
      await confirmMsg.edit({ components: [] }).catch(() => {});
    }
  },
};


async function _handleEmpty(message, guildId, deleteReply, deleteDelay) {
  const customs = db.getAllCustomCommands(guildId);
  const empties = customs.filter(_isEmptyCustom);

  if (!empties.length) {
    const sent = await embed.reply(
      message,
      'Aucune custom command vide trouvée.',
      { timestamp: false }
    ).catch(() => null);

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
    return;
  }

  const names   = empties.map(c => `\`${c.name}\``).slice(0, MAX_EMPTY_DISPLAY);
  const extra   = empties.length > MAX_EMPTY_DISPLAY ? `\n...et ${empties.length - MAX_EMPTY_DISPLAY} autre(s).` : '';
  const listing = names.join(', ') + extra;

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('local:clearcc:confirmempty')
      .setLabel(`Supprimer ${empties.length} vide(s)`)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('local:clearcc:cancelempty')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary)
  );

  const confirmMsg = await message.reply({
    embeds: [
      embed.build(
        guildId,
        `**${empties.length}** custom command(s) vide(s) trouvée(s) :\n${listing}\n\nSupprimer ?`,
        { timestamp: false }
      ),
    ],
    components      : [confirmRow],
    allowedMentions : { repliedUser: false, parse: [] },
  }).catch(() => null);

  if (!confirmMsg) return;

  embed.registerPrivateInteraction(confirmMsg, message.author.id, TIMEOUTS.CONFIRM_TIME_MS);

  try {
    const interaction = await confirmMsg.awaitMessageComponent({
      componentType : ComponentType.Button,
      filter        : i => i.user.id === message.author.id,
      time          : TIMEOUTS.CONFIRM_TIME_MS,
    });

    embed.clearPrivateInteraction(confirmMsg);

    if (interaction.customId === 'local:clearcc:confirmempty') {
      let deleted = 0;

      for (const c of empties) {
        db.deleteCustomCommand(guildId, c.name);
        deleted++;
      }

      await interaction.update({
        embeds     : [embed.build(guildId, `**${deleted}** custom command(s) vide(s) supprimée(s).`, { timestamp: false })],
        components : [],
      }).catch(() => {});
    } else {
      await interaction.update({
        embeds     : [embed.build(guildId, 'Suppression annulée.', { timestamp: false })],
        components : [],
      }).catch(() => {});
    }
  } catch {
    embed.clearPrivateInteraction(confirmMsg);
    await confirmMsg.edit({ components: [] }).catch(() => {});
  }
}

function _isEmptyCustom(c) {
  if (c.response && c.response.trim()) return false;
  if (c.embedData && c.embedData.trim() && c.embedData !== '{}') return false;
  if (_hasJsonContent(c.buttonsJson)) return false;
  if (_hasJsonContent(c.reactionsJson)) return false;
  if (_hasJsonContent(c.rolesJson)) return false;
  if (c.requiredRoleId) return false;
  if (c.deniedRoleId) return false;
  if (c.cooldown && Number(c.cooldown) > 0) return false;
  if (c.dmResponse) return false;
  if (c.logEnabled) return false;
  return true;
}

function _hasJsonContent(json) {
  if (!json) return false;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}
