'use strict';


const db              = require('../core/database');
const tickets         = require('../modules/tickets');
const perms           = require('../utils/permissions');
const embed           = require('../utils/embed');
const errorHandler    = require('../utils/errorHandler');
const commandCooldown = require('../utils/commandCooldown');
const config          = require('../config.json');
const modmail         = require('../modules/modmail');

let automod         = null;
let levels          = null;
let customCommands  = null;

try { automod        = require('../modules/automod');        } catch {}
try { levels         = require('../modules/levels');         } catch {}
try { customCommands = require('../modules/customCommands'); } catch {}

module.exports = {
  name : 'messageCreate',
  once : false,

  async execute(client, message) {
    if (message.author.bot) return;


    try {
      const handledModmail = await modmail.handleMessage(client, message);
      if (handledModmail) return;
    } catch (err) {
      errorHandler.handle(err, {
        source : 'modmail',
        guildId: message.guild?.id || null,
        userId : message.author.id,
      });
    }

    if (!message.guild)  return;
    if (!message.member) return;

    const guildId = message.guild.id;


    let guildConfig = null;
    try { guildConfig = db.getGuildConfig(guildId); } catch {}


    const isPiconly = db.isPiconlyChannel(guildId, message.channel.id);

    if (isPiconly) {

      const isProtectedUser = perms.isProtected(message.author.id, guildId, message.member);

      let isExemptRole = false;
      if (!isProtectedUser) {
        let exemptRoles = [];
        try { exemptRoles = db.getPiconlyExemptRoles(guildId, message.channel.id) ?? []; } catch {}
        if (message.member && exemptRoles.length) {
          isExemptRole = exemptRoles.some(r => message.member.roles.cache.has(r.roleId));
        }
      }

      if (!isProtectedUser && !isExemptRole) {

        const hasValidAttachment = message.attachments.some(a =>
          a.contentType?.startsWith('image/') || a.contentType?.startsWith('video/')
        );

        const extRegex = /(https?:\/\/\S+\.(?:png|jpe?g|gif|webp|bmp|svg|apng|avif|mp4|mov|webm|mkv|m4v)(\?\S*)?)/i;
        const hasImageLink = extRegex.test(message.content);


        const embedDomains = [
          'tenor.com', 'giphy.com', 'imgur.com',
          'media.discordapp.net', 'cdn.discordapp.com',
          'i.imgur.com', 'media.tenor.com', 'i.giphy.com',
        ];
        const hasEmbedDomain = embedDomains.some(d => message.content.includes(d));

        if (!hasValidAttachment && !hasImageLink && !hasEmbedDomain) {
          await message.delete().catch(() => {});

          const deleteDelay = guildConfig?.autoDeleteDelay ?? 5;

          const sent = await message.channel.send({
            content         : `${message.author}, ce salon accepte uniquement les images, GIFs et vidéos.`,
            allowedMentions : { users: [message.author.id] },
          }).catch(() => null);

          if (sent) embed.scheduleDelete(sent, deleteDelay || 5);
          return;
        }
      }


      if (message.attachments.size > 0) {
        try {
          const autoreacts = db.raw()
            .prepare('SELECT emoji FROM autoreact WHERE guildId = ? AND channelId = ?')
            .all(guildId, message.channel.id);

          for (const row of autoreacts) {
            if (!row?.emoji) continue;
            await message.react(row.emoji).catch(() => {});
          }
        } catch {}
      }
    }


    if (automod) {
      try {
        const blocked = await automod.process(client, message);
        if (blocked) return;
      } catch (err) {
        errorHandler.handle(err, { source: 'automod', guildId });
      }
    }


    if (!isPiconly) {
      try {
        const autoreacts = db.raw()
          .prepare('SELECT emoji FROM autoreact WHERE guildId = ? AND channelId = ?')
          .all(guildId, message.channel.id);

        for (const row of autoreacts) {
          if (!row?.emoji) continue;
          await message.react(row.emoji).catch(() => {});
        }
      } catch {}
    }


    let prefix = config.prefix ?? '+';
    if (guildConfig?.prefix) prefix = guildConfig.prefix;

    const prefixes = Array.isArray(prefix) ? prefix : [prefix];
    const allowedPrefixes = Array.from(new Set(prefixes));

    if (Number(guildConfig?.autopublishEnabled) === 1) {
      try {
        if (message.channel?.type === 5 && message.crosspostable) {
          await message.crosspost().catch(() => {});
        }
      } catch (err) {
        errorHandler.handle(err, {
          source : 'autopublish',
          guildId,
          userId : message.author.id,
        });
      }
    }

    try {
      if (typeof db.updateTicketActivity === 'function') {
        db.updateTicketActivity(message.channel.id, Math.floor(Date.now() / 1000));
      }
    } catch {}


    const content = message.content.trimStart();

    try {
      const lastMsg = message.content ? message.content.slice(0, 200) : null;
      db.updateSeen(message.author.id, guildId, message.channel.id, lastMsg);
      db.incrementMsgcount(message.author.id, guildId);
    } catch {}

    // detect which prefix (if any) is used from allowedPrefixes
    const usedPrefix = allowedPrefixes.find(p => content.startsWith(p));
    if (!usedPrefix) {
      try {
        if (levels) {
          await levels.process(client, message);
        }
      } catch (err) {
        errorHandler.handle(err, { source: 'levels', guildId });
      }

      try {
        if (tickets?.handleAutoClaimMessage) {
          await tickets.handleAutoClaimMessage(client, message);
        }
      } catch (err) {
        errorHandler.handle(err, {
          source : 'tickets.autoclaim',
          guildId,
          userId : message.author.id,
        });
      }

      try {
        const lowerContent = message.content.toLowerCase();
        const guildKws     = db.getGuildKeywords(guildId);
        if (guildKws.length) {
          const notified = new Set();
          for (const { userId, keyword } of guildKws) {
            if (userId === message.author.id) continue;
            if (!lowerContent.includes(keyword)) continue;
            const key = `${userId}:${keyword}`;
            if (notified.has(key)) continue;
            notified.add(key);
            const user = await client.users.fetch(userId).catch(() => null);
            if (!user) continue;
            const preview = message.content.length > 200
              ? message.content.slice(0, 200) + '…'
              : message.content;
            user.send({
              content: `**Keyword \`${keyword}\` mentionné** dans <#${message.channel.id}> sur **${message.guild.name}**\n> ${preview}\n[Aller au message](${message.url})`,
            }).catch(() => {});
          }
        }
      } catch {}

      return;
    }


    const withoutPrefix = content.slice(usedPrefix.length);

    if (!withoutPrefix.trim() || /^\s/.test(withoutPrefix)) {
      return;
    }

    const args = withoutPrefix
      .trim()
      .split(/\s+/);

    const commandName = args.shift()?.toLowerCase();

    if (!commandName) return;

    const errorDeleteReply = Boolean(guildConfig?.autoDeleteErrorReplies);
    const deleteDelay = guildConfig?.autoDeleteDelay ?? 5;


    const command = client.commands.get(commandName);
    if (command) {
      const cmdName = command?.help?.name;
      const selfManaged = Boolean(command?.help?.selfManaged);

      if (!cmdName) {
        const sent = await embed.replyError(
          message,
          'Commande invalide.',
          { timestamp: false }
        ).catch(() => null);

        if (sent && errorDeleteReply) {
          embed.scheduleDelete(sent, deleteDelay);
        }

        return;
      }

      if (!selfManaged && !perms.check(message, cmdName)) {
        const sent = await embed.replyError(
          message,
          "Vous n'avez pas la permission d'utiliser cette commande.",
          { timestamp: false }
        ).catch(() => null);

        if (sent && errorDeleteReply) {
          embed.scheduleDelete(sent, deleteDelay);
        }

        return;
      }

      const cooldown = commandCooldown.check(message, cmdName, command);

      if (!cooldown.allowed) {
        return commandCooldown.replyBlocked(
          message,
          cooldown.remainingMs,
          errorDeleteReply,
          deleteDelay,
          cooldown.shouldNotify
        );
      }

      await errorHandler.run(
        () => command.run(client, message, args),
        {
          command : cmdName,
          guildId,
          userId  : message.author.id,
        },
        message
      );

      return;
    }


    if (customCommands) {
      try {
        const customExists = typeof db.getCustomCommand === 'function'
          && db.getCustomCommand(guildId, commandName);

        if (customExists) {
          const ccCooldown = commandCooldown.checkCustom(message, commandName);

          if (!ccCooldown.allowed) {
            return commandCooldown.replyBlocked(
              message,
              ccCooldown.remainingMs,
              errorDeleteReply,
              deleteDelay,
              ccCooldown.shouldNotify
            );
          }
        }

        const result = await customCommands.execute(client, message, commandName);

        if (result) return;
      } catch {}
    }


    const suggestions = _findSimilarCommands(commandName, client.commands);

    if (suggestions.length > 0) {
      const {
        ActionRowBuilder,
        ButtonBuilder,
        ButtonStyle,
        ContainerBuilder,
        SectionBuilder,
        TextDisplayBuilder,
        MessageFlags,
      } = require('discord.js');

      const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
      const V2_AVAILABLE = typeof ContainerBuilder === 'function' &&
                         typeof SectionBuilder === 'function' &&
                         typeof TextDisplayBuilder === 'function';

      const suggestionText = suggestions.map(s => `\`${usedPrefix}${s.name}\``).join(', ');

      const desc = `La commande \`${usedPrefix}${commandName}\` n'existe pas.\n\nVous voulez plutôt essayer :\n${suggestionText}`;

      let sent;

      if (V2_AVAILABLE) {
        const container = new ContainerBuilder().setAccentColor(0xFEE75C);

        const closeButton = new ButtonBuilder()
          .setCustomId('suggest:close')
          .setLabel('✖')
          .setStyle(ButtonStyle.Danger);

        container.addSectionComponents(
          new SectionBuilder()
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent(`**Commande introuvable**\n${desc}`),
            )
            .setButtonAccessory(closeButton),
        );

        sent = await message.channel.send({
          flags      : COMPONENTS_V2_FLAG,
          components : [container],
          allowedMentions : { parse: [] },
        }).catch(() => null);
      }

      if (!sent) {
        const suggestionEmbed = embed.build(message.guild.id, desc, {
          title       : 'Commande introuvable',
          color       : '#FEE75C',
          timestamp   : false,
        });

        const closeRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('suggest:close')
            .setLabel('✖')
            .setStyle(ButtonStyle.Danger)
        );

        sent = await message.channel.send({
          embeds     : [suggestionEmbed],
          components : [closeRow],
          allowedMentions : { parse: [] },
        }).catch(() => null);
      }

      if (sent) {
        const collector = sent.createMessageComponentCollector({
          filter : i => i.user.id === message.author.id && i.customId === 'suggest:close',
          time   : 60000,
        });

        collector.on('collect', async interaction => {
          collector.stop('closed');
          await interaction.deferUpdate().catch(() => {});
          await sent.delete().catch(() => {});
          await message.delete().catch(() => {});
        });

        collector.on('end', async () => {
              await sent.edit({ components: [] }).catch(() => {});
        });
      }
    } else {
      const sent = await embed.replyError(
        message,
        `La commande \`${usedPrefix}${commandName}\` n'existe pas.`,
        { timestamp: false }
      ).catch(() => null);

      if (sent && errorDeleteReply) {
        embed.scheduleDelete(sent, deleteDelay);
      }
    }
  },
};

