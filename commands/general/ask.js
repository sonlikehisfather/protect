'use strict';

const embed = require('../../utils/embed');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'openrouter/free';
const MAX_PROMPT_LENGTH = 1_500;
const MAX_REPLY_LENGTH = 1_850;
const REQUEST_TIMEOUT_MS = 30_000;
const USER_COOLDOWN_MS = 10_000;
const recentRequests = new Map();

module.exports = {
  help: {
    name: 'ask',
    description: 'Pose une question a l’IA.',
    usage: 'ask <question>',
    category: 'general',
    defaultPermission: 'buyer',
    cooldownMs: 10_000,
  },

  async run(client, message, args) {
    const question = args.join(' ').trim();
    if (!question) {
      return embed.replyError(
        message,
        `Utilisation : \`${message.prefix || '+'}ask <question>\``
      );
    }

    if (question.length > MAX_PROMPT_LENGTH) {
      return embed.replyError(
        message,
        `La question ne peut pas dépasser **${MAX_PROMPT_LENGTH} caractères**.`
      );
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      console.error('[ASK] OPENROUTER_API_KEY is not configured.');
      return embed.replyError(message, 'La commande IA n’est pas configurée.');
    }

    const now = Date.now();
    for (const [userId, timestamp] of recentRequests) {
      if (now - timestamp >= USER_COOLDOWN_MS) recentRequests.delete(userId);
    }
    const previousRequest = recentRequests.get(message.author.id);
    if (previousRequest && now - previousRequest < USER_COOLDOWN_MS) {
      const seconds = Math.ceil((USER_COOLDOWN_MS - (now - previousRequest)) / 1_000);
      return embed.replyError(message, `Attends encore **${seconds} seconde(s)** avant une autre question.`);
    }
    recentRequests.set(message.author.id, now);

    let response;
    try {
      response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/sonlikehisfather/protect',
          'X-Title': 'MySoul Discord Bot',
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            {
              role: 'system',
              content: 'Tu es un assistant utile sur Discord. Reponds dans la langue de la question, clairement et de façon concise. Tu n’as aucun accès au serveur ni aux donnees du bot.',
            },
            { role: 'user', content: question },
          ],
          max_tokens: 500,
          temperature: 0.7,
          provider: { data_collection: 'deny' },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      console.error(`[ASK] OpenRouter request failed: ${error?.message || error}`);
      const description = error?.name === 'TimeoutError'
        ? 'Le service IA met trop de temps à répondre. Réessaie dans quelques instants.'
        : 'Impossible de joindre le service IA. Réessaie dans quelques instants.';
      return embed.replyError(message, description);
    }

    if (!response.ok) {
      console.error(`[ASK] OpenRouter returned HTTP ${response.status}.`);
      if (response.status === 429) {
        return embed.replyError(message, 'Réessaie plus tard.');
      }
      if (response.status === 401 || response.status === 403) {
        return embed.replyError(message, 'La key OpenRouter est invalide ou ne permet pas cette requête.');
      }
      return embed.replyError(message, 'L\'IA a rencontré une erreur. Réessaie plus tard.');
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      console.error(`[ASK] Invalid OpenRouter response: ${error?.message || error}`);
      return embed.replyError(message, 'Le service IA a renvoyé une réponse invalide.');
    }

    const answer = data?.choices?.[0]?.message?.content;
    if (typeof answer !== 'string' || !answer.trim()) {
      console.error('[ASK] OpenRouter response did not contain a text answer.');
      return embed.replyError(message, 'Le service IA n’a pas renvoyé de réponse. Réessaie plus tard.');
    }

    const trimmedAnswer = answer.trim();
    const visibleAnswer = trimmedAnswer.length > MAX_REPLY_LENGTH
      ? `${trimmedAnswer.slice(0, MAX_REPLY_LENGTH - 1)}…`
      : trimmedAnswer;

    return message.reply({
      content: visibleAnswer,
      allowedMentions: { parse: [] },
    });
  },
};
