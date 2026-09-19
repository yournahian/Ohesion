import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  EndBehaviorType,
  entersState,
  createAudioPlayer,
  createAudioResource,
  StreamType,
} from '@discordjs/voice';
import { Readable } from 'node:stream';
import {
  getActiveAiProvider,
  transcribeAudioFile,
  buildChronologicalScript,
  generateMeetingNotesAndTimelines,
  formatTimestamp,
} from './callTranscriber.js';
import { config } from '../config.js';

const require = createRequire(import.meta.url);
const prism = require('prism-media');
const archiver = require('archiver');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

// Configure ffmpeg static binary
if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

/**
 * Paced Opus silence stream (20ms interval) to keep the Discord UDP voice socket alive
 * This ensures Discord routes all incoming speaker audio packets to the bot receiver.
 */
class SilenceStream extends Readable {
  _read() {
    setTimeout(() => {
      this.push(Buffer.from([0xf8, 0xff, 0xfe]));
    }, 20);
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RECORDINGS_BASE_DIR = path.join(__dirname, '..', 'data', 'recordings');

// Active recording sessions: guildId -> RecordingSession
const activeSessions = new Map();

// 48,000 Hz, 16-bit, Stereo = 4 bytes per sample (Left 16-bit + Right 16-bit)
// 1 second = 48,000 * 4 = 192,000 bytes
// 1 Opus frame = 20ms = 960 samples = 960 * 4 = 3,840 bytes
const FRAME_BYTES = 3840;
const FRAME_MS = 20;

/**
 * Creates a standard 44-byte WAV header for 48kHz, 16-bit, stereo PCM audio
 */
function createWavHeader(dataLength, sampleRate = 48000, channels = 2, bitDepth = 16) {
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bitDepth) / 8;
  const blockAlign = (channels * bitDepth) / 8;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20); // audioFormat (1 for PCM)
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
}

/**
 * Convert raw PCM file to standard WAV file by prepending WAV header
 */
function pcmToWav(pcmFilePath, wavFilePath) {
  if (!fs.existsSync(pcmFilePath)) return;
  const stats = fs.statSync(pcmFilePath);
  const pcmData = fs.readFileSync(pcmFilePath);
  const wavHeader = createWavHeader(stats.size);
  const wavFile = Buffer.concat([wavHeader, pcmData]);
  fs.writeFileSync(wavFilePath, wavFile);
}

/**
 * Sets up a permanent, studio-grade audio decoder stream for a speaker.
 * Maintains one persistent decoder per user to preserve Opus prediction filters
 * and pads silence in exact 20ms frame multiples (3,840 bytes) to prevent byte misalignment.
 */
