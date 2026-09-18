import { useState } from 'react';
import { Bot, FolderTree, Database, PlayCircle, Milestone, CheckCircle2, Circle } from 'lucide-react';
import { FolderStructureView } from './components/FolderStructureView';
import { SqlSchemaView } from './components/SqlSchemaView';
import { DiscordSimulator } from './components/DiscordSimulator';

export default function App() {
  const [activeTab, setActiveTab] = useState<'step1' | 'step2' | 'simulator' | 'roadmap'>('step1');

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans antialiased flex flex-col">
      {/* Top Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-2xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-xs">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-slate-900 leading-tight">
                  EngageBot Studio
                </h1>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold">
                  MVP Architect
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Discord.js v14 + Supabase PostgreSQL Gamification Engine
              </p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-none">
            <button
              id="nav-step1"
              onClick={() => setActiveTab('step1')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                activeTab === 'step1'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <FolderTree className="w-3.5 h-3.5" />
              <span>Step 1: Folder Tree</span>
            </button>

            <button
              id="nav-step2"
              onClick={() => setActiveTab('step2')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                activeTab === 'step2'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              <span>Step 2: Supabase SQL</span>
            </button>

            <button
              id="nav-simulator"
              onClick={() => setActiveTab('simulator')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                activeTab === 'simulator'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <PlayCircle className="w-3.5 h-3.5" />
              <span>Interactive Simulator</span>
            </button>

            <button
              id="nav-roadmap"
              onClick={() => setActiveTab('roadmap')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                activeTab === 'roadmap'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Milestone className="w-3.5 h-3.5" />
              <span>Roadmap (Steps 3 & 4)</span>
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'step1' && <FolderStructureView />}
        {activeTab === 'step2' && <SqlSchemaView />}
        {activeTab === 'simulator' && <DiscordSimulator />}
        {activeTab === 'roadmap' && (
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <h2 className="text-xl font-bold text-slate-900">
                EngageBot Step-by-Step Execution Plan
              </h2>
              <p className="text-sm text-slate-600 mt-1">
                Following your strict step-by-step instructions. Steps 1 & 2 are prepared and ready for review.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Step 1 & 2 Completed */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
                <div className="flex items-center gap-2 text-emerald-600 font-bold text-sm">
                  <CheckCircle2 className="w-5 h-5" />
                  Step 1: Modular Folder Structure (Delivered)
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Clean directory tree separating config, database queries, handlers, slash commands, and Discord gateway events. Ready for Discord.js v14.
                </p>
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="font-mono text-slate-400">Status</span>
                  <span className="font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">Ready in Tab 1</span>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
                <div className="flex items-center gap-2 text-emerald-600 font-bold text-sm">
                  <CheckCircle2 className="w-5 h-5" />
                  Step 2: Supabase PostgreSQL Schema (Delivered)
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Normalized tables: <code>guilds</code>, <code>users</code> with composite key <code>(discord_id, guild_id)</code>, <code>raffles</code>, <code>raffle_entries</code>, and <code>quest_submissions</code> + ACID PL/pgSQL transaction.
                </p>
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="font-mono text-slate-400">Status</span>
                  <span className="font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">Ready in Tab 2</span>
                </div>
              </div>

              {/* Step 3 Up Next */}
              <div className="bg-white border-2 border-indigo-200 rounded-xl p-5 shadow-xs space-y-4">
                <div className="flex items-center gap-2 text-indigo-700 font-bold text-sm">
                  <Circle className="w-5 h-5 text-indigo-500 fill-indigo-100" />
                  Step 3: Setup Code & Handler Logic (Next)
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  We will provide:
                  <br />• <code>index.js</code> with GatewayIntentBits & client boot
                  <br />• <code>database/supabaseClient.js</code> with Supabase service role initialization
                  <br />• <code>handlers/commandHandler.js</code> & <code>handlers/eventHandler.js</code>
                  <br />• <code>deploy-commands.js</code> slash command registration script
                </p>
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="font-mono text-slate-400">Requirement</span>
                  <span className="font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">Awaiting Confirmation</span>
                </div>
              </div>

              {/* Step 4 Future */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
                <div className="flex items-center gap-2 text-slate-500 font-bold text-sm">
                  <Circle className="w-5 h-5 text-slate-300" />
                  Step 4: Core Gamification Features (Final Phase)
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Detailed implementation of:
                  <br />• <code>messageCreate.js</code> XP algorithm with in-memory 60s cooldown
                  <br />• <code>/leaderboard</code> slash command with formatted embeds
                  <br />• <code>/raffle create</code> and <code>/raffle enter</code>
                  <br />• <code>/submit-quest [url]</code> Twitter link logging & review
                </p>
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="font-mono text-slate-400">Requirement</span>
                  <span className="font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">Step 4 Trigger</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-3 px-4 text-center text-xs text-slate-500">
        EngageBot Architecture Studio • Discord.js v14 • Supabase PostgreSQL • Step-by-Step Guide
      </footer>
    </div>
  );
}
