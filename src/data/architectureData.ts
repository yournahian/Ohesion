import { FileNode, SqlTableDefinition } from '../types';

export const FOLDER_STRUCTURE: FileNode = {
  name: 'engage-bot',
  type: 'folder',
  description: 'Root directory of the modular Discord.js v14 bot',
  children: [
    {
      name: '.env',
      type: 'file',
      badge: 'Secret',
      description: 'Bot token, Client ID, Supabase URL & Service Role key',
      details: 'DISCORD_TOKEN=...\nCLIENT_ID=...\nSUPABASE_URL=...\nSUPABASE_SERVICE_ROLE_KEY=...'
    },
    {
      name: '.env.example',
      type: 'file',
      description: 'Template for environment variables (safe to commit)',
    },
    {
      name: '.gitignore',
      type: 'file',
      description: 'Ignores node_modules, .env, and local logs',
    },
    {
      name: 'package.json',
      type: 'file',
      description: 'Node.js manifest with discord.js v14, @supabase/supabase-js, dotenv',
    },
    {
      name: 'deploy-commands.js',
      type: 'file',
      badge: 'Slash deployer',
      description: 'Utility script to register global or guild slash commands with Discord REST API',
      details: 'Uses REST and Routes from discord.js to push commands to Discord Application API'
    },
    {
      name: 'src',
      type: 'folder',
      description: 'Core source code',
      children: [
        {
          name: 'index.js',
          type: 'file',
          badge: 'Entry point',
          description: 'Initializes Discord Client, loads handlers, and logs in',
          details: 'Initializes Client with GatewayIntentBits (Guilds, GuildMessages, MessageContent)'
        },
        {
          name: 'config',
          type: 'folder',
          description: 'Configuration constants and XP leveling formulas',
          children: [
            {
              name: 'constants.js',
              type: 'file',
              description: 'XP ranges (15-25), cooldown times (60s), embed colors, leveling math'
            }
          ]
        },
        {
          name: 'database',
          type: 'folder',
          description: 'Supabase client & modular query repositories',
          children: [
            {
              name: 'supabaseClient.js',
              type: 'file',
              badge: 'DB Client',
              description: 'Initializes @supabase/supabase-js with service role key for backend operations'
            },
            {
              name: 'userRepo.js',
              type: 'file',
              description: 'Get/update user XP, level, points balance, and cooldown cache'
            },
            {
              name: 'raffleRepo.js',
              type: 'file',
              description: 'Create raffle, fetch active raffles, purchase tickets with points'
            },
            {
              name: 'questRepo.js',
              type: 'file',
              description: 'Store Twitter/X URLs, track review status, award temporary points'
            }
          ]
        },
        {
          name: 'handlers',
          type: 'folder',
          description: 'Dynamic loaders for commands and events',
          children: [
            {
              name: 'commandHandler.js',
              type: 'file',
              description: 'Recursively reads src/commands and attaches to client.commands Collection'
            },
            {
              name: 'eventHandler.js',
              type: 'file',
              description: 'Reads src/events and registers client.on / client.once listeners'
            }
          ]
        },
        {
          name: 'commands',
          type: 'folder',
          description: 'Modular Slash Command definitions categorized by domain',
          children: [
            {
              name: 'economy',
              type: 'folder',
              description: 'Points, balances, and profile commands',
              children: [
                {
                  name: 'profile.js',
                  type: 'file',
                  description: 'Display user card with current Level, XP progress bar, and Points'
                },
                {
                  name: 'leaderboard.js',
                  type: 'file',
                  badge: 'Core MVP',
                  description: '/leaderboard - Top 10 members ranked by XP & Level'
                }
              ]
            },
            {
              name: 'raffle',
              type: 'folder',
              description: 'Raffle management and ticket purchases',
              children: [
                {
                  name: 'raffle.js',
                  type: 'file',
                  badge: 'Core MVP',
                  description: 'Subcommands: /raffle create (Admin) & /raffle enter (Spend points for ticket)'
                }
              ]
            },
            {
              name: 'quests',
              type: 'folder',
              description: 'Social tasks and proof submissions',
              children: [
                {
                  name: 'submit-quest.js',
                  type: 'file',
                  badge: 'Core MVP',
                  description: '/submit-quest [url] - Submit Twitter/X link for admin verification & temp points'
                }
              ]
            }
          ]
        },
        {
          name: 'events',
          type: 'folder',
          description: 'Discord gateway event listeners',
          children: [
            {
              name: 'ready.js',
              type: 'file',
              description: 'Fired once bot connects; sets custom activity and logs server count'
            },
            {
              name: 'interactionCreate.js',
              type: 'file',
              description: 'Routes slash commands, auto-completes, and button/modal interactions'
            },
            {
              name: 'messageCreate.js',
              type: 'file',
              badge: 'XP Engine',
              description: 'XP & Leveling loop with 60-second in-memory cooldown & level-up alerts'
            }
          ]
        },
        {
          name: 'utils',
          type: 'folder',
          description: 'Helper functions and embed builders',
          children: [
            {
              name: 'cooldownManager.js',
              type: 'file',
              description: 'In-memory Map/LRU cache for instant 1-minute XP cooldown check without DB spam'
            },
            {
              name: 'levelCalculator.js',
              type: 'file',
              description: 'Mathematical curve for XP threshold per level (e.g. 100 * level^1.5)'
            },
            {
              name: 'embeds.js',
              type: 'file',
              description: 'Reusable Discord EmbedBuilder styling for success, error, and level-ups'
            }
          ]
        }
      ]
    }
  ]
};

