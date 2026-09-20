import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { supabase } from '../lib/supabase.js';

// Memory cache to guarantee fast lookups and fallback if Supabase table is not yet migrated
const memoryQuizzes = new Map();
const memorySubmissions = new Map(); // key: `${quizId}_${discordId}` => submission

/**
 * Builds the interactive Discord message payload for a Community Quiz.
 */
export function buildQuizPayload(quiz, totalParticipants = 0) {
  const expireTimestampSec = Math.floor(new Date(quiz.expires_at).getTime() / 1000);

  const choicesList = quiz.options
    .map((opt, i) => {
      const numbers = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];
      return `${numbers[i] || `**[${i + 1}]**`} **${opt}**`;
    })
    .join('\n\n');

  const embed = new EmbedBuilder()
    .setColor(0x9b5de5) // Vibrant Amethyst / Purple
    .setTitle('🧠 Cohesion Community Quiz!')
    .setDescription(
      `**Question:**\n` +
      `### ${quiz.question}\n\n` +
      `**Options:**\n` +
      `${choicesList}\n\n` +
      `🪙 **Reward:** **+${quiz.reward_points} CP** & **+${quiz.reward_xp} XP** for correct answer\n` +
      `⏳ **Expires:** <t:${expireTimestampSec}:R>\n` +
      `👥 **Answered:** **${totalParticipants}** member${totalParticipants === 1 ? '' : 's'}`
    )
    .setFooter({ text: `Quiz ID: ${quiz.quiz_id} • 1 Attempt Per Member` })
    .setTimestamp();

  // Create up to 4 multiple-choice buttons
  const buttonsRow = new ActionRowBuilder();
  const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];

  quiz.options.forEach((opt, index) => {
    buttonsRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`quiz_ans_${quiz.quiz_id}_${index}`)
        .setLabel(opt.slice(0, 70))
        .setEmoji(emojis[index] || '🔹')
        .setStyle(ButtonStyle.Primary)
    );
  });

  return {
    embeds: [embed],
    components: [buttonsRow],
  };
}

/**
 * Saves a new Quiz in database and in-memory cache.
 */
export async function saveQuiz(quiz) {
  memoryQuizzes.set(quiz.quiz_id, quiz);

  try {
    await supabase.from('quizzes').upsert({
      quiz_id: quiz.quiz_id,
      guild_id: quiz.guild_id,
      channel_id: quiz.channel_id,
      message_id: quiz.message_id,
      question: quiz.question,
      options: quiz.options,
      correct_index: quiz.correct_index,
      reward_points: quiz.reward_points,
      reward_xp: quiz.reward_xp,
      expires_at: quiz.expires_at,
      is_active: quiz.is_active,
      created_by: quiz.created_by,
    });
  } catch (err) {
    console.warn('[QUIZ DB] Supabase quizzes table fallback to memory:', err.message);
  }
}

/**
 * Retrieves a quiz by ID from memory or database.
 */
export async function getQuiz(quizId) {
  if (memoryQuizzes.has(quizId)) {
    return memoryQuizzes.get(quizId);
  }

  try {
    const { data } = await supabase
      .from('quizzes')
      .select('*')
      .eq('quiz_id', quizId)
      .maybeSingle();

    if (data) {
      memoryQuizzes.set(quizId, data);
      return data;
    }
  } catch (_) {}

  return null;
}

/**
 * Checks if a member has already submitted an answer to this quiz.
 */
export async function hasUserSubmitted(quizId, discordId) {
  const key = `${quizId}_${discordId}`;
  if (memorySubmissions.has(key)) return true;

  try {
    const { data } = await supabase
      .from('quiz_submissions')
      .select('id')
      .eq('quiz_id', quizId)
      .eq('discord_id', discordId)
      .maybeSingle();

    if (data) {
      memorySubmissions.set(key, true);
      return true;
    }
  } catch (_) {}

  return false;
}

/**
 * Records a member's answer submission.
 */
export async function recordSubmission({ quizId, guildId, discordId, selectedIndex, isCorrect, pointsAwarded }) {
  const key = `${quizId}_${discordId}`;
  memorySubmissions.set(key, { isCorrect, pointsAwarded });

  try {
    await supabase.from('quiz_submissions').insert({
      quiz_id: quizId,
      guild_id: guildId,
      discord_id: discordId,
      selected_index: selectedIndex,
      is_correct: isCorrect,
      points_awarded: pointsAwarded,
    });
  } catch (err) {
    console.warn('[QUIZ SUBMISSION DB] Saved in memory cache');
  }
}

/**
 * Counts total unique participants for a quiz.
 */
export function getQuizParticipantCount(quizId) {
  let count = 0;
  for (const k of memorySubmissions.keys()) {
    if (k.startsWith(`${quizId}_`)) count++;
  }
  return count;
}