function setupSpeakerStream(session, user) {
  const userId = user.id;
  if (session.speakers.has(userId) || session.isStopping) return;

  const username = user.username || `User_${userId.slice(-4)}`;
  const sanitizedUsername = username.replace(/[^a-zA-Z0-9_-]/g, '_');
  const pcmPath = path.join(session.sessionDir, `${sanitizedUsername}.pcm`);
  const wavPath = path.join(session.sessionDir, `${sanitizedUsername}.wav`);

  const fileStream = fs.createWriteStream(pcmPath);

  let opusStream;
  try {
    // Subscribe ONCE with EndBehaviorType.Manual so stream stays open for the whole session
    opusStream = session.receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.Manual,
      },
    });
  } catch (err) {
    console.warn(`[SUBSCRIBE ERROR] (${username}):`, err.message);
    return;
  }

  // Create ONE persistent decoder for the entire recording session
  const decoder = new prism.opus.Decoder({
    rate: 48000,
    channels: 2,
    frameSize: 960,
  });

  const speaker = {
    userId,
    username,
    sanitizedUsername,
    pcmPath,
    wavPath,
    writtenBytes: 0,
    lastChunkTime: null,
    fileStream,
    opusStream,
    decoder,
  };

  session.speakers.set(userId, speaker);

  opusStream.pipe(decoder);

  decoder.on('data', (pcmChunk) => {
    if (session.isStopping) return;

    const now = Date.now();

    if (!speaker.lastChunkTime) {
      // First audio chunk: pad silence from session start up to this moment
      const elapsedMs = Math.max(0, now - session.startedAt);
      const initialFrames = Math.floor(elapsedMs / FRAME_MS);
      if (initialFrames > 0 && initialFrames < 18000) {
        const initialSilence = Buffer.alloc(initialFrames * FRAME_BYTES);
        speaker.fileStream.write(initialSilence);
        speaker.writtenBytes += initialSilence.length;
      }
    } else {
      // Subsequent audio chunk: check if there was a pause between words/sentences
      const gapMs = now - speaker.lastChunkTime;
      if (gapMs > 35) { // gap > 1.5 frames
        const missingFrames = Math.floor((gapMs - FRAME_MS) / FRAME_MS);
        if (missingFrames > 0 && missingFrames < 18000) {
          const gapSilence = Buffer.alloc(missingFrames * FRAME_BYTES);
          speaker.fileStream.write(gapSilence);
          speaker.writtenBytes += gapSilence.length;
        }
      }
    }

    speaker.lastChunkTime = now;
    speaker.fileStream.write(pcmChunk);
    speaker.writtenBytes += pcmChunk.length;
  });

  decoder.on('error', (err) => {
    console.warn(`[AUDIO DECODER ERROR] (${username}):`, err.message);
  });

  opusStream.on('error', (err) => {
    console.warn(`[OPUS STREAM ERROR] (${username}):`, err.message);
  });
}

/**
 * Starts a multi-track recording session in a voice channel
 */
export async function startRecording({ voiceChannel, client, mode = 'both', initiatedBy }) {
  const guildId = voiceChannel.guild.id;

  if (activeSessions.has(guildId)) {
    throw new Error('A recording session is already active in this server!');
  }

  const sessionId = `rec_${Date.now()}_${guildId.slice(-4)}`;
  const sessionDir = path.join(RECORDINGS_BASE_DIR, sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false, // Must be false so Discord keeps 2-way UDP socket active
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15000);
  } catch (err) {
    connection.destroy();
    fs.rmSync(sessionDir, { recursive: true, force: true });
    throw new Error('Failed to connect to the voice channel within 15 seconds.');
  }

  // Start continuous 20ms silence frame keep-alive player
  const silencePlayer = createAudioPlayer();
  const silenceResource = createAudioResource(new SilenceStream(), {
    inputType: StreamType.Opus,
  });
  silencePlayer.play(silenceResource);
  connection.subscribe(silencePlayer);

  const session = {
    sessionId,
    guildId,
    channelId: voiceChannel.id,
    channelName: voiceChannel.name,
    startedAt: Date.now(),
    mode, // 'both' | 'audio' | 'script'
    initiatedBy: initiatedBy.username || 'Admin',
    initiatedById: initiatedBy.id,
    sessionDir,
    connection,
    silencePlayer,
    receiver: connection.receiver,
    speakers: new Map(), // userId -> speaker
    isStopping: false,
  };

  // Pre-subscribe to all members currently in the voice channel
  for (const [, member] of voiceChannel.members.entries()) {
    if (member.user && !member.user.bot) {
      setupSpeakerStream(session, member.user);
    }
  }

  // Subscribe to any member who starts speaking or joins later
  session.receiver.speaking.on('start', (userId) => {
    if (session.isStopping) return;
    if (session.speakers.has(userId)) return;

    const member = voiceChannel.guild.members.cache.get(userId);
    const user = member?.user || { id: userId, username: `User_${userId.slice(-4)}` };
    if (user.bot) return;

    setupSpeakerStream(session, user);
  });

  // Handle unexpected disconnects
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5000),
      ]);
    } catch {
      console.warn(`[AUDIO RECORDER] Bot disconnected from voice channel in guild ${guildId}`);
      if (activeSessions.has(guildId)) {
        stopRecording(guildId).catch((e) => console.error('[AUTO-STOP ERROR]:', e));
      }
    }
  });

  activeSessions.set(guildId, session);
  return session;
}