export const SUPABASE_SQL_QUERY = `-- ==============================================================================
-- ENGAGEBOT SUPABASE POSTGRESQL SCHEMA (MVP + SCALABLE FOUNDATION)
-- Compatible with PostgreSQL 15+ in Supabase
-- ==============================================================================

-- 1. Enable UUID Extension (standard in Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==============================================================================
-- TABLE: guilds (Multi-tenancy & Future Server Premium Support)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.guilds (
    guild_id VARCHAR(32) PRIMARY KEY,              -- Discord Guild Snowflake ID
    name VARCHAR(255),
    premium_status VARCHAR(32) DEFAULT 'free',     -- 'free', 'server_pro', 'server_enterprise'
    xp_rate_multiplier NUMERIC(3, 2) DEFAULT 1.00,  -- Configurable multiplier for premium servers
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- TABLE: users (Normalized User State with Multi-Server Scope)
-- Note: composite primary key (discord_id, guild_id) ensures XP/Level is properly
-- scoped per server, allowing a user to have separate ranks in different servers!
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    discord_id VARCHAR(32) NOT NULL,               -- Discord User Snowflake ID
    guild_id VARCHAR(32) NOT NULL REFERENCES public.guilds(guild_id) ON DELETE CASCADE,
    xp BIGINT DEFAULT 0 CHECK (xp >= 0),
    level INT DEFAULT 1 CHECK (level >= 1),
    total_points BIGINT DEFAULT 0 CHECK (total_points >= 0),
    premium_tier VARCHAR(32) DEFAULT 'free',       -- Future: 'personal_pro', 'vip'
    last_message_at TIMESTAMPTZ,                   -- Persistent fallback for cooldowns
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_user_per_guild UNIQUE (discord_id, guild_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_guild_xp ON public.users (guild_id, xp DESC);
CREATE INDEX IF NOT EXISTS idx_users_discord_id ON public.users (discord_id);

-- ==============================================================================
-- TABLE: raffles (Community Giveaways / Raffles)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.raffles (
    raffle_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id VARCHAR(32) NOT NULL REFERENCES public.guilds(guild_id) ON DELETE CASCADE,
    prize VARCHAR(255) NOT NULL,
    cost INT NOT NULL CHECK (cost >= 0),            -- Points required per ticket
    duration_minutes INT NOT NULL,                 -- Duration in minutes
    end_time TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_by VARCHAR(32) NOT NULL,               -- Admin Discord ID
    winner_discord_id VARCHAR(32),                 -- Selected upon completion
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raffles_active ON public.raffles (guild_id, is_active, end_time);

-- ==============================================================================
-- TABLE: raffle_entries (Ticket Purchases)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.raffle_entries (
    entry_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    raffle_id UUID NOT NULL REFERENCES public.raffles(raffle_id) ON DELETE CASCADE,
    discord_id VARCHAR(32) NOT NULL,
    tickets_bought INT DEFAULT 1 CHECK (tickets_bought > 0),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_user_raffle_entry UNIQUE (raffle_id, discord_id)
);

CREATE INDEX IF NOT EXISTS idx_raffle_entries_raffle ON public.raffle_entries (raffle_id);

-- ==============================================================================
-- TABLE: quest_submissions (Social Quests for Twitter/X Links)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.quest_submissions (
    submission_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id VARCHAR(32) NOT NULL REFERENCES public.guilds(guild_id) ON DELETE CASCADE,
    discord_id VARCHAR(32) NOT NULL,
    tweet_url TEXT NOT NULL,
    status VARCHAR(32) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    points_awarded INT DEFAULT 25,
    reviewed_by VARCHAR(32),                       -- Admin Discord ID who verified
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quests_status ON public.quest_submissions (guild_id, status);

-- ==============================================================================
-- HELPER FUNCTIONS & TRIGGERS
-- ==============================================================================

-- Auto-update 'updated_at' timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_users_updated_at ON public.users;
CREATE TRIGGER trigger_users_updated_at
BEFORE UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Atomic function to purchase raffle ticket (Prevents race conditions)
CREATE OR REPLACE FUNCTION enter_raffle_transaction(
    p_raffle_id UUID,
    p_discord_id VARCHAR(32),
    p_guild_id VARCHAR(32),
    p_ticket_count INT DEFAULT 1
) RETURNS JSONB AS $$
DECLARE
    v_cost INT;
    v_total_cost BIGINT;
    v_is_active BOOLEAN;
    v_end_time TIMESTAMPTZ;
    v_user_points BIGINT;
BEGIN
    -- 1. Check raffle validity
    SELECT cost, is_active, end_time INTO v_cost, v_is_active, v_end_time
    FROM public.raffles
    WHERE raffle_id = p_raffle_id AND guild_id = p_guild_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Raffle not found');
    END IF;

    IF NOT v_is_active OR v_end_time <= NOW() THEN
        RETURN jsonb_build_object('success', false, 'message', 'This raffle is already closed');
    END IF;

    v_total_cost := v_cost * p_ticket_count;

    -- 2. Check user balance
    SELECT total_points INTO v_user_points
    FROM public.users
    WHERE discord_id = p_discord_id AND guild_id = p_guild_id
    FOR UPDATE; -- Row lock to prevent race condition

    IF v_user_points IS NULL OR v_user_points < v_total_cost THEN
        RETURN jsonb_build_object('success', false, 'message', 'Insufficient points balance');
    END IF;

    -- 3. Deduct points
    UPDATE public.users
    SET total_points = total_points - v_total_cost
    WHERE discord_id = p_discord_id AND guild_id = p_guild_id;

    -- 4. Insert or increment raffle entries
    INSERT INTO public.raffle_entries (raffle_id, discord_id, tickets_bought)
    VALUES (p_raffle_id, p_discord_id, p_ticket_count)
    ON CONFLICT (raffle_id, discord_id)
    DO UPDATE SET tickets_bought = public.raffle_entries.tickets_bought + p_ticket_count;

    RETURN jsonb_build_object(
        'success', true, 
        'tickets_bought', p_ticket_count,
        'remaining_points', (v_user_points - v_total_cost)
    );
END;
$$ LANGUAGE plpgsql;

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS)
-- As a Discord bot backend, the bot connects using SUPABASE_SERVICE_ROLE_KEY,
-- which bypasses RLS safely. However, we enable RLS to protect against public client access.
-- ==============================================================================
ALTER TABLE public.guilds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raffles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raffle_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quest_submissions ENABLE ROW LEVEL SECURITY;
`;

