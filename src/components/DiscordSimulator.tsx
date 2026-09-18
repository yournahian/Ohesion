import React, { useState, useEffect } from 'react';
import { Send, Trophy, Ticket, Share2, Sparkles, RefreshCw, AlertCircle } from 'lucide-react';
import { SimUser, SimRaffle, SimQuest } from '../types';

export const DiscordSimulator: React.FC = () => {
  // Current active user
  const [currentUser, setCurrentUser] = useState<SimUser>({
    discord_id: '98451234981239812',
    username: 'CommunityChamp',
    avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop',
    xp: 85,
    level: 1,
    total_points: 120,
    lastMessageAt: 0,
  });

  // Mock server leaderboard members
  const [leaderboard, setLeaderboard] = useState<SimUser[]>([
    {
      discord_id: '1',
      username: 'CyberNinja',
      avatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100&h=100&fit=crop',
      xp: 640,
      level: 4,
      total_points: 480,
      lastMessageAt: 0,
    },
    {
      discord_id: '2',
      username: 'PixelQueen',
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop',
      xp: 410,
      level: 3,
      total_points: 310,
      lastMessageAt: 0,
    },
    {
      discord_id: '98451234981239812',
      username: 'CommunityChamp (You)',
      avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop',
      xp: 85,
      level: 1,
      total_points: 120,
      lastMessageAt: 0,
    },
    {
      discord_id: '4',
      username: 'AstroDev',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop',
      xp: 65,
      level: 1,
      total_points: 50,
      lastMessageAt: 0,
    },
  ]);

  // Active Raffles
  const [raffles, setRaffles] = useState<SimRaffle[]>([
    {
      raffle_id: 'rf-1',
      prize: 'Discord Nitro (1 Month)',
      cost: 50,
      end_time: 'in 2 hours',
      is_active: true,
      entriesCount: 8,
      creator: 'Admin_Sarah',
    },
  ]);

  // Social Quests
  const [quests, setQuests] = useState<SimQuest[]>([
    {
      submission_id: 'q-1',
      discord_id: '98451234981239812',
      username: 'CommunityChamp',
      url: 'https://x.com/engage_bot/status/1836102938',
      status: 'pending',
      points_awarded: 25,
      submitted_at: '10 mins ago',
    },
  ]);

  // Chat message input & cooldown tracking
  const [chatMessage, setChatMessage] = useState('');
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [logs, setLogs] = useState<Array<{ id: string; text: string; type: 'xp' | 'level' | 'raffle' | 'quest' | 'cooldown' }>>([
    { id: '0', text: 'EngageBot v14 client connected to Discord Gateway.', type: 'xp' },
  ]);

  // Cooldown countdown loop
  useEffect(() => {
    if (cooldownRemaining <= 0) return;
    const interval = setInterval(() => {
      setCooldownRemaining((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [cooldownRemaining]);

  // XP requirement formula: 100 * level
  const xpForNextLevel = currentUser.level * 100;

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim()) return;

    const now = Date.now();
    if (cooldownRemaining > 0) {
      setLogs((prev) => [
        {
          id: String(now),
          text: `[Cooldown] Wait ${cooldownRemaining}s before gaining XP again! (Spam prevention active)`,
          type: 'cooldown',
        },
        ...prev,
      ]);
      setChatMessage('');
      return;
    }

    // Award random 15-25 XP
    const earnedXp = Math.floor(Math.random() * 11) + 15;
    const newXp = currentUser.xp + earnedXp;
    let newLevel = currentUser.level;
    let earnedPoints = 0;

    // Check level up
    if (newXp >= xpForNextLevel) {
      newLevel += 1;
      earnedPoints = 50; // Bonus 50 Engage Points per level up!
    }

    const updatedUser = {
      ...currentUser,
      xp: newXp,
      level: newLevel,
      total_points: currentUser.total_points + earnedPoints,
      lastMessageAt: now,
    };

    setCurrentUser(updatedUser);
    setCooldownRemaining(60); // 1-minute cooldown per MVP spec

    // Update leaderboard
    setLeaderboard((prev) =>
      prev
        .map((u) => (u.discord_id === updatedUser.discord_id ? updatedUser : u))
        .sort((a, b) => b.xp - a.xp)
    );

    // Append logs
    setLogs((prev) => [
      ...(newLevel > currentUser.level
        ? [
            {
              id: String(now + 1),
              text: `LEVEL UP! ${currentUser.username} reached Level ${newLevel}! Awarded +50 Engage Points!`,
              type: 'level' as const,
            },
          ]
        : []),
      {
        id: String(now),
        text: `+${earnedXp} XP earned for message: "${chatMessage.slice(0, 30)}${chatMessage.length > 30 ? '...' : ''}" (Cooldown: 60s started)`,
        type: 'xp',
      },
      ...prev,
    ]);

    setChatMessage('');
  };

  const handleEnterRaffle = (raffle: SimRaffle) => {
    if (currentUser.total_points < raffle.cost) {
      alert(`Not enough points! You need ${raffle.cost} points, but only have ${currentUser.total_points}.`);
      return;
    }

    const updatedPoints = currentUser.total_points - raffle.cost;
    const updatedUser = { ...currentUser, total_points: updatedPoints };
    setCurrentUser(updatedUser);

    setRaffles((prev) =>
      prev.map((r) => (r.raffle_id === raffle.raffle_id ? { ...r, entriesCount: r.entriesCount + 1 } : r))
    );

    setLogs((prev) => [
      {
        id: String(Date.now()),
        text: `Entered raffle for "${raffle.prize}"! Deducted ${raffle.cost} Points. Balance: ${updatedPoints} pts.`,
        type: 'raffle',
      },
      ...prev,
    ]);
  };

  const [questUrl, setQuestUrl] = useState('');
  const handleSubmitQuest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!questUrl.trim()) return;

    const newQuest: SimQuest = {
      submission_id: `q-${Date.now()}`,
      discord_id: currentUser.discord_id,
      username: currentUser.username,
      url: questUrl,
      status: 'pending',
      points_awarded: 25,
      submitted_at: 'Just now',
    };

    setQuests((prev) => [newQuest, ...prev]);
    // Award temporary points per MVP spec
    setCurrentUser((prev) => ({ ...prev, total_points: prev.total_points + 25 }));

    setLogs((prev) => [
      {
        id: String(Date.now()),
        text: `/submit-quest accepted! Saved Twitter link to database & awarded +25 temp points for admin review.`,
        type: 'quest',
      },
      ...prev,
    ]);

    setQuestUrl('');
  };

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-800">
                Interactive Bot Sandbox
              </span>
              <span className="text-xs text-slate-500 font-mono">Live Logic Testbed</span>
            </div>
            <h2 className="text-xl font-bold text-slate-900 mt-1">
              EngageBot Gamification Simulator
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Test the 1-minute XP cooldown, level up mathematical curve, Engage Points economy, raffle ticket transactions, and social quest submissions.
            </p>
          </div>
          <button
            onClick={() => {
              setCooldownRemaining(0);
              setCurrentUser((prev) => ({ ...prev, xp: 85, level: 1, total_points: 120 }));
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors font-medium self-start"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reset State
          </button>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* User Card & Chat Input */}
        <div className="lg:col-span-6 space-y-6">
          {/* User Profile Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <img
                  src={currentUser.avatar}
                  alt={currentUser.username}
                  className="w-12 h-12 rounded-full border-2 border-indigo-500 object-cover"
                />
                <div>
                  <h3 className="font-bold text-slate-900 flex items-center gap-2">
                    {currentUser.username}
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-normal">
                      Discord Member
                    </span>
                  </h3>
                  <div className="text-xs text-slate-500 font-mono mt-0.5">
                    Level {currentUser.level} • {currentUser.total_points} Engage Points
                  </div>
                </div>
              </div>
              <div className="text-right">
                <span className="text-2xl font-black text-indigo-600 font-mono">
                  {currentUser.total_points}
                </span>
                <span className="block text-[10px] text-slate-400 uppercase font-semibold">
                  PTS Balance
                </span>
              </div>
            </div>

            {/* XP Bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-mono text-slate-600">
                <span>XP Progress</span>
                <span>
                  {currentUser.xp} / {xpForNextLevel} XP
                </span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, (currentUser.xp / xpForNextLevel) * 100)}%` }}
                />
              </div>
            </div>

            {/* Cooldown Status */}
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="text-slate-500">1-Minute XP Cooldown:</span>
              {cooldownRemaining > 0 ? (
                <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 font-mono font-bold flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  Active ({cooldownRemaining}s left)
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-mono font-bold flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Ready (+15-25 XP next message)
                </span>
              )}
            </div>
          </div>

          {/* Chat Message Test Box */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
              Simulate Discord Message (XP Trigger)
            </h3>
            <form onSubmit={handleSendMessage} className="space-y-3">
              <div className="flex gap-2">
                <input
                  id="sim-chat-input"
                  type="text"
                  value={chatMessage}
                  onChange={(e) => setChatMessage(e.target.value)}
                  placeholder="Type a message (e.g. 'Hey everyone, check this project out!')..."
                  className="flex-1 text-xs border border-slate-300 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  id="sim-send-btn"
                  type="submit"
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                  Send
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                In Discord, the bot listens to <code>messageCreate</code> and verifies user ID against an in-memory 60s cooldown before issuing Supabase writes.
              </p>
            </form>
          </div>

          {/* Social Quest Submission */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
              <Share2 className="w-3.5 h-3.5 text-indigo-500" />
              Slash Command: /submit-quest [url]
            </h3>
            <form onSubmit={handleSubmitQuest} className="space-y-3">
              <div className="flex gap-2">
                <input
                  id="sim-quest-input"
                  type="url"
                  value={questUrl}
                  onChange={(e) => setQuestUrl(e.target.value)}
                  placeholder="https://x.com/yourhandle/status/183..."
                  className="flex-1 text-xs border border-slate-300 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  id="sim-quest-btn"
                  type="submit"
                  className="px-3.5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-colors shrink-0"
                >
                  Submit Link
                </button>
              </div>
              <div className="text-[11px] text-slate-500 flex items-center gap-1">
                <AlertCircle className="w-3 h-3 text-slate-400" />
                Stores to <code>quest_submissions</code> table and credits 25 temporary points.
              </div>
            </form>
          </div>
        </div>

        {/* Right Side: Raffles & Leaderboard & Activity Feed */}
        <div className="lg:col-span-6 space-y-6">
          {/* Active Raffles */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Ticket className="w-3.5 h-3.5 text-emerald-500" />
                Active Raffles (/raffle enter)
              </h3>
              <span className="text-[11px] text-emerald-600 bg-emerald-50 font-medium px-2 py-0.5 rounded">
                Points virtual economy
              </span>
            </div>

            {raffles.map((raffle) => (
              <div
                key={raffle.raffle_id}
                className="border border-slate-200 rounded-lg p-3 flex items-center justify-between bg-slate-50/50"
              >
                <div>
                  <h4 className="font-bold text-sm text-slate-900">{raffle.prize}</h4>
                  <div className="text-xs text-slate-500 font-mono mt-0.5">
                    Ticket Cost: <span className="font-bold text-indigo-600">{raffle.cost} Points</span> • {raffle.entriesCount} entries
                  </div>
                </div>
                <button
                  id={`enter-raffle-${raffle.raffle_id}`}
                  onClick={() => handleEnterRaffle(raffle)}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors shadow-xs"
                >
                  Buy Ticket ({raffle.cost} pts)
                </button>
              </div>
            ))}
          </div>

          {/* Leaderboard Command Preview */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Trophy className="w-3.5 h-3.5 text-amber-500" />
                Slash Command: /leaderboard (Top Users)
              </h3>
              <span className="text-[11px] font-mono text-slate-400">
                SELECT * ORDER BY xp DESC
              </span>
            </div>

            <div className="space-y-2">
              {leaderboard.slice(0, 4).map((user, idx) => (
                <div
                  key={user.discord_id}
                  className={`flex items-center justify-between p-2 rounded-lg text-xs font-mono ${
                    user.discord_id === currentUser.discord_id
                      ? 'bg-indigo-50/80 border border-indigo-200 font-bold'
                      : 'bg-slate-50 border border-slate-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className={`w-5 text-center font-bold ${idx === 0 ? 'text-amber-500' : 'text-slate-500'}`}>
                      #{idx + 1}
                    </span>
                    <img src={user.avatar} alt="" className="w-6 h-6 rounded-full object-cover" />
                    <span className="text-slate-900 font-sans">{user.username}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-slate-500">Lvl {user.level}</span>
                    <span className="text-indigo-600 font-bold">{user.xp} XP</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Activity / Event Stream */}
          <div className="bg-slate-900 rounded-xl p-4 border border-slate-800 text-xs font-mono text-slate-300">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center justify-between">
              <span>Bot Gateway Activity Log</span>
              <span className="text-emerald-400 text-[10px]">● Live</span>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className={`leading-relaxed text-[11px] ${
                    log.type === 'level'
                      ? 'text-amber-400 font-bold'
                      : log.type === 'cooldown'
                      ? 'text-rose-400'
                      : log.type === 'raffle'
                      ? 'text-emerald-400'
                      : 'text-slate-300'
                  }`}
                >
                  {log.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
