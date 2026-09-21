-- Ohesion Chaos Clash Battle Royale Schema Extension
-- Run this in your Supabase SQL Editor to add cosmetic variables to the users table.

ALTER TABLE users ADD COLUMN IF NOT EXISTS battle_name_color TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS battle_emoji TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS battle_title TEXT DEFAULT NULL;

-- Optional: Create index for fast cosmetic queries
CREATE INDEX IF NOT EXISTS idx_users_battle_cosmetics ON users (guild_id, discord_id);
