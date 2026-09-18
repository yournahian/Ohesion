import React, { useState } from 'react';
import { Database, Copy, Check, Table, Key, ShieldCheck, Zap, Server } from 'lucide-react';
import { SUPABASE_SQL_QUERY, SQL_TABLES_INFO } from '../data/architectureData';

export const SqlSchemaView: React.FC = () => {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'tables' | 'raw_sql'>('tables');
  const [selectedTable, setSelectedTable] = useState<string>('users');

  const handleCopySql = () => {
    navigator.clipboard.writeText(SUPABASE_SQL_QUERY);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const currentTableData = SQL_TABLES_INFO.find((t) => t.name === selectedTable) || SQL_TABLES_INFO[0];

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                Step 2: Database Schema
              </span>
              <span className="text-xs text-slate-500 font-mono">Supabase PostgreSQL 15+</span>
            </div>
            <h2 className="text-xl font-bold text-slate-900 mt-1">
              Normalized Supabase Schema with Multi-Server Scope
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Engineered with composite keys <code className="text-xs bg-slate-100 text-indigo-700 px-1 py-0.5 rounded font-mono">(discord_id, guild_id)</code> for server-specific XP/leveling, ACID raffle transactions, and scalable Server/Personal Premium tiers.
            </p>
          </div>
          <button
            id="copy-sql-btn"
            onClick={handleCopySql}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors shrink-0 shadow-xs"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied Full SQL!' : 'Copy Supabase SQL'}
          </button>
        </div>

        {/* View Switcher */}
        <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-100">
          <button
            onClick={() => setActiveTab('tables')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              activeTab === 'tables'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Table className="w-3.5 h-3.5" />
            Table Architecture & Dictionary
          </button>
          <button
            onClick={() => setActiveTab('raw_sql')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              activeTab === 'raw_sql'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            Raw SQL Migration Script
          </button>
        </div>
      </div>

      {activeTab === 'tables' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Table List */}
          <div className="lg:col-span-4 space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 px-1 mb-2">
              Database Tables ({SQL_TABLES_INFO.length})
            </h3>
            {SQL_TABLES_INFO.map((table) => {
              const isSelected = selectedTable === table.name;
              return (
                <div
                  key={table.name}
                  id={`tab-table-${table.name}`}
                  onClick={() => setSelectedTable(table.name)}
                  className={`p-3 rounded-xl border cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-white border-indigo-500 shadow-sm ring-1 ring-indigo-500/20'
                      : 'bg-white/80 border-slate-200 hover:border-slate-300 hover:bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Table className={`w-4 h-4 ${isSelected ? 'text-indigo-600' : 'text-slate-400'}`} />
                      <span className="font-mono text-sm font-bold text-slate-900">
                        {table.name}
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-slate-400">
                      {table.columns.length} cols
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-1">
                    {table.description}
                  </p>
                </div>
              );
            })}

            {/* Architecture Highlights Card */}
            <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl p-4 text-xs text-slate-700 space-y-2.5 mt-4">
              <div className="flex items-center gap-1.5 font-bold text-indigo-900">
                <ShieldCheck className="w-4 h-4 text-indigo-600" />
                Production Scalability Guarantee
              </div>
              <p className="text-indigo-950/80 leading-relaxed">
                By including the <code>guilds</code> table and scoping users via <code>(discord_id, guild_id)</code>, users can level up independently in Server A without corrupting their rank in Server B.
              </p>
              <div className="flex items-center gap-1.5 text-indigo-800 font-medium pt-1">
                <Zap className="w-3.5 h-3.5 text-amber-500" />
                Atomic PL/pgSQL function included for raffle ticket purchases.
              </div>
            </div>
          </div>

          {/* Selected Table Inspection */}
          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-5">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-semibold uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                    Table Schema
                  </span>
                  <h3 className="text-lg font-bold font-mono text-slate-900">
                    public.{currentTableData.name}
                  </h3>
                </div>
                {currentTableData.relationships && (
                  <span className="text-xs font-mono text-indigo-600 bg-indigo-50 px-2 py-1 rounded">
                    FK: {currentTableData.relationships[0]}
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-600 mt-1.5">
                {currentTableData.description}
              </p>
            </div>

            {/* Columns Table */}
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs font-sans">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase tracking-wider font-semibold">
                  <tr>
                    <th className="py-2.5 px-3">Column</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3">Constraints</th>
                    <th className="py-2.5 px-3">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {currentTableData.columns.map((col) => (
                    <tr key={col.name} className="hover:bg-slate-50/50">
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-900 flex items-center gap-1">
                        {col.constraints?.includes('PRIMARY KEY') && (
                          <Key className="w-3 h-3 text-amber-500 inline shrink-0" />
                        )}
                        {col.name}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-indigo-600">
                        {col.type}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-500 text-[11px]">
                        {col.constraints || '-'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">
                        {col.description}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Indexes */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                Indexes & Constraints
              </h4>
              <div className="space-y-1.5 font-mono text-xs bg-slate-900 text-slate-200 p-3 rounded-lg overflow-x-auto">
                {currentTableData.indexes.map((idx, i) => (
                  <div key={i} className="text-emerald-400">
                    {idx}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Raw SQL tab */
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
          <div className="flex items-center justify-between px-4 py-3 bg-slate-950 border-b border-slate-800 text-xs text-slate-400 font-mono">
            <span className="flex items-center gap-2">
              <Server className="w-3.5 h-3.5 text-emerald-400" />
              supabase_migration_v1.sql
            </span>
            <button
              onClick={handleCopySql}
              className="flex items-center gap-1.5 text-slate-300 hover:text-white px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 transition-colors"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="p-4 text-xs font-mono text-slate-200 overflow-x-auto max-h-[600px] leading-relaxed">
            {SUPABASE_SQL_QUERY}
          </pre>
        </div>
      )}
    </div>
  );
};