/**
 * Mix multiple WAV files into a single Master MP3 using FFmpeg amix with normalize=0
 * to prevent volume attenuation when multiple speakers are present.
 */
async function mixMasterTrack(inputWavs, outputMp3Path) {
  return new Promise((resolve, reject) => {
    if (inputWavs.length === 0) {
      return reject(new Error('No audio tracks to mix'));
    }

    if (inputWavs.length === 1) {
      ffmpeg(inputWavs[0])
        .audioCodec('libmp3lame')
        .audioBitrate('128k')
        .save(outputMp3Path)
        .on('end', () => resolve(outputMp3Path))
        .on('error', (err) => reject(err));
      return;
    }

    // Multiple speakers: combine with amix filter with normalize=0 so volume is NOT divided by N
    const command = ffmpeg();
    for (const wav of inputWavs) {
      command.input(wav);
    }

    command
      .complexFilter([
        {
          filter: 'amix',
          options: {
            inputs: inputWavs.length,
            duration: 'longest',
            normalize: 0,
          },
        },
      ])
      .audioCodec('libmp3lame')
      .audioBitrate('128k')
      .save(outputMp3Path)
      .on('end', () => resolve(outputMp3Path))
      .on('error', (err) => reject(err));
  });
}

/**
 * Packages audio files into a zip archive
 */
async function createZipBundle(filesToZip, outputZipPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputZipPath);
    const archive = typeof archiver === 'function'
      ? archiver('zip', { zlib: { level: 6 } })
      : new archiver.ZipArchive({ zlib: { level: 6 } });

    output.on('close', () => resolve(outputZipPath));
    archive.on('error', (err) => reject(err));

    archive.pipe(output);

    for (const f of filesToZip) {
      if (fs.existsSync(f.path)) {
        archive.file(f.path, { name: f.name });
      }
    }

    archive.finalize();
  });
}

/**
 * Stops an active recording session, mixes audio, performs AI transcription, and packages deliverables
 */
