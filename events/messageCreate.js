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

    if (!content.startsWith(prefix)) {
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

      return;
    }


    const withoutPrefix = content.slice(prefix.length);

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


    const sent = await embed.replyError(
      message,
      `La commande \`${commandName}\` n'existe pas.`,
      { timestamp: false }
    ).catch(() => null);

    if (sent && errorDeleteReply) {
      embed.scheduleDelete(sent, deleteDelay);
    }
  },
};
