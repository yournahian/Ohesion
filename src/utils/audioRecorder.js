import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  EndBehaviorType,
  entersState,
} from '@discordjs/voice';
import {
  getActiveAiProvider,
  transcribeAudioFile,
  buildChronologicalScript,
  generateMeetingNotesAndTimelines,
  formatTimestamp,
} from './callTranscriber.js';

const require = createRequire(import.meta.url);
const prism = require('prism-media');
const archiver = require('archiver');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

// Configure ffmpeg static binary
if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RECORDINGS_BASE_DIR = path.join(__dirname, '..', 'data', 'recordings');

// Active recording sessions: guildId -> RecordingSession
const activeSessions = new Map();

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
    selfMute: true,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15000);
  } catch (err) {
    connection.destroy();
    fs.rmSync(sessionDir, { recursive: true, force: true });
    throw new Error('Failed to connect to the voice channel within 15 seconds.');
  }

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
    receiver: connection.receiver,
    speakers: new Map(), // userId -> { username, displayName, pcmPath, wavPath, writtenBytes, fileStream }
    activeSubscriptions: new Set(),
    isStopping: false,
  };

  const BYTES_PER_SECOND = 48000 * 2 * 2; // 48kHz * 2 channels * 2 bytes = 192,000 bytes/sec

  // Listen to speaking events
  session.receiver.speaking.on('start', (userId) => {
    if (session.isStopping) return;
    if (session.activeSubscriptions.has(userId)) return;

    // Fetch user details
    const member = voiceChannel.guild.members.cache.get(userId);
    const username = member?.user?.username || `User_${userId.slice(-4)}`;
    const sanitizedUsername = username.replace(/[^a-zA-Z0-9_-]/g, '_');

    let speaker = session.speakers.get(userId);
    if (!speaker) {
      const pcmPath = path.join(sessionDir, `${sanitizedUsername}.pcm`);
      const wavPath = path.join(sessionDir, `${sanitizedUsername}.wav`);
      speaker = {
        userId,
        username,
        sanitizedUsername,
        pcmPath,
        wavPath,
        writtenBytes: 0,
        fileStream: fs.createWriteStream(pcmPath, { flags: 'a' }),
      };
      session.speakers.set(userId, speaker);
    }

    // Time alignment padding: fill silence from beginning of recording up to this moment
    const elapsedSeconds = (Date.now() - session.startedAt) / 1000;
    const expectedBytes = Math.floor(elapsedSeconds * BYTES_PER_SECOND);
    if (expectedBytes > speaker.writtenBytes) {
      let remainingSilence = expectedBytes - speaker.writtenBytes;
      while (remainingSilence > 0) {
        const chunkSize = Math.min(remainingSilence, BYTES_PER_SECOND * 10);
        speaker.fileStream.write(Buffer.alloc(chunkSize));
        speaker.writtenBytes += chunkSize;
        remainingSilence -= chunkSize;
      }
    }

    session.activeSubscriptions.add(userId);

    try {
      // Subscribe to Opus audio stream
      const opusStream = session.receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 1000,
        },
      });

      const decoder = new prism.opus.Decoder({
        rate: 48000,
        channels: 2,
        frameSize: 960,
      });

      opusStream.pipe(decoder);

      decoder.on('data', (pcmChunk) => {
        if (session.isStopping) return;
        speaker.fileStream.write(pcmChunk);
        speaker.writtenBytes += pcmChunk.length;
      });

      decoder.on('error', (err) => {
        console.warn(`[AUDIO DECODER ERROR] (${username}):`, err.message);
      });

      opusStream.on('error', (err) => {
        console.warn(`[OPUS STREAM ERROR] (${username}):`, err.message);
        session.activeSubscriptions.delete(userId);
      });

      opusStream.on('end', () => {
        session.activeSubscriptions.delete(userId);
      });
    } catch (decoderErr) {
      console.error(`[AUDIO DECODER INIT ERROR] (${username}):`, decoderErr);
      session.activeSubscriptions.delete(userId);
    }
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
 * Mix multiple WAV files into a single Master MP3 using FFmpeg amix
 */
async function mixMasterTrack(inputWavs, outputMp3Path) {
  return new Promise((resolve, reject) => {
    if (inputWavs.length === 0) {
      return reject(new Error('No audio tracks to mix'));
    }

    if (inputWavs.length === 1) {
      // Single speaker: direct encode to MP3
      ffmpeg(inputWavs[0])
        .audioCodec('libmp3lame')
        .audioBitrate('192k')
        .save(outputMp3Path)
        .on('end', () => resolve(outputMp3Path))
        .on('error', (err) => reject(err));
      return;
    }

    // Multiple speakers: combine with amix filter
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
            dropout_transition: 2,
          },
        },
      ])
      .audioCodec('libmp3lame')
      .audioBitrate('192k')
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

  const durationSeconds = Math.max(1, Math.round((Date.now() - session.startedAt) / 1000));
  const BYTES_PER_SECOND = 48000 * 2 * 2;
  const targetTotalBytes = durationSeconds * BYTES_PER_SECOND;

  // Finalize all speaker streams with tail silence padding to ensure identical duration
  const wavFiles = [];
  const speakersData = [];

  for (const [userId, speaker] of session.speakers.entries()) {
    try {
      if (targetTotalBytes > speaker.writtenBytes) {
        const remainingSilence = targetTotalBytes - speaker.writtenBytes;
        const silence = Buffer.alloc(Math.min(remainingSilence, BYTES_PER_SECOND * 120));
        speaker.fileStream.write(silence);
        speaker.writtenBytes += remainingSilence;
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
          userId,
          username: speaker.username,
          wavPath: speaker.wavPath,
        });
      }
    } catch (err) {
      console.warn(`[PCM TO WAV ERROR] ${speaker.username}:`, err.message);
    }
  }

  // Destroy Discord voice connection
  try {
    session.connection.destroy();
  } catch (err) {
    console.warn('[VOICE DESTROY ERROR]:', err.message);
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

  const deliverables = {
    sessionMeta,
    masterMp3Path: null,
    stemsZipPath: null,
    scriptPath: null,
    notesPath: null,
    dialogueScript: '',
    meetingNotesMarkdown: '',
    filesToAttach: [],
  };

  // 1. Audio Processing (if mode is 'audio' or 'both', or needed for transcription in 'script')
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
      // Admin asked for script only, but no AI key was set
      deliverables.dialogueScript = '# Transcript Unavailable\n\nNo AI API key (GROQ_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY) was configured in .env.';
      deliverables.meetingNotesMarkdown = deliverables.dialogueScript;
    }
  }

  // 4. Assemble files to attach to Discord message
  if (session.mode === 'both' || session.mode === 'audio') {
    if (deliverables.masterMp3Path && fs.existsSync(deliverables.masterMp3Path)) {
      deliverables.filesToAttach.push(deliverables.masterMp3Path);
    }
    if (deliverables.stemsZipPath && fs.existsSync(deliverables.stemsZipPath)) {
      deliverables.filesToAttach.push(deliverables.stemsZipPath);
    }
  }

  if (session.mode === 'both' || session.mode === 'script') {
    if (deliverables.scriptPath && fs.existsSync(deliverables.scriptPath)) {
      deliverables.filesToAttach.push(deliverables.scriptPath);
    }
    if (deliverables.notesPath && fs.existsSync(deliverables.notesPath)) {
      deliverables.filesToAttach.push(deliverables.notesPath);
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

  for (const speaker of session.speakers.values()) {
    try {
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