function _levenshtein(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[b.length][a.length];
}

function _findSimilarCommands(input, commands) {
  const inputLower = input.toLowerCase();
  const allCommands = Array.from(commands.values());
  const suggestions = [];

  for (const cmd of allCommands) {
    const cmdName = cmd.help?.name?.toLowerCase() || '';
    const aliases = cmd.help?.aliases?.map(a => a.toLowerCase()) || [];

    const nameDist = _levenshtein(inputLower, cmdName);
    if (nameDist <= 2 && cmdName !== inputLower) {
      suggestions.push({ name: cmd.help.name, dist: nameDist });
      continue;
    }

    for (const alias of aliases) {
      if (alias.length < 3) continue;
      const aliasDist = _levenshtein(inputLower, alias);
      if (aliasDist <= 2 && alias !== inputLower) {
        suggestions.push({ name: cmd.help.name, dist: aliasDist });
        break;
      }
    }
  }

  const bestMatch = new Map();
  for (const s of suggestions) {
    if (!bestMatch.has(s.name) || s.dist < bestMatch.get(s.name).dist) {
      bestMatch.set(s.name, s);
    }
  }

  const uniqueSuggestions = Array.from(bestMatch.values());
  uniqueSuggestions.sort((a, b) => a.dist - b.dist);
  return uniqueSuggestions.slice(0, 3);
}
