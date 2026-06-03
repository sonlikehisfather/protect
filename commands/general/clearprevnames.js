'use strict';

const {
  ComponentType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MessageFlags,
} = require('discord.js');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE = !!(  
  COMPONENTS_V2_FLAG &&
  typeof ContainerBuilder    === 'function' &&
  typeof TextDisplayBuilder  === 'function' &&
  typeof SeparatorBuilder    === 'function'
);

const db    = require('../../core/database');
const embed = require('../../utils/embed');
const perms = require('../../utils/permissions');

module.exports = {
  help: {
    name        : 'clearprevnames',
    description : "Supprime l'historique des pseudos d'un membre.",
    usage       : 'clearprevnames <membre/id/nom>',
    aliases     : ['clearpn', 'resetprevnames'],
    category    : 'general',
  },

  async run(client, message, args) {
    const guild   = message.guild;
    const guildId = guild.id;

    if (!perms.check(message, 'clearprevnames')) return;

    const config      = db.getGuildConfig(guildId);
    const deleteCmd   = Boolean(config?.autoDeleteModCmds);
    const deleteReply = Boolean(config?.autoDeleteModReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) await message.delete().catch(() => {});

    const target = await resolveUser(client, message, args);

    if (!target) {
      const sent = await embed.replyError(message, 'Utilisateur introuvable.', { timestamp: false }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('cpn:confirm')
        .setLabel('Confirmer')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('cpn:cancel')
        .setLabel('Annuler')
        .setStyle(ButtonStyle.Secondary),
    );

    const confirmPayload = V2_AVAILABLE
      ? {
          flags      : COMPONENTS_V2_FLAG,
          components : [
            new ContainerBuilder()
              .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## Supprimer l'historique des pseudos de <@${target.id}> ?`),
              )
              .addSeparatorComponents(new SeparatorBuilder())
              .addTextDisplayComponents(
                new TextDisplayBuilder().setContent('Cette action est irréversible.'),
              )
              .addActionRowComponents(confirmRow),
          ],
          embeds     : [],
          allowedMentions: { parse: [] },
        }
      : {
          embeds: [embed.build(guildId, `Supprimer l'historique des pseudos de <@${target.id}> ?`, { timestamp: false })],
          components: [confirmRow],
          allowedMentions: { parse: [] },
        };

    const confirmMsg = await message.channel.send(confirmPayload).catch(() => null);

    if (!confirmMsg) return;

    try {
      const interaction = await confirmMsg.awaitMessageComponent({
        componentType : ComponentType.Button,
        filter        : i => {
          if (i.user.id !== message.author.id) {
            i.deferUpdate().catch(() => {});
            return false;
          }
          return true;
        },
        time: 30_000,
      });

      await interaction.deferUpdate().catch(() => {});

      if (interaction.customId === 'cpn:confirm') {
        db.clearPrevNames(target.id, guildId);

        const donePayload = V2_AVAILABLE
          ? {
              flags      : COMPONENTS_V2_FLAG,
              components : [
                new ContainerBuilder()
                  .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`Historique des pseudos de <@${target.id}> supprimé.`),
                  ),
              ],
              embeds: [],
            }
          : {
              embeds: [embed.build(guildId, `Historique des pseudos de <@${target.id}> supprimé.`, { timestamp: false })],
              components: [],
            };

        await confirmMsg.edit(donePayload).catch(() => {});
      } else {
        const cancelPayload = V2_AVAILABLE
          ? {
              flags      : COMPONENTS_V2_FLAG,
              components : [
                new ContainerBuilder()
                  .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('Annulé.'),
                  ),
              ],
              embeds: [],
            }
          : {
              embeds: [embed.build(guildId, 'Annulé.', { timestamp: false })],
              components: [],
            };

        await confirmMsg.edit(cancelPayload).catch(() => {});
      }
    } catch {
      await confirmMsg.edit({ components: [] }).catch(() => {});
    }

    if (deleteReply) embed.scheduleDelete(confirmMsg, deleteDelay);
  },
};

async function resolveUser(client, message, args) {
  if (message.reference?.messageId) {
    const replied = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
    if (replied?.author) return replied.author;
  }

  const mention = message.mentions.users.first();
  if (mention) return mention;

  const raw = args.join(' ').trim();
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

  member = message.guild.members.cache.find(m =>
    m.user.username.toLowerCase().includes(lowered) ||
    (m.user.globalName && m.user.globalName.toLowerCase().includes(lowered)) ||
    m.displayName.toLowerCase().includes(lowered)
  );
  if (member) return member.user;

  const fetched = await message.guild.members.fetch().catch(() => null);
  if (fetched) {
    member = fetched.find(m =>
      m.user.username.toLowerCase() === lowered ||
      (m.user.globalName && m.user.globalName.toLowerCase() === lowered) ||
      m.displayName.toLowerCase() === lowered
    );
    if (member) return member.user;

    member = fetched.find(m =>
      m.user.username.toLowerCase().includes(lowered) ||
      (m.user.globalName && m.user.globalName.toLowerCase().includes(lowered)) ||
      m.displayName.toLowerCase().includes(lowered)
    );
    if (member) return member.user;
  }

  return null;
}
