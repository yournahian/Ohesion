# ⚡ Ohesion

**Ohesion** is a 100% UI-driven Discord & Telegram community gamification, social engagement, and security engine inspired by Engage.io. Built with Discord.js v14 and Supabase.

Instead of typing complex slash command arguments, Ohesion provides interactive Discord Modals, Buttons, Select Menus, and Embed Dashboards for both members and administrators.

---

## ✨ Features

### 1. 🏛️ Member Hub (`/hub`)
* **Live Personal Dashboard**: Real-time Level, XP progress bar, Cohesion Points (CP) balance, and Daily Streak tracker.
* **Daily Claim**: 24h streak bonus system with streak multiplier.
* **Leaderboard**: Top 10 community leaderboard by XP and CP.
* **Community Marketplace**: Browse and purchase server perks, roles, and real items using Cohesion Points.
* **Active Raffles & Auctions**: Direct access to ongoing community raffles and live escrow auctions.
* **Social & Web3 Connections**: 1-click Twitter/X handle linking and EVM / Solana payout wallet linking.
* **Support Tickets**: 1-click native Discord support ticket creation with modal forms and transcripts.

### 2. 🛡️ Admin Control Center (`/admin`)
* **100% UI Admin Panel**: Secured server-side by Administrator & Manage Guild permissions.
* **Server Operating Modes**: 1-click toggle between Full Economy, Level & XP Only, Social & Roles Only, and Custom Modular Mode.
* **Cohesion Shield (AutoMod)**: Anti-link, anti-invite, anti-spam flood, and channel-by-channel custom link whitelisting.
* **Member Data Analytics**: Full Server CSV export with date range filters, single member dossiers, and lifetime message history sync.
* **Post Tweet Quest**: Interactive tweet cards with Like ❤️, Retweet 🔁, and Comment 💬 verification buttons.
* **Create Community Raffle**: Ticket-based raffles supporting automated CP/XP deposits and winner wallet collection.
* **Create Escrow Auction**: Real-time bidding system with automated outbid refunds.
* **Marketplace Manager**: Add shop items with price, description, stock, and automatic Discord role assignment upon purchase.

### 3. 🚀 1-Click Server Setup (`/setup`)
* Automatically creates:
  * `📁 COHESION HQ` category
  * `#cohesion-hub` channel (with persistent interactive Member Hub)
  * `#cohesion-quests` channel (for tweet drops, social raids, and reward announcements)
  * `#cohesion-levels` channel (for dedicated level-up announcements)
  * `#cohesion-logs` channel (for private administrative audit logs)

---

## 🛠️ Tech Stack

* **Runtime**: Node.js (ES Modules)
* **Framework**: [Discord.js v14](https://discord.js.org/)
* **Database**: [Supabase](https://supabase.com/) (PostgreSQL)

---

## 📦 Getting Started

### 1. Clone & Install
```bash
git clone https://github.com/yournahian/Questify.git
cd Questify
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_discord_client_id_here
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here
```

### 3. Deploy Slash Commands
Ohesion registers clean top-level entry commands:
```bash
npm run deploy
```

### 4. Start the Bot
```bash
npm start
```