export async function stopRecording(guildId) {
  const session = activeSessions.get(guildId);
  if (!session) {
    throw new Error('No active recording session found in this server.');
  }

  session.isStopping = true;
  activeSessions.delete(guildId);

  // Stop silence keep-alive player
  if (session.silencePlayer) {
    try {
      session.silencePlayer.stop();
    } catch {}
  }

  // Destroy Discord voice connection
  try {
    session.connection.destroy();
  } catch (err) {
    console.warn('[VOICE DESTROY ERROR]:', err.message);
  }

  const durationSeconds = Math.max(1, Math.round((Date.now() - session.startedAt) / 1000));
  const targetTotalBytes = durationSeconds * 192000;

  // Finalize all speaker streams with frame-aligned tail silence
  const wavFiles = [];
  const speakersData = [];

  for (const [, speaker] of session.speakers.entries()) {
    try {
      if (speaker.opusStream) speaker.opusStream.destroy();
      if (speaker.decoder) speaker.decoder.destroy();

      if (targetTotalBytes > speaker.writtenBytes) {
        const remainingBytes = targetTotalBytes - speaker.writtenBytes;
        const tailFrames = Math.floor(remainingBytes / FRAME_BYTES);
        if (tailFrames > 0 && tailFrames < 18000) {
          const tailSilence = Buffer.alloc(tailFrames * FRAME_BYTES);
          speaker.fileStream.write(tailSilence);
          speaker.writtenBytes += tailSilence.length;
        }
      }
      speaker.fileStream.end();
    } catch (err) {
      console.warn(`[STREAM CLOSE ERROR] ${speaker.username}:`, err.message);
    }

    // Wait a brief moment for streams to flush, then convert PCM to WAV
    await new Promise((r) => setTimeout(r, 200));

    try {
      pcmToWav(speaker.pcmPath, speaker.wavPath);
      if (fs.existsSync(speaker.wavPath) && fs.statSync(speaker.wavPath).size > 44) {
        wavFiles.push(speaker.wavPath);
        speakersData.push({
          userId: speaker.userId,
          username: speaker.username,
          wavPath: speaker.wavPath,
          pcmPath: speaker.pcmPath,
        });
      }
    } catch (err) {
      console.warn(`[PCM TO WAV ERROR] ${speaker.username}:`, err.message);
    }
  }

  const sessionMeta = {
    sessionId: session.sessionId,
    channelId: session.channelId,
    channelName: session.channelName,
    startedAt: session.startedAt,
    durationSeconds,
    durationFormatted: formatTimestamp(durationSeconds),
    speakers: speakersData.map((s) => s.username),
    mode: session.mode,
    aiProvider: getActiveAiProvider(),
  };

  const DISCORD_MAX_BYTES = 24.5 * 1024 * 1024; // 24.5MB threshold for standard Discord bot upload limits

  function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const deliverables = {
    sessionMeta,
    masterMp3Path: null,
    stemsZipPath: null,
    scriptPath: null,
    notesPath: null,
    dialogueScript: '',
    meetingNotesMarkdown: '',
    filesToAttach: [],
    largeFiles: [],
    webDownloads: [],
  };

  function registerDeliverable(filePath, displayName) {
    if (!filePath || !fs.existsSync(filePath)) return;
    const stat = fs.statSync(filePath);
    const filename = path.basename(filePath);
    const downloadUrl = `${config.baseUrl}/download/${session.sessionId}/${encodeURIComponent(filename)}`;
    const isOversized = stat.size > DISCORD_MAX_BYTES;

    const fileMeta = {
      filename,
      displayName,
      filePath,
      sizeBytes: stat.size,
      sizeFormatted: formatFileSize(stat.size),
      downloadUrl,
      isOversized,
    };

    deliverables.webDownloads.push(fileMeta);

    if (isOversized) {
      deliverables.largeFiles.push(fileMeta);
    } else {
      deliverables.filesToAttach.push(filePath);
    }
  }

  // 1. Audio Processing (mix master track)
  const masterMp3Path = path.join(session.sessionDir, 'Master_Podcast_Mix.mp3');
  if (wavFiles.length > 0) {
    try {
      await mixMasterTrack(wavFiles, masterMp3Path);
      deliverables.masterMp3Path = masterMp3Path;
    } catch (err) {
      console.warn('[FFMPEG MIX ERROR]:', err.message);
    }
  }

  // 2. Multi-track stems zip package
  if (session.mode === 'audio' || session.mode === 'both') {
    if (wavFiles.length > 0) {
      const stemsZipPath = path.join(session.sessionDir, 'MultiTrack_Stems.zip');
      const filesToZip = speakersData.map((s) => ({
        path: s.wavPath,
        name: `${s.username}.wav`,
      }));
      if (deliverables.masterMp3Path && fs.existsSync(deliverables.masterMp3Path)) {
        filesToZip.push({
          path: deliverables.masterMp3Path,
          name: 'Master_Podcast_Mix.mp3',
        });
      }

      try {
        await createZipBundle(filesToZip, stemsZipPath);
        deliverables.stemsZipPath = stemsZipPath;
      } catch (err) {
        console.warn('[ZIP BUNDLE ERROR]:', err.message);
      }
    }
  }

  // 3. AI Transcription and Script Generation (if mode is 'script' or 'both')
  if (session.mode === 'script' || session.mode === 'both') {
    const aiProvider = getActiveAiProvider();

    if (aiProvider && speakersData.length > 0) {
      console.log(`[RECORDER] Running AI Transcription with provider: ${aiProvider}...`);
      const speakerTranscripts = [];

      for (const spk of speakersData) {
        const segments = await transcribeAudioFile(spk.wavPath, spk.username);
        speakerTranscripts.push(segments);
      }

      // Generate chronological dialogue script
      const dialogueScript = buildChronologicalScript(speakerTranscripts, sessionMeta);
      deliverables.dialogueScript = dialogueScript;

      const scriptPath = path.join(session.sessionDir, 'Script_Transcript.md');
      fs.writeFileSync(scriptPath, dialogueScript, 'utf8');
      deliverables.scriptPath = scriptPath;

      // Generate Executive Meeting Notes & Action Items
      const notesResult = await generateMeetingNotesAndTimelines(dialogueScript, sessionMeta);
      deliverables.meetingNotesMarkdown = notesResult.fullMarkdown;

      const notesPath = path.join(session.sessionDir, 'Meeting_Notes.md');
      fs.writeFileSync(notesPath, notesResult.fullMarkdown, 'utf8');
      deliverables.notesPath = notesPath;
    } else if (!aiProvider && session.mode === 'script') {
      deliverables.dialogueScript = '# Transcript Unavailable\n\nNo AI API key (GROQ_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY) was configured in .env.';
      deliverables.meetingNotesMarkdown = deliverables.dialogueScript;
    }
  }

  // 4. Assemble files: files <= 24.5MB attached directly, files > 24.5MB served via web download
  if (session.mode === 'both' || session.mode === 'audio') {
    if (deliverables.masterMp3Path) {
      registerDeliverable(deliverables.masterMp3Path, 'Master_Podcast_Mix.mp3');
    }
    if (deliverables.stemsZipPath) {
      registerDeliverable(deliverables.stemsZipPath, 'MultiTrack_Stems.zip');
    }
  }

  if (session.mode === 'both' || session.mode === 'script') {
    if (deliverables.scriptPath) {
      registerDeliverable(deliverables.scriptPath, 'Script_Transcript.md');
    }
    if (deliverables.notesPath) {
      registerDeliverable(deliverables.notesPath, 'Meeting_Notes.md');
    }

    // If script only mode: clean up raw heavy WAV and MP3 files to conserve disk space
    if (session.mode === 'script') {
      for (const spk of speakersData) {
        if (fs.existsSync(spk.wavPath)) fs.rmSync(spk.wavPath, { force: true });
        if (fs.existsSync(spk.pcmPath)) fs.rmSync(spk.pcmPath, { force: true });
      }
      if (deliverables.masterMp3Path && fs.existsSync(deliverables.masterMp3Path)) {
        fs.rmSync(deliverables.masterMp3Path, { force: true });
      }
    }
  }

  return deliverables;
}

