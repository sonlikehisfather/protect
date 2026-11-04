'use strict';

/**
 * VoiceMaster - réponse CV2 standard : texte principal, séparateur, petite ligne de pied.
 * Repli sur embed.reply si le serveur n'utilise pas CV2.
 */

const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require('discord.js');

const embed = require('../utils/embed');

function replyWithFooter(message, commandName, headline, footer) {
  if (embed.shouldUseV2(message.guild.id, commandName)) {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headline));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${footer}`));

    return message.reply({
      components      : [container],
      flags           : MessageFlags.IsComponentsV2,
      allowedMentions : { parse: [], repliedUser: false },
    }).catch(() => null);
  }

  return embed.reply(message, `${headline}\n-# ${footer}`, { timestamp: false });
}

module.exports = { replyWithFooter };