export const SQL_TABLES_INFO: SqlTableDefinition[] = [
  {
    name: 'guilds',
    description: 'Multi-tenant server registry for Server Premium tiers & custom server multipliers',
    columns: [
      { name: 'guild_id', type: 'VARCHAR(32)', constraints: 'PRIMARY KEY', description: 'Discord Server snowflake ID' },
      { name: 'name', type: 'VARCHAR(255)', description: 'Server display name' },
      { name: 'premium_status', type: 'VARCHAR(32)', constraints: "DEFAULT 'free'", description: "'free', 'server_pro', 'server_enterprise'" },
      { name: 'xp_rate_multiplier', type: 'NUMERIC(3, 2)', constraints: 'DEFAULT 1.00', description: 'XP boost for premium servers' },
      { name: 'created_at', type: 'TIMESTAMPTZ', constraints: 'DEFAULT NOW()', description: 'Creation timestamp' },
      { name: 'updated_at', type: 'TIMESTAMPTZ', constraints: 'DEFAULT NOW()', description: 'Last updated timestamp' }
    ],
    indexes: ['PRIMARY KEY (guild_id)']
  },
  {
    name: 'users',
    description: 'Stores member XP, calculated level, Engage Points balance, and per-guild ranking',
    columns: [
      { name: 'id', type: 'UUID', constraints: 'PRIMARY KEY DEFAULT uuid_generate_v4()', description: 'Internal unique row identifier' },
      { name: 'discord_id', type: 'VARCHAR(32)', constraints: 'NOT NULL', description: 'Discord User Snowflake ID' },
      { name: 'guild_id', type: 'VARCHAR(32)', constraints: 'NOT NULL REFERENCES guilds', description: 'Discord Server Snowflake ID' },
      { name: 'xp', type: 'BIGINT', constraints: 'DEFAULT 0 CHECK (xp >= 0)', description: 'Total accumulated XP in this guild' },
      { name: 'level', type: 'INT', constraints: 'DEFAULT 1 CHECK (level >= 1)', description: 'Current tier level' },
      { name: 'total_points', type: 'BIGINT', constraints: 'DEFAULT 0 CHECK (total_points >= 0)', description: 'Spendable Engage Points' },
      { name: 'premium_tier', type: 'VARCHAR(32)', constraints: "DEFAULT 'free'", description: "'free', 'personal_pro' (future monetization)" },
      { name: 'last_message_at', type: 'TIMESTAMPTZ', description: 'Timestamp of last message for cooldown fallback' },
      { name: 'created_at', type: 'TIMESTAMPTZ', constraints: 'DEFAULT NOW()', description: 'Registration timestamp' }
    ],
    indexes: [
      'UNIQUE (discord_id, guild_id)',
      'CREATE INDEX idx_users_guild_xp ON users (guild_id, xp DESC)',
      'CREATE INDEX idx_users_discord_id ON users (discord_id)'
    ],
    relationships: ['guild_id -> guilds.guild_id']
  },
  {
    name: 'raffles',
    description: 'Active and archived raffle events created by community administrators',
    columns: [
      { name: 'raffle_id', type: 'UUID', constraints: 'PRIMARY KEY DEFAULT uuid_generate_v4()', description: 'Unique raffle ID' },
      { name: 'guild_id', type: 'VARCHAR(32)', constraints: 'NOT NULL REFERENCES guilds', description: 'Server hosting the raffle' },
      { name: 'prize', type: 'VARCHAR(255)', constraints: 'NOT NULL', description: 'Prize title (e.g., Discord Nitro, $20 Giftcard)' },
      { name: 'cost', type: 'INT', constraints: 'CHECK (cost >= 0)', description: 'Engage Points cost per ticket' },
      { name: 'duration_minutes', type: 'INT', constraints: 'NOT NULL', description: 'Original raffle run duration' },
      { name: 'end_time', type: 'TIMESTAMPTZ', constraints: 'NOT NULL', description: 'Exact expiration deadline' },
      { name: 'is_active', type: 'BOOLEAN', constraints: 'DEFAULT TRUE', description: 'Whether entries are currently open' },
      { name: 'created_by', type: 'VARCHAR(32)', constraints: 'NOT NULL', description: 'Admin Discord ID who created raffle' },
      { name: 'winner_discord_id', type: 'VARCHAR(32)', description: 'Chosen winner Discord ID when closed' }
    ],
    indexes: ['CREATE INDEX idx_raffles_active ON raffles (guild_id, is_active, end_time)'],
    relationships: ['guild_id -> guilds.guild_id']
  },
  {
    name: 'raffle_entries',
    description: 'Participant entries and purchased ticket tallies per raffle',
    columns: [
      { name: 'entry_id', type: 'UUID', constraints: 'PRIMARY KEY DEFAULT uuid_generate_v4()', description: 'Unique ticket record' },
      { name: 'raffle_id', type: 'UUID', constraints: 'NOT NULL REFERENCES raffles', description: 'Parent raffle' },
      { name: 'discord_id', type: 'VARCHAR(32)', constraints: 'NOT NULL', description: 'Discord User Snowflake' },
      { name: 'tickets_bought', type: 'INT', constraints: 'DEFAULT 1 CHECK (tickets_bought > 0)', description: 'Number of entries/chances' },
      { name: 'created_at', type: 'TIMESTAMPTZ', constraints: 'DEFAULT NOW()', description: 'First entry timestamp' }
    ],
    indexes: [
      'UNIQUE (raffle_id, discord_id)',
      'CREATE INDEX idx_raffle_entries_raffle ON raffle_entries (raffle_id)'
    ],
    relationships: ['raffle_id -> raffles.raffle_id']
  },
  {
    name: 'quest_submissions',
    description: 'Twitter/X engagement submissions awaiting admin verification',
    columns: [
      { name: 'submission_id', type: 'UUID', constraints: 'PRIMARY KEY DEFAULT uuid_generate_v4()', description: 'Submission ID' },
      { name: 'guild_id', type: 'VARCHAR(32)', constraints: 'NOT NULL REFERENCES guilds', description: 'Target Discord Server' },
      { name: 'discord_id', type: 'VARCHAR(32)', constraints: 'NOT NULL', description: 'Discord submitter user ID' },
      { name: 'tweet_url', type: 'TEXT', constraints: 'NOT NULL', description: 'Submitted Twitter/X link' },
      { name: 'status', type: 'VARCHAR(32)', constraints: "DEFAULT 'pending'", description: "'pending', 'approved', 'rejected'" },
      { name: 'points_awarded', type: 'INT', constraints: 'DEFAULT 25', description: 'Reward points (e.g. 25 points on submit)' },
      { name: 'reviewed_by', type: 'VARCHAR(32)', description: 'Admin ID who reviewed' },
      { name: 'created_at', type: 'TIMESTAMPTZ', constraints: 'DEFAULT NOW()', description: 'Submission timestamp' }
    ],
    indexes: ['CREATE INDEX idx_quests_status ON quest_submissions (guild_id, status)'],
    relationships: ['guild_id -> guilds.guild_id']
  }
];