/**
 * Get the current status of an active recording session
 */
export function getRecordingStatus(guildId) {
  const session = activeSessions.get(guildId);
  if (!session) return null;

  const durationSeconds = Math.round((Date.now() - session.startedAt) / 1000);
  const activeSpeakers = Array.from(session.speakers.values()).map((s) => s.username);

  return {
    sessionId: session.sessionId,
    channelId: session.channelId,
    channelName: session.channelName,
    startedAt: session.startedAt,
    durationSeconds,
    durationFormatted: formatTimestamp(durationSeconds),
    mode: session.mode,
    speakersCount: session.speakers.size,
    speakers: activeSpeakers,
    initiatedBy: session.initiatedBy,
    initiatedById: session.initiatedById,
  };
}

/**
 * Cancel and discard an active recording session without processing
 */
export function cancelRecording(guildId) {
  const session = activeSessions.get(guildId);
  if (!session) return false;

  session.isStopping = true;
  activeSessions.delete(guildId);

  if (session.silencePlayer) {
    try {
      session.silencePlayer.stop();
    } catch {}
  }

  for (const speaker of session.speakers.values()) {
    try {
      if (speaker.opusStream) speaker.opusStream.destroy();
      if (speaker.decoder) speaker.decoder.destroy();
      speaker.fileStream.end();
    } catch {}
  }

  try {
    session.connection.destroy();
  } catch {}

  try {
    fs.rmSync(session.sessionDir, { recursive: true, force: true });
  } catch {}

  return true;
}
