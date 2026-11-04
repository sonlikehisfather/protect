'use strict';

const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require('discord.js');

const messages = require('../messages');
const embed    = require('../../utils/embed');
const { LEVELS, LEVEL_NAMES, PREFIX } = require('../config');

/* Niveaux affichés du plus haut au plus bas. */
const DISPLAY_ORDER = [
  LEVELS.PRINCIPAL,
  LEVELS.SYS_PLUS,
  LEVELS.SYS,
  LEVELS.OWNER,
  LEVELS.WL,
];

function _labelFor(level) {
  return level === LEVELS.WL ? 'Whitelist' : LEVEL_NAMES[level];
}

/** Titre : "Owner Voicemaster", "Whitelist Voicemaster", etc. */
function _titleFor(level) {
  return `${_labelFor(level)} Voicemaster`;
}

function _uniqueCommands(client) {
  const unique = new Map();
  for (const cmd of client.vmCommands.values()) {
    if (!unique.has(cmd.name)) unique.set(cmd.name, cmd);
  }
  return [...unique.values()];
}

/** Sections { label, lines } : les commandes de chaque rang accessible, du plus haut au plus bas. */
function _buildSections(client, level) {
  const commands = _uniqueCommands(client);
  const sections = [];

  for (const sectionLevel of DISPLAY_ORDER) {
    if (sectionLevel > level) continue;

    const lines = commands
      .filter(cmd => cmd.minRank === sectionLevel)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(cmd => messages.helpLine(cmd.usage ?? `${PREFIX}${cmd.name}`, cmd.description ?? ''));

    if (lines.length) {
      sections.push({ label: _labelFor(sectionLevel), lines });
    }
  }

  return sections;
}

module.exports = {
  name        : 'help',
  description : 'Affiche les commandes Voicemaster disponibles pour ton rang.',
  aliases     : ['aide', 'h'],
  minRank     : LEVELS.WL,
  usage       : '=help',

  async run({ client, message, level }) {
    const guild    = message.guild;
    const title    = _titleFor(level);
    const sections = _buildSections(client, level);
    const total    = sections.reduce((n, s) => n + s.lines.length, 0);
    const footer   = messages.helpFooter(total);

    if (embed.shouldUseV2(guild.id, 'help')) {
      const container = new ContainerBuilder();
      const separator = () =>
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${title}`));

      for (const section of sections) {
        separator();
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`**${section.label}**\n${section.lines.join('\n')}`)
        );
      }

      separator();
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${footer}`));

      return message.reply({
        components      : [container],
        flags           : MessageFlags.IsComponentsV2,
        allowedMentions : { parse: [], repliedUser: false },
      }).catch(() => null);
    }

    const body = sections
      .map(section => `**${section.label}**\n${section.lines.join('\n')}`)
      .join('\n\n');

    return embed.reply(message, `${body}\n\n-# ${footer}`, { title, timestamp: false });
  },
};
