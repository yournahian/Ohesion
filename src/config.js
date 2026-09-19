import dotenv from 'dotenv';
dotenv.config();

const requiredEnv = ['DISCORD_TOKEN', 'CLIENT_ID', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

for (const envKey of requiredEnv) {
  if (!process.env[envKey]) {
    console.warn(`[WARNING] Missing environment variable: ${envKey}. Please check your .env file.`);
  }
}

export const config = {
  discordToken: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  groqApiKey: process.env.GROQ_API_KEY || process.env.GROP_API_KEY,
  geminiApiKey: process.env.GEMINI_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY,
  baseUrl: (process.env.RENDER_EXTERNAL_URL || process.env.BASE_URL || 'https://questify-bot-7i0l.onrender.com').replace(/\/+$/, ''),
};
