import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { supabase } from '../lib/supabase.js';
import { getLevelFromXp } from './levelCalculator.js';

// In-memory registry of live quiz sessions
const liveSessions = new Map();

/**
 * Creates a new live quiz tournament session in memory.
 */
export function createLiveSession({
  guildId,
  channelId,
  title,
  questionTimeSec = 20,
  breakTimeSec = 8,
  basePoints = 100,
  xpBonus = 500,
  createdBy,
}) {
  const sessionId = 'lqz_' + Date.now().toString(36);
  const session = {
    sessionId,
    guildId,
    channelId,
    title: title || 'Questify Live Quiz Show',
    questionTimeSec: Math.max(5, Math.min(120, parseInt(questionTimeSec, 10) || 20)),
    breakTimeSec: Math.max(3, Math.min(60, parseInt(breakTimeSec, 10) || 8)),
    basePoints: Math.max(10, parseInt(basePoints, 10) || 100),
    xpBonus: Math.max(50, parseInt(xpBonus, 10) || 500),
    createdBy,
    status: 'setup', // 'setup' | 'countdown' | 'in_progress' | 'finished' | 'cancelled'
    questions: [],
    currentQuestionIndex: -1,
    currentQuestionStartTime: 0,
    currentQuestionEndTime: 0,
    playerScores: new Map(), // discordId => cumulative points (QP)
    playerAnswers: new Map(), // key: `${qIndex}_${discordId}` => { choiceIndex, isCorrect, pointsAwarded, elapsedSec }
    createdAt: Date.now(),
  };

  liveSessions.set(sessionId, session);
  return session;
}

/**
 * Retrieves a live session by ID.
 */
export function getLiveSession(sessionId) {
  return liveSessions.get(sessionId) || null;
}

/**
 * Adds a single question to a session.
 */
export function addQuestionToSession(sessionId, { question, options, correctIndex }) {
  const session = liveSessions.get(sessionId);
  if (!session) return { success: false, message: 'Session not found.' };
  if (session.status !== 'setup') return { success: false, message: 'Quiz has already started.' };

  session.questions.push({
    question: question.trim(),
    options: options.map((o) => o.trim()).filter((o) => o.length > 0),
    correctIndex: parseInt(correctIndex, 10),
  });

  return { success: true, count: session.questions.length };
}

/**
 * Parses and adds multiple questions formatted in bulk.
 * Format accepted per question:
 * Question ? Option 1, Option 2, Option 3, Option 4 ? CorrectIndex (1-4)
 */
export function addBulkQuestionsToSession(sessionId, bulkText) {
  const session = liveSessions.get(sessionId);
  if (!session) return { success: false, message: 'Session not found.' };
  if (session.status !== 'setup') return { success: false, message: 'Quiz has already started.' };

  const lines = bulkText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  let added = 0;

  for (const line of lines) {
    let qText = '';
    let optsRaw = '';
    let correctRaw = '';

    if (line.includes('|')) {
      const parts = line.split('|').map((p) => p.trim());
      if (parts.length >= 3) {
        qText = parts[0];
        optsRaw = parts[1];
        correctRaw = parts[2];
      }
    } else if (line.includes('?')) {
      const rawParts = line.split('?').map((p) => p.trim()).filter((p) => p.length > 0);
      if (rawParts.length >= 2) {
        correctRaw = rawParts[rawParts.length - 1];
        optsRaw = rawParts[rawParts.length - 2];
        qText = rawParts.slice(0, rawParts.length - 2).join('?');
        if (!qText) qText = rawParts[0];
        if (!qText.endsWith('?')) qText += '?';
      }
    }

    if (qText && optsRaw && correctRaw) {
      const opts = optsRaw.split(/[,/]/).map((o) => o.trim()).filter((o) => o.length > 0);
      const correctNum = parseInt(correctRaw, 10);

      if (opts.length >= 2 && opts.length <= 4 && !isNaN(correctNum) && correctNum >= 1 && correctNum <= opts.length) {
        session.questions.push({
          question: qText,
          options: opts,
          correctIndex: correctNum - 1,
        });
        added++;
      }
    }
  }

  return { success: true, added, total: session.questions.length };
}

/**
 * Calculates Kahoot-style speed-scaled points.
 * Immediate answer = 100% of base points.
 * Answer at final second = 50% of base points.
 */
export function calculateSpeedPoints(basePoints, elapsedMs, totalMs) {
  const elapsedSec = Math.max(0, elapsedMs / 1000);
  const totalSec = Math.max(1, totalMs / 1000);
  const ratio = Math.max(0, Math.min(1, elapsedSec / totalSec));
  // Multiplier scales from 1.0 down to 0.5
  const multiplier = 0.5 + 0.5 * (1 - ratio);
  return Math.round(basePoints * multiplier);
}

