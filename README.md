# ⚡ Questify

**Questify** is a 100% UI-driven Discord community gamification and engagement bot inspired by Engage.io. Built with Discord.js v14 and Supabase.

Instead of typing complex slash command arguments, Questify provides interactive Discord Modals, Buttons, Select Menus, and Embed Dashboards for both members and administrators.

---

## ✨ Features

### 1. 🏛️ Member Hub (`/hub`)
* **Live Personal Dashboard**: Real-time Level, XP progress bar, Quest Points (QP) balance, and Daily Streak tracker.
* **Daily Claim**: 24h streak bonus system with streak multiplier.
* **Leaderboard**: Top 10 community leaderboard by XP and QP.
* **Community Marketplace**: Browse and purchase server perks, roles, and real items using Quest Points.
* **Active Raffles & Auctions**: Direct access to ongoing community raffles and live escrow auctions.
* **Social & Web3 Connections**: 1-click Twitter/X handle linking and EVM / Solana payout wallet linking.

### 2. 🛡️ Admin Control Center (`/admin`)
* **100% UI Admin Panel**: Secured server-side by Administrator & Manage Guild permissions.
* **Post Tweet Quest**: Interactive tweet cards with Like ❤️, Retweet 🔁, and Comment 💬 verification buttons.
* **Create Community Raffle**: Ticket-based raffles supporting automated QP/XP deposits and Crypto/USDC winner wallet collection.
* **Create Escrow Auction**: Real-time bidding system with automated outbid refunds.
* **Marketplace Manager**: Add shop items with price, description, stock, and automatic Discord role assignment upon purchase.
* **Reward Member**: Adjust any member's QP and XP with reasons and automatic level-up role reward assignment.
* **Voice Chat Snapshot**: 1-click attendance taker that awards all connected voice channel members with points and XP.

### 3. 🚀 1-Click Server Setup (`/setup`)
* Automatically creates:
  * `QUESTIFY` category
  * `#quest-feed` channel (for tweet drops, raffles, auctions, and reward announcements)
  * `#questify-hub` channel (with a persistent, auto-updating interactive Member Hub)

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
Questify registers only 3 top-level entry commands:
```bash
npm run deploy
```

### 4. Start the Bot
```bash
npm start
```

---

## 📄 License
MIT License
