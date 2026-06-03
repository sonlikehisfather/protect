'use strict';

const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MessageFlags,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE = !!(
  COMPONENTS_V2_FLAG &&
  typeof ContainerBuilder   === 'function' &&
  typeof TextDisplayBuilder === 'function' &&
  typeof SeparatorBuilder   === 'function'
);

module.exports = {
  help: {
    name        : 'seen',
    description : "Affiche la dernière fois qu'un membre a écrit dans le serveur.",
    usage       : 'seen [membre/id/nom]',
    aliases     : ['lastseen', 'derniervu'],
    category    : 'general',
  },

  async run(client, message, args) {
    const guildId     = message.guild.id;
    const guildConfig = db.getGuildConfig(guildId);
    const deleteCmd   = Boolean(guildConfig?.autoDeleteInfoCmds);
    const deleteReply = Boolean(guildConfig?.autoDeleteInfoReplies);
    const deleteDelay = Number(guildConfig?.autoDeleteDelay ?? 5);

    if (deleteCmd) await message.delete().catch(() => {});

    const target = await resolveUser(client, message, args);

    if (!target) {
      const sent = await embed.replyError(message, 'Membre introuvable.', { timestamp: false }).catch(() => null);
      if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
      return;
    }

    const row       = db.getSeen(target.id, guildId);
    const fetchedUser = await client.users.fetch(target.id, { force: false }).catch(() => target);
    const displayName = fetchedUser.globalName
      ? `${fetchedUser.globalName} (@${fetchedUser.username})`
      : `@${fetchedUser.username}`;

    let sent;

    if (V2_AVAILABLE) {
      const container = new ContainerBuilder();

      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## Dernière activité\n**${displayName}**`),
      );
      container.addSeparatorComponents(new SeparatorBuilder());

      if (!row) {
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent('Aucune activité enregistrée pour ce membre.'),
        );
      } else {
        const lines = [`Vu <t:${row.seenAt}:R> · <t:${row.seenAt}:f>`];
        if (row.channelId) lines.push(`Dans <#${row.channelId}>`);
        if (row.lastMessage) lines.push(`\n**Dernier message**\n> ${row.lastMessage}`);
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(lines.join('\n')),
        );
      }

      sent = await message.channel.send({
        flags      : COMPONENTS_V2_FLAG,
        components : [container],
        embeds     : [],
        allowedMentions: { parse: [] },
      }).catch(() => null);
    } else {
      const avatarURL = fetchedUser.displayAvatarURL({ dynamic: true, size: 256 });
      let desc;
      if (!row) {
        desc = 'Aucune activité enregistrée pour ce membre.';
      } else {
        desc = `Vu <t:${row.seenAt}:R>${row.channelId ? ` dans <#${row.channelId}>` : ''}`;
        if (row.lastMessage) desc += `\n\n**Dernier message**\n> ${row.lastMessage}`;
      }

      sent = await message.channel.send({
        embeds: [embed.build(guildId, desc, {
          title      : 'Dernière activité',
          authorName : displayName,
          authorIcon : avatarURL,
          timestamp  : false,
        })],
        allowedMentions: { parse: [] },
      }).catch(() => null);
    }

    if (sent && deleteReply) embed.scheduleDelete(sent, deleteDelay);
  },
};

async function resolveUser(client, message, args) {
  const mention = message.mentions.users.first();
  if (mention) return mention;

  const raw = args.join(' ').trim();
  if (!raw) return message.author;

  const cleaned = raw.replace(/[<@!>]/g, '').trim();
  if (/^\d{17,20}$/.test(cleaned)) return client.users.fetch(cleaned).catch(() => null);

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
  }

  return null;
}