/**
 * Submits an answer for a user.
 */
export function submitLiveAnswer(sessionId, questionIndex, discordId, choiceIndex) {
  const session = liveSessions.get(sessionId);
  if (!session) return { error: 'Quiz session expired or not found.' };
  if (session.status !== 'in_progress') return { error: 'Quiz is not currently running.' };
  if (session.currentQuestionIndex !== questionIndex) {
    return { error: '⏳ Time is up for that question!' };
  }

  const now = Date.now();
  if (now > session.currentQuestionEndTime) {
    return { error: '⏳ Time is up for this question!' };
  }

  const answerKey = `${questionIndex}_${discordId}`;
  if (session.playerAnswers.has(answerKey)) {
    return { error: '⚠️ You have already submitted an answer for this question!' };
  }

  const questionObj = session.questions[questionIndex];
  if (!questionObj) return { error: 'Invalid question.' };

  const isCorrect = choiceIndex === questionObj.correctIndex;
  const elapsedMs = Math.max(100, now - session.currentQuestionStartTime);
  const elapsedSec = (elapsedMs / 1000).toFixed(1);

  let pointsAwarded = 0;
  if (isCorrect) {
    pointsAwarded = calculateSpeedPoints(
      session.basePoints,
      elapsedMs,
      session.questionTimeSec * 1000
    );
    const prevScore = session.playerScores.get(discordId) || 0;
    session.playerScores.set(discordId, prevScore + pointsAwarded);
  }

  session.playerAnswers.set(answerKey, {
    choiceIndex,
    isCorrect,
    pointsAwarded,
    elapsedSec,
  });

  return {
    success: true,
    isCorrect,
    pointsAwarded,
    elapsedSec,
    chosenOption: questionObj.options[choiceIndex],
    correctOption: questionObj.options[questionObj.correctIndex],
    totalScore: session.playerScores.get(discordId) || 0,
  };
}

/**
 * Generates Top 10 tournament leaderboard so far.
 */
export function getSessionTop10(session) {
  const sorted = Array.from(session.playerScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([discordId, score], idx) => ({
      rank: idx + 1,
      discordId,
      score,
    }));
  return sorted;
}

/**
 * Builds the setup control deck for the admin to configure the quiz before starting.
 */
export function buildSetupDeck(session) {
  const questionsCount = session.questions.length;

  const embed = new EmbedBuilder()
    .setColor(0x9b5de5)
    .setTitle(`🧠 Live Quiz Show: ${session.title}`)
    .setDescription(
      `Configure your live tournament questions and launch when ready!\n\n` +
      `⏱️ **Question Time:** \`${session.questionTimeSec}s\` per question\n` +
      `⏸️ **Break Time:** \`${session.breakTimeSec}s\` between rounds\n` +
      `🪙 **Base Points:** \`${session.basePoints} QP\` (Speed-Scaled)\n` +
      `🎁 **Top 10 XP Bonus Pool:** \`${session.xpBonus} XP\`\n\n` +
      `📚 **Questions Loaded:** **${questionsCount}** question${questionsCount === 1 ? '' : 's'}`
    )
    .setFooter({ text: `Session ID: ${session.sessionId} • Ready for launch` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`lqz_btn_addq_${session.sessionId}`)
      .setLabel('Add Question')
      .setEmoji('➕')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`lqz_btn_bulkq_${session.sessionId}`)
      .setLabel('Quick Paste Bulk')
      .setEmoji('📝')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`lqz_btn_viewq_${session.sessionId}`)
      .setLabel('View Questions')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`lqz_btn_start_${session.sessionId}`)
      .setLabel('Launch Live Quiz!')
      .setEmoji('🚀')
      .setStyle(ButtonStyle.Success)
      .setDisabled(questionsCount === 0)
  );

  return { embeds: [embed], components: [row] };
}

/**
 * Builds the Discord message payload for a live active question.
 */
function buildLiveQuestionPayload(session, questionIndex) {
  const q = session.questions[questionIndex];
  const totalQ = session.questions.length;
  const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];

  const choicesList = q.options
    .map((opt, i) => `${emojis[i] || `**[${i + 1}]**`} **${opt}**`)
    .join('\n\n');

  const expireTimestampSec = Math.floor(session.currentQuestionEndTime / 1000);

  const embed = new EmbedBuilder()
    .setColor(0x06d6a0)
    .setTitle(`🧠 Round ${questionIndex + 1} of ${totalQ}`)
    .setDescription(
      `### ${q.question}\n\n` +
      `${choicesList}\n\n` +
      `⏱️ **Time Remaining:** <t:${expireTimestampSec}:R> (ends <t:${expireTimestampSec}:T>)\n` +
      `⚡ **Speed Bonus:** Answering faster awards up to **+${session.basePoints} QP**!`
    )
    .setFooter({ text: `${session.title} • 1 Answer Per Member` });

  const buttonsRow = new ActionRowBuilder();
  q.options.forEach((opt, idx) => {
    buttonsRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`quiz_live_ans_${session.sessionId}_${questionIndex}_${idx}`)
        .setLabel(opt.slice(0, 70))
        .setEmoji(emojis[idx] || '🔹')
        .setStyle(ButtonStyle.Primary)
    );
  });

  return { embeds: [embed], components: [buttonsRow] };
}

