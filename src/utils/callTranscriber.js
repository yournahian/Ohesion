import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

/**
 * Returns the currently active AI provider based on environment keys.
 * Priority: Groq (free & ultra-fast) -> Gemini (free) -> OpenAI (paid) -> null
 */
export function getActiveAiProvider() {
  if (config.groqApiKey || process.env.GROQ_API_KEY) return 'groq';
  if (config.geminiApiKey || process.env.GEMINI_API_KEY) return 'gemini';
  if (config.openaiApiKey || process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

/**
 * Formats seconds into MM:SS or HH:MM:SS timestamp
 */
export function formatTimestamp(seconds) {
  const totalSecs = Math.floor(seconds || 0);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Transcribe an individual audio file using Whisper (Groq / OpenAI) or Gemini
 * Returns an array of segments: [{ start: number, end: number, text: string }]
 */
export async function transcribeAudioFile(filePath, speakerName) {
  const provider = getActiveAiProvider();
  if (!provider) {
    console.warn(`[TRANSCRIBER] No AI API key found. Skipping transcription for ${speakerName}.`);
    return [];
  }

  if (!fs.existsSync(filePath)) {
    console.warn(`[TRANSCRIBER] File does not exist: ${filePath}`);
    return [];
  }

  const fileStats = fs.statSync(filePath);
  if (fileStats.size < 1000) {
    // Under 1KB is basically empty audio/silence
    return [];
  }

  try {
    if (provider === 'groq') {
      return await transcribeWithGroq(filePath, speakerName);
    } else if (provider === 'openai') {
      return await transcribeWithOpenAI(filePath, speakerName);
    } else if (provider === 'gemini') {
      return await transcribeWithGemini(filePath, speakerName);
    }
  } catch (err) {
    console.error(`[TRANSCRIBER ERROR] Failed to transcribe ${speakerName} with ${provider}:`, err.message);
    return [];
  }

  return [];
}

/**
 * Groq Whisper Transcription (Free tier: whisper-large-v3-turbo)
 */
async function transcribeWithGroq(filePath, speakerName) {
  const apiKey = config.groqApiKey || process.env.GROQ_API_KEY;
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  const formData = new FormData();
  formData.append('file', new Blob([fileBuffer], { type: 'audio/wav' }), fileName);
  formData.append('model', 'whisper-large-v3-turbo');
  formData.append('response_format', 'verbose_json');
  formData.append('temperature', '0');
  formData.append('prompt', 'বাংলা এবং ইংরেজি কথোপকথন। Transcribe in the exact spoken language (Bengali বাংলা script for Bengali speech, English for English terms). Do not translate to English.');

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API returned ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  if (data.segments && Array.isArray(data.segments)) {
    return data.segments.map((seg) => ({
      speaker: speakerName,
      start: seg.start,
      end: seg.end,
      text: seg.text.trim(),
    }));
  }

  // Fallback if segments is not returned
  return [
    {
      speaker: speakerName,
      start: 0,
      end: data.duration || 0,
      text: (data.text || '').trim(),
    },
  ];
}

/**
 * OpenAI Whisper Transcription (whisper-1)
 */
async function transcribeWithOpenAI(filePath, speakerName) {
  const apiKey = config.openaiApiKey || process.env.OPENAI_API_KEY;
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  const formData = new FormData();
  formData.append('file', new Blob([fileBuffer], { type: 'audio/wav' }), fileName);
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');
  formData.append('prompt', 'বাংলা এবং ইংরেজি কথোপকথন। Transcribe in the exact spoken language (Bengali বাংলা script for Bengali speech, English for English terms). Do not translate to English.');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API returned ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  if (data.segments && Array.isArray(data.segments)) {
    return data.segments.map((seg) => ({
      speaker: speakerName,
      start: seg.start,
      end: seg.end,
      text: seg.text.trim(),
    }));
  }

  return [
    {
      speaker: speakerName,
      start: 0,
      end: data.duration || 0,
      text: (data.text || '').trim(),
    },
  ];
}

/**
 * Google Gemini 1.5 Transcription
 */
async function transcribeWithGemini(filePath, speakerName) {
  const apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;
  const fileBuffer = fs.readFileSync(filePath);
  const base64Audio = fileBuffer.toString('base64');

  const prompt = `Transcribe this audio track for speaker "${speakerName}". Output JSON format with an array of segments: [{"start": 0.0, "end": 2.5, "text": "spoken words"}]. Respond only with valid JSON.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: 'audio/wav',
                  data: base64Audio,
                },
              },
            ],
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API returned ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const textOutput = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  try {
    const cleaned = textOutput.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const segs = Array.isArray(parsed) ? parsed : parsed.segments || [];
    return segs.map((s) => ({
      speaker: speakerName,
      start: s.start || 0,
      end: s.end || 0,
      text: (s.text || '').trim(),
    }));
  } catch {
    return [
      {
        speaker: speakerName,
        start: 0,
        end: 0,
        text: textOutput.trim(),
      },
    ];
  }
}

/**
 * Build a chronological, beautifully formatted podcast dialogue script
 * Combines all speaker tracks and sorts chronologically by start timestamp.
 */
export function buildChronologicalScript(speakerTracks, sessionMeta = {}) {
  // speakerTracks is array of arrays: [{ speaker, start, end, text }, ...]
  const allSegments = [];
  for (const track of speakerTracks) {
    if (Array.isArray(track)) {
      allSegments.push(...track);
    }
  }

  // Sort by start timestamp
  allSegments.sort((a, b) => a.start - b.start);

  if (allSegments.length === 0) {
    return '# Podcast Call Transcript\n\n*No spoken dialogue detected in this recording session.*';
  }

  const durationStr = formatTimestamp(sessionMeta.durationSeconds || 0);
  const dateStr = new Date(sessionMeta.startedAt || Date.now()).toLocaleString();

  let script = `# 🎙️ Podcast Transcript & Dialogue Script\n\n`;
  script += `**Channel:** #${sessionMeta.channelName || 'Voice Channel'}\n`;
  script += `**Recorded At:** ${dateStr}\n`;
  script += `**Total Duration:** ${durationStr}\n`;
  script += `**Speakers:** ${Array.from(new Set(allSegments.map((s) => s.speaker))).join(', ')}\n\n`;
  script += `---\n\n## Dialogue Log\n\n`;

  let currentSpeaker = null;
  let currentParagraph = [];
  let currentStart = 0;

  for (const seg of allSegments) {
    if (!seg.text) continue;

    if (seg.speaker !== currentSpeaker) {
      if (currentParagraph.length > 0) {
        script += `**[${formatTimestamp(currentStart)}] ${currentSpeaker}:**\n> ${currentParagraph.join(' ')}\n\n`;
      }
      currentSpeaker = seg.speaker;
      currentParagraph = [seg.text];
      currentStart = seg.start;
    } else {
      currentParagraph.push(seg.text);
    }
  }

  if (currentParagraph.length > 0) {
    script += `**[${formatTimestamp(currentStart)}] ${currentSpeaker}:**\n> ${currentParagraph.join(' ')}\n\n`;
  }

  return script;
}

/**
 * Generate Executive Meeting Notes, Timelines, and Action Items from the script
 */
export async function generateMeetingNotesAndTimelines(scriptText, sessionMeta = {}) {
  const provider = getActiveAiProvider();
  if (!provider) {
    return {
      summary: 'Executive summary not generated (No AI API key configured).',
      timeline: 'Timeline not generated.',
      actionItems: [],
      fullMarkdown: `# Meeting Notes\n\n*No AI API key configured to generate meeting summary.*`,
    };
  }

  const prompt = `You are an elite podcast producer and executive assistant.
Analyze the following recorded call/podcast dialogue transcript and produce a high-impact, professional briefing.
Important Language Guideline: Match the primary language used in the transcript. If the dialogue is in Bengali (বাংলা), write the Executive Summary, Agenda, and Action Items in natural Bengali (বাংলা) while preserving English terms (e.g., Discord, Quest, Marketplace). If in English, write in English.

Format your response in clean Markdown with exactly these three sections:

## 📌 Executive Summary
A concise, punchy 2-4 sentence summary of what took place, the main topics discussed, and overall sentiment.

## ⏱️ Timestamped Agenda & Timeline
A clean bulleted list of key topic transitions with timestamps (e.g., • [00:01] Welcome & Introductions).

## ✅ Action Items & Decisions
A Markdown task checklist format of clear, assigned action items, follow-ups, and key decisions made (e.g., • [ ] Nahian to follow up on marketing graphics by Tuesday).

Transcript:
"""
${scriptText.slice(0, 30000)}
"""`;

  try {
    let aiResponse = '';
    if (provider === 'groq') {
      const apiKey = config.groqApiKey || process.env.GROQ_API_KEY;
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 1500,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        aiResponse = json?.choices?.[0]?.message?.content || '';
      }
    } else if (provider === 'openai') {
      const apiKey = config.openaiApiKey || process.env.OPENAI_API_KEY;
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        aiResponse = json?.choices?.[0]?.message?.content || '';
      }
    } else if (provider === 'gemini') {
      const apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
          }),
        }
      );
      if (res.ok) {
        const json = await res.json();
        aiResponse = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }
    }

    if (!aiResponse) {
      aiResponse = `## 📌 Executive Summary\nCall completed successfully.\n\n## ⏱️ Timestamped Agenda & Timeline\n• [00:00] Call Session\n\n## ✅ Action Items & Decisions\n• [ ] Review recorded stems`;
    }

    const durationStr = formatTimestamp(sessionMeta.durationSeconds || 0);
    const dateStr = new Date(sessionMeta.startedAt || Date.now()).toLocaleString();

    const fullMarkdown = `# 📋 Meeting Notes & Action Briefing\n\n` +
      `**Channel:** #${sessionMeta.channelName || 'Voice Channel'}\n` +
      `**Session Date:** ${dateStr}\n` +
      `**Duration:** ${durationStr}\n\n` +
      `---\n\n` +
      aiResponse;

    return {
      aiContent: aiResponse,
      fullMarkdown,
    };
  } catch (err) {
    console.error('[AI SUMMARY ERROR]:', err);
    return {
      aiContent: 'Failed to generate summary due to API error.',
      fullMarkdown: `# Meeting Notes\n\nFailed to generate summary: ${err.message}`,
    };
  }
}
