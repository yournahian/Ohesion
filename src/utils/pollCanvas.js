import { createCanvas } from '@napi-rs/canvas';
import { parsePollOption } from './pollManager.js';

/**
 * Formats time remaining into clean text (e.g. "24 Hours Left", "45 Minutes Left", "Poll Ended")
 */
export function formatTimeRemaining(expiresAt) {
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (diffMs <= 0) return 'Poll Ended';

  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
  const totalDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (totalDays >= 1) {
    return `${totalDays} Day${totalDays > 1 ? 's' : ''} Left`;
  } else if (totalHours >= 1) {
    return `${totalHours} Hour${totalHours > 1 ? 's' : ''} Left`;
  } else if (totalMinutes >= 1) {
    return `${totalMinutes} Minute${totalMinutes > 1 ? 's' : ''} Left`;
  }
  return 'Ending Soon';
}

/**
 * Renders the visual Poll Card matching Discord's official poll UI (as shown in the screenshot).
 * Features rounded pill bars, gradient fill progress (#4e75ff -> #9b6bff), and status footer.
 */
export function generatePollImage(poll, voteCounts, totalVotes, showResults = true) {
  const isExpired = Date.now() > new Date(poll.expires_at).getTime();
  const width = 640;
  const paddingX = 24;
  const paddingTop = 26;
  const paddingBottom = 24;
  const barHeight = 46;
  const barGap = 10;

  // Title wrapping logic
  const dummyCanvas = createCanvas(width, 100);
  const dummyCtx = dummyCanvas.getContext('2d');
  dummyCtx.font = 'bold 22px "Segoe UI", Whitney, "Helvetica Neue", sans-serif';

  const words = (poll.question || '').split(' ');
  const titleLines = [];
  let currentLine = '';
  const maxTitleWidth = width - (paddingX * 2);

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = dummyCtx.measureText(testLine).width;
    if (testWidth > maxTitleWidth && currentLine) {
      titleLines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) titleLines.push(currentLine);
  if (titleLines.length === 0) titleLines.push('Community Poll');

  const titleLineHeight = 30;
  const titleTotalHeight = titleLines.length * titleLineHeight;

  const totalOptions = poll.options.length;
  const height =
    paddingTop +
    titleTotalHeight +
    16 +
    (totalOptions * (barHeight + barGap)) +
    26 +
    paddingBottom;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background - Discord native dark #1e1f22
  ctx.fillStyle = '#1e1f22';
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, 12);
  ctx.fill();

  // Draw Title
  ctx.fillStyle = '#f2f3f5';
  ctx.font = 'bold 22px "Segoe UI", Whitney, "Helvetica Neue", sans-serif';
  let titleY = paddingTop + 20;
  for (const line of titleLines) {
    ctx.fillText(line, paddingX, titleY);
    titleY += titleLineHeight;
  }

  let curY = paddingTop + titleTotalHeight + 16;
  const barWidth = width - (paddingX * 2);

  // Render each option pill
  for (let idx = 0; idx < totalOptions; idx++) {
    const rawOpt = poll.options[idx];
    const parsed = parsePollOption(rawOpt, idx);
    const count = voteCounts[idx] || 0;
    const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;

    // Dark pill container #2b2d31
    ctx.fillStyle = '#2b2d31';
    ctx.beginPath();
    ctx.roundRect(paddingX, curY, barWidth, barHeight, 8);
    ctx.fill();

    // Progress bar gradient fill
    if (showResults && pct > 0) {
      const fillW = Math.max(16, (barWidth * pct) / 100);
      const grad = ctx.createLinearGradient(paddingX, curY, paddingX + fillW, curY);
      grad.addColorStop(0, '#4e75ff'); // Discord blurple
      grad.addColorStop(1, '#9b6bff'); // Discord purple/magenta
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(paddingX, curY, fillW, barHeight, 8);
      ctx.fill();
    }

    // Text: e.g. "Discord - 30%" or just "Discord" if results hidden
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px "Segoe UI", Whitney, "Helvetica Neue", sans-serif';

    const textToDraw = showResults
      ? `${parsed.label} - ${pct}%`
      : `${parsed.label}`;

    // Truncate text if it would overflow the bar
    let displayText = textToDraw;
    while (ctx.measureText(displayText).width > barWidth - 32 && displayText.length > 5) {
      displayText = displayText.slice(0, -4) + '...';
    }

    ctx.fillText(displayText, paddingX + 16, curY + 28);

    curY += barHeight + barGap;
  }

  // Footer: e.g. "24 Hours Left - 7 Answers"
  const timeRemaining = formatTimeRemaining(poll.expires_at);
  const answersText = `${totalVotes.toLocaleString()} Answer${totalVotes === 1 ? '' : 's'}`;

  let footerText = `${timeRemaining} - ${answersText}`;
  if (!showResults && !isExpired) {
    footerText += ' • 🔒 Results hidden until poll ends';
  }
  if (poll.reward_points > 0 || poll.reward_xp > 0) {
    footerText += ` • 🎁 +${poll.reward_points || 0} QP & +${poll.reward_xp || 0} XP`;
  }

  ctx.fillStyle = '#949ba4';
  ctx.font = '500 14px "Segoe UI", Whitney, "Helvetica Neue", sans-serif';
  ctx.fillText(footerText, paddingX, curY + 16);

  return canvas.toBuffer('image/png');
}