/**
 * Builds the locked question message showing the correct answer highlighted.
 */
function buildLockedQuestionPayload(session, questionIndex) {
  const q = session.questions[questionIndex];
  const totalQ = session.questions.length;
  const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];

  const choicesList = q.options
    .map((opt, i) => {
      const isRight = i === q.correctIndex;
      return `${emojis[i]} ${isRight ? `✅ **${opt}** *(Correct Answer)*` : `~~${opt}~~`}`;
    })
    .join('\n\n');

  const embed = new EmbedBuilder()
    .setColor(0x118ab2)
    .setTitle(`🔒 Round ${questionIndex + 1} of ${totalQ} [TIME'S UP]`)
    .setDescription(
      `### ${q.question}\n\n` +
      `${choicesList}\n\n` +
      `🎯 **Correct Choice:** Option ${q.correctIndex + 1}: **${q.options[q.correctIndex]}**`
    )
    .setFooter({ text: `${session.title} • Locked` });

  const buttonsRow = new ActionRowBuilder();
  q.options.forEach((opt, idx) => {
    buttonsRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`locked_${session.sessionId}_${questionIndex}_${idx}`)
        .setLabel(opt.slice(0, 70))
        .setEmoji(emojis[idx] || '🔹')
        .setStyle(idx === q.correctIndex ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(true)
    );
  });

  return { embeds: [embed], components: [buttonsRow] };
}

/**
 * Builds the Round Top 10 Leaderboard embed.
 */
function buildRoundLeaderboardEmbed(session, questionIndex) {
  const top10 = getSessionTop10(session);
  const totalQ = session.questions.length;
  const isLastQuestion = questionIndex + 1 >= totalQ;

  const medals = ['🥇', '🥈', '🥉'];
  let leaderboardText = '';

  if (top10.length === 0) {
    leaderboardText = '*No players scored points this round!*';
  } else {
    leaderboardText = top10
      .map((p, idx) => {
        const medal = medals[idx] || `**#${idx + 1}**`;
        return `${medal} <@${p.discordId}> — **${p.score.toLocaleString()} QP**`;
      })
      .join('\n');
  }

  const nextPhaseText = isLastQuestion
    ? `🏆 **Preparing Grand Finale Podium...**`
    : `⏳ Next Question begins in **${session.breakTimeSec} seconds**!`;

  return new EmbedBuilder()
    .setColor(0xffd166)
    .setTitle(`📊 Top 10 Leaderboard (After Round ${questionIndex + 1}/${totalQ})`)
    .setDescription(
      `**Current Tournament Standings:**\n\n` +
      `${leaderboardText}\n\n` +
      `${nextPhaseText}`
    )
    .setFooter({ text: `${session.title} • Live Standings` })
    .setTimestamp();
}

/**
 * Runs the live tournament game loop asynchronously.
 */
