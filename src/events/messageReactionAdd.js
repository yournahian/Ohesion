import { getActiveMatch, joinBattleMatch, buildLobbyPayload } from '../modules/battle/battleEngine.js';

export default {
  name: 'messageReactionAdd',
  once: false,
  async execute(reaction, user, client) {
    if (user.bot) return;

    // Handle partial reactions/messages
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch (_) {
        return;
      }
    }

    const emojiName = reaction.emoji?.name;
    if (emojiName !== '⚔️') return;

    const message = reaction.message;
    const guildId = message.guildId;
    if (!guildId) return;

    const match = getActiveMatch(guildId);
    if (!match || match.messageId !== message.id || match.status !== 'signup') {
      return;
    }

    // Attempt to join the user
    const result = await joinBattleMatch(guildId, user);
    if (!result.success) {
      return;
    }

    // Refresh lobby message embed with new participant count
    const payload = buildLobbyPayload(result.match);
    await message.edit(payload).catch(() => null);
  },
};
