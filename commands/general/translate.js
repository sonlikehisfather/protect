'use strict';

const {
  ActionRowBuilder,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} = require('discord.js');

const db    = require('../../core/database');
const embed = require('../../utils/embed');

const COMPONENTS_V2_FLAG = MessageFlags?.IsComponentsV2 ?? (1 << 15);
const V2_AVAILABLE       = typeof ContainerBuilder    === 'function' &&
                           typeof TextDisplayBuilder === 'function' &&
                           typeof SeparatorBuilder   === 'function';

const LANGUAGES = [
  { label: 'Français',     value: 'fr', emoji: '🇫🇷' },
  { label: 'Anglais',      value: 'en', emoji: '🇬🇧' },
  { label: 'Espagnol',     value: 'es', emoji: '🇪🇸' },
  { label: 'Allemand',     value: 'de', emoji: '🇩🇪' },
  { label: 'Italien',      value: 'it', emoji: '🇮🇹' },
  { label: 'Portugais',    value: 'pt', emoji: '🇵🇹' },
  { label: 'Néerlandais',  value: 'nl', emoji: '🇳🇱' },
  { label: 'Russe',        value: 'ru', emoji: '🇷🇺' },
  { label: 'Japonais',     value: 'ja', emoji: '🇯🇵' },
  { label: 'Chinois',      value: 'zh', emoji: '🇨🇳' },
  { label: 'Arabe',        value: 'ar', emoji: '🇸🇦' },
  { label: 'Coréen',       value: 'ko', emoji: '🇰🇷' },
  { label: 'Turc',         value: 'tr', emoji: '🇹🇷' },
  { label: 'Polonais',     value: 'pl', emoji: '🇵🇱' },
  { label: 'Su\u00e9dois',      value: 'sv', emoji: '\ud83c\uddf8\ud83c\uddea' },
  { label: 'Norv\u00e9gien',   value: 'no', emoji: '\ud83c\uddf3\ud83c\uddf4' },
  { label: 'Danois',       value: 'da', emoji: '\ud83c\udde9\ud83c\uddf0' },
  { label: 'Finnois',      value: 'fi', emoji: '🇫🇮' },
  { label: 'Grec',         value: 'el', emoji: '🇬🇷' },
  { label: 'Hébreu',       value: 'he', emoji: '🇮🇱' },
  { label: 'Hindi',        value: 'hi', emoji: '🇮🇳' },
  { label: 'Indonésien',   value: 'id', emoji: '🇮🇩' },
  { label: 'Roumain',      value: 'ro', emoji: '🇷🇴' },
  { label: 'Ukrainien',    value: 'uk', emoji: '🇺🇦' },
  { label: 'Vietnamien',   value: 'vi', emoji: '🇻🇳' },
];

module.exports = {
  help: {
    name        : 'translate',
    description : 'Traduit un texte dans la langue de votre choix.',
    usage       : 'translate <texte>',
    aliases     : ['tr', 'trad'],
    category    : 'general',
  },

  async run(client, message, args) {
    const guildId = message.guild.id;
    const config  = db.getGuildConfig(guildId);

    const deleteCmd   = Boolean(config?.autoDeleteInfoCmds);
    const deleteReply = Boolean(config?.autoDeleteInfoReplies);
    const deleteDelay = Number(config?.autoDeleteDelay ?? 5);

    if (deleteCmd) await message.delete().catch(() => {});

    const text = args.join(' ').trim();

    if (!text) {
      const prefix = config?.prefix || '+';
      const s = await embed.replyError(
        message,
        `Utilisation : \`${prefix}translate <texte>\``,
        { timestamp: false },
      ).catch(() => null);
      if (s && deleteReply) embed.scheduleDelete(s, deleteDelay);
      return;
    }

    if (text.length > 500) {
      const s = await embed.replyError(
        message,
        'Le texte ne peut pas dépasser **500 caractères**.',
        { timestamp: false },
      ).catch(() => null);
      if (s && deleteReply) embed.scheduleDelete(s, deleteDelay);
      return;
    }

    const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text;

    const _buildPanel = (state = 'pending', extra = {}) => {
      let bodyText;
      if (state === 'loading') {
        bodyText = `## Traduction\n\nTraduction en cours…`;
      } else if (state === 'done') {
        const { langLabel, translated } = extra;
        bodyText = [
          `## Traduction → ${langLabel}`,
          ``,
          `**Texte original**`,
          `${text.slice(0, 900)}`,
          ``,
          `**Traduction**`,
          `${translated.slice(0, 900)}`,
        ].join('\n');
      } else if (state === 'error') {
        bodyText = `## Traduction\n\nLa traduction a échoué. Réessaie dans quelques instants.`;
      } else {
        bodyText = `## Traduction\n\nSélectionne la langue cible pour : \`${preview}\``;
      }

      const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(bodyText));

      if (state === 'pending') {
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(1));
        container.addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('local:translate:lang')
              .setPlaceholder('Choisir une langue…')
              .addOptions(LANGUAGES.map(l => ({
                label : l.label,
                value : l.value,
                emoji : l.emoji,
              }))),
          ),
        );
      }

      return {
        components      : [container],
        flags           : COMPONENTS_V2_FLAG,
        allowedMentions : { parse: [] },
      };
    };

    if (!V2_AVAILABLE) {
      const s = await embed.replyError(message, 'Components V2 non disponible sur cette version du bot.', { timestamp: false }).catch(() => null);
      if (s && deleteReply) embed.scheduleDelete(s, deleteDelay);
      return;
    }

    const panel = await message.channel.send(_buildPanel('pending')).catch(e => { console.error('[translate] send err:', e); return null; });
    if (!panel) return;

    const collector = panel.createMessageComponentCollector({
      filter : i => i.user.id === message.author.id,
      time   : 60_000,
    });

    collector.on('collect', async (i) => {
      const targetLang = i.values[0];
      const langLabel  = LANGUAGES.find(l => l.value === targetLang)?.label ?? targetLang;

      await i.deferUpdate().catch(() => {});
      await panel.edit(_buildPanel('loading')).catch(() => {});

      const url        = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=autodetect|${targetLang}`;
      const res        = await fetch(url).catch(() => null);
      const json       = res?.ok ? await res.json().catch(() => null) : null;
      const translated = json?.responseData?.translatedText;

      if (!translated || json?.responseStatus !== 200) {
        collector.stop('error');
        await panel.edit(_buildPanel('error')).catch(() => {});
        if (deleteReply) embed.scheduleDelete(panel, deleteDelay);
        return;
      }

      collector.stop('done');
      await panel.edit(_buildPanel('done', { langLabel, translated })).catch(() => {});
      if (deleteReply) embed.scheduleDelete(panel, deleteDelay);
    });

    collector.on('end', (_, reason) => {
      if (reason === 'done' || reason === 'error') return;
      panel.edit({ ..._buildPanel('pending'), components: [] }).catch(() => {});
      if (deleteReply) embed.scheduleDelete(panel, deleteDelay);
    });
  },
};