export async function startLiveQuiz(sessionId, channel, client) {
  const session = liveSessions.get(sessionId);
  if (!session) return;
  if (session.status !== 'setup') return;

  session.status = 'countdown';

  // 1. Initial Tournament Announcement & 10s Countdown
  const startEmbed = new EmbedBuilder()
    .setColor(0x9b5de5)
    .setTitle(`🚨 LIVE QUIZ SHOW STARTING!`)
    .setDescription(
      `## 🏆 ${session.title}\n\n` +
      `• **Total Questions:** **${session.questions.length}**\n` +
      `• **Time Per Question:** **${session.questionTimeSec}s**\n` +
      `• **Speed Bonus:** Faster answers = higher points!\n` +
      `• **Top 10 XP Bonus:** Top 10 finishers win bonus XP!\n\n` +
      `🏁 **First question appears in 10 seconds! Get ready!**`
    )
    .setFooter({ text: 'Questify Live Tournament Engine' });

  await channel.send({ embeds: [startEmbed] });
  await new Promise((r) => setTimeout(r, 10000));

  session.status = 'in_progress';

  // 2. Loop through all questions
  for (let i = 0; i < session.questions.length; i++) {
    session.currentQuestionIndex = i;
    session.currentQuestionStartTime = Date.now();
    session.currentQuestionEndTime = Date.now() + session.questionTimeSec * 1000;

    // Send question card with interactive buttons
    const questionPayload = buildLiveQuestionPayload(session, i);
    const questionMsg = await channel.send(questionPayload).catch(() => null);

    // Wait for question duration
    await new Promise((r) => setTimeout(r, session.questionTimeSec * 1000));

    // Lock the question message and reveal the answer
    if (questionMsg) {
      const lockedPayload = buildLockedQuestionPayload(session, i);
      await questionMsg.edit(lockedPayload).catch(() => null);
    }

    // Post Round Top 10 Leaderboard
    const lbEmbed = buildRoundLeaderboardEmbed(session, i);
    await channel.send({ embeds: [lbEmbed] }).catch(() => null);

    // Wait for intermission / break duration
    await new Promise((r) => setTimeout(r, session.breakTimeSec * 1000));
  }

  // 3. Grand Finale Podium & Top 10 Bonus XP Payout
  session.status = 'finished';
  const finalTop10 = getSessionTop10(session);

  // XP Bonus Distribution Table for Top 10
  // 1st: 100% of bonus
  // 2nd: 70%
  // 3rd: 50%
  // 4th-5th: 30%
  // 6th-10th: 20%
  const xpMultipliers = [1.0, 0.7, 0.5, 0.3, 0.3, 0.2, 0.2, 0.2, 0.2, 0.2];

  const medals = ['🥇', '🥈', '🥉'];
  let podiumText = '';

  for (let idx = 0; idx < finalTop10.length; idx++) {
    const p = finalTop10[idx];
    const medal = medals[idx] || `**#${idx + 1}**`;
    const bonusXp = Math.round(session.xpBonus * (xpMultipliers[idx] || 0.15));
    p.bonusXp = bonusXp;

    podiumText += `${medal} <@${p.discordId}> — **${p.score.toLocaleString()} QP** (+**${bonusXp} XP Bonus**)\n`;
  }

  if (!podiumText) {
    podiumText = '*No players scored points in this tournament.*';
  }

  const grandFinaleEmbed = new EmbedBuilder()
    .setColor(0x06d6a0)
    .setTitle(`🏆 GRAND FINALE: ${session.title}`)
    .setDescription(
      `🎉 **The Quiz Show has concluded!** Congratulations to all participants!\n\n` +
      `### 🎖️ Official Top 10 Winners & XP Bonuses:\n` +
      `${podiumText}\n\n` +
      `✨ All Quest Points (QP) and Top 10 XP Bonuses have been deposited directly into member accounts!`
    )
    .setFooter({ text: 'Questify Live Tournament • Match Complete' })
    .setTimestamp();

  await channel.send({ embeds: [grandFinaleEmbed] }).catch(() => null);

  // 4. Batch Deposit Points and XP into Supabase
  try {
    for (const [discordId, points] of session.playerScores.entries()) {
      if (points <= 0) continue;

      const topEntry = finalTop10.find((p) => p.discordId === discordId);
      const bonusXp = topEntry ? topEntry.bonusXp : 0;

      const { data: userRecord } = await supabase
        .from('users')
        .select('total_points, xp, level')
        .eq('guild_id', session.guildId)
        .eq('discord_id', discordId)
        .maybeSingle();

      const curPoints = Number(userRecord?.total_points || 0);
      const curXp = Number(userRecord?.xp || 0);
      const newPoints = curPoints + points;
      const newXp = curXp + bonusXp;
      const newLevel = getLevelFromXp(newXp);

      await supabase.from('users').upsert(
        {
          guild_id: session.guildId,
          discord_id: discordId,
          total_points: newPoints,
          xp: newXp,
          level: newLevel,
        },
        { onConflict: 'guild_id,discord_id' }
      );

      // Check level-up role reward if bonus XP was granted
      if (bonusXp > 0) {
        try {
          const guild = await client.guilds.fetch(session.guildId).catch(() => null);
          if (guild) {
            const member = await guild.members.fetch(discordId).catch(() => null);
            if (member) {
              const { data: roleRewards } = await supabase
                .from('level_role_rewards')
                .select('required_level, role_id')
                .eq('guild_id', session.guildId)
                .lte('required_level', newLevel);

              if (roleRewards && roleRewards.length > 0) {
                for (const rw of roleRewards) {
                  if (!member.roles.cache.has(rw.role_id)) {
                    await member.roles.add(rw.role_id).catch(() => null);
                  }
                }
              }
            }
          }
        } catch (e) {
          console.error('[LIVE QUIZ ROLE CHECK ERROR]:', e);
        }
      }
    }
  } catch (err) {
    console.error('[LIVE QUIZ PAYOUT ERROR]:', err);
  }
}
