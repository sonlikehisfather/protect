'use strict';


const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
} = require('discord.js');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder === 'function' &&
                           typeof TextDisplayBuilder === 'function';

const db    = require('../../core/database');
const embed = require('../../utils/embed');

module.exports = {
  help: {
    name        : 'user',
    description : 'Affiche les informations relatives à un utilisateur.',
    usage       : 'user [membre]',
    aliases     : ['userinfo', 'ui'],
    defaultPermission: 'everyone',
  },

  async run(client, message, args) {

    const guildId = message.guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteInfoCmds);
    const deleteReply = Boolean(config?.autoDeleteInfoReplies);
    const deleteDelay = config?.autoDeleteDelay ?? 5;

    if (deleteCmd) {
      await message.delete().catch(() => {});
    }

    const target = await resolveUser(client, message, args);

    if (!target) {
      const sent = await embed.replyError(
        message,
        'Utilisateur introuvable.',
        { timestamp: false }
      ).catch(() => null);

      if (sent && deleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }

      return;
    }


    const fetchedUser = await client.users
      .fetch(target.id, { force: true })
      .catch(() => target);

    const createdAt = Math.floor(fetchedUser.createdTimestamp / 1000);

    const avatarURL  = fetchedUser.displayAvatarURL({ dynamic: true, size: 1024 });
    const bannerURL  = fetchedUser.bannerURL({ dynamic: true, size: 1024 }) ?? null;

    const displayName = fetchedUser.globalName
      ? `${fetchedUser.globalName} (@${fetchedUser.username})`
      : `@${fetchedUser.username}`;

    const fields = [
      {
        name  : 'Utilisateur',
        value : `<@${fetchedUser.id}>`,
        inline: true,
      },
      {
        name  : 'ID',
        value : fetchedUser.id,
        inline: true,
      },
      {
        name  : 'Bot',
        value : fetchedUser.bot ? 'Oui' : 'Non',
        inline: true,
      },
      {
        name  : 'Nom affiché',
        value : fetchedUser.globalName ?? fetchedUser.username,
        inline: true,
      },
      {
        name  : 'Nom utilisateur',
        value : `@${fetchedUser.username}`,
        inline: true,
      },
      {
        name  : 'Compte créé le',
        value : `<t:${createdAt}:F> · il y a <t:${createdAt}:R>`,
        inline: false,
      },
    ];

    if (avatarURL) {
      fields.push({
        name  : 'Avatar',
        value : `[Avatar global](${avatarURL})`,
        inline: true,
      });
    }

    if (bannerURL) {
      fields.push({
        name  : 'Bannière',
        value : `[Bannière globale](${bannerURL})`,
        inline: true,
      });
    }

    const lines = [
      `## Informations utilisateur`,
      `> ${displayName}`,
      '',
      `**Utilisateur** \u203a <@${fetchedUser.id}>`,
      `ID \u203a \`${fetchedUser.id}\``,
      `**Bot** \u203a ${fetchedUser.bot ? 'Oui' : 'Non'}`,
      `Nom affich\u00e9 \u203a ${fetchedUser.globalName ?? fetchedUser.username}`,
      `**Nom utilisateur** \u203a @${fetchedUser.username}`,
      `Compte cr\u00e9\u00e9 le \u203a <t:${createdAt}:F> (<t:${createdAt}:R>)`,
    ];

    if (avatarURL) {
      lines.push(`Avatar \u203a [Avatar global](${avatarURL})`);
    }

    if (bannerURL) {
      lines.push(`Banni\u00e8re \u203a [Banni\u00e8re globale](${bannerURL})`);
    }

    const text = lines.join('\n');

    const profileRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Voir le profil')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/users/${fetchedUser.id}`)
    );

    let sent = null;

    if (embed.shouldUseV2(guildId, module.exports.help.name)) {
      try {
        const container = new ContainerBuilder();
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
        if (bannerURL) {
          container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
              new MediaGalleryItemBuilder().setURL(bannerURL)
            )
          );
        }
        container.addActionRowComponents(profileRow);
        sent = await message.channel.send({
          components      : [container],
          flags           : COMPONENTS_V2_FLAG,
          allowedMentions : { parse: [] },
        }).catch(() => null);
      } catch {}
    }

    if (!sent) {
      sent = await message.channel.send({
        embeds: [
          embed.build(guildId, null, {
            title      : 'Informations utilisateur',
            authorName : displayName,
            authorIcon : avatarURL,
            thumbnail  : avatarURL,
            image      : bannerURL ?? undefined,
            fields,
            timestamp  : false,
          }),
        ],
        components: [profileRow],
        allowedMentions: { parse: [] },
      }).catch(() => null);
    }

    if (sent && deleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
  },
};

async function resolveUser(client, message, args) {

  if (message.reference?.messageId) {
    const repliedMessage = await message.channel.messages
      .fetch(message.reference.messageId)
      .catch(() => null);

    if (repliedMessage?.author) {
      return repliedMessage.author;
    }
  }

  const mention = message.mentions.users.first();
  if (mention) return mention;

  const raw = args.join(' ').trim();

  if (!raw) return message.author;

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

  const fetchedMembers = await message.guild.members.fetch().catch(() => null);

  if (fetchedMembers) {
    member = fetchedMembers.find(m =>
      m.user.username.toLowerCase() === lowered ||
      (m.user.globalName && m.user.globalName.toLowerCase() === lowered) ||
      m.displayName.toLowerCase() === lowered
    );

    if (member) return member.user;

    member = fetchedMembers.find(m =>
      m.user.username.toLowerCase().includes(lowered) ||
      (m.user.globalName && m.user.globalName.toLowerCase().includes(lowered)) ||
      m.displayName.toLowerCase().includes(lowered)
    );

    if (member) return member.user;
  }

  return null;
}
