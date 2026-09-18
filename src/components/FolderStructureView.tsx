import React, { useState } from 'react';
import { Folder, FolderOpen, FileCode, Copy, Check, ChevronRight, ChevronDown, Layers, Terminal } from 'lucide-react';
import { FileNode } from '../types';
import { FOLDER_STRUCTURE } from '../data/architectureData';

interface TreeNodeProps {
  node: FileNode;
  level: number;
  onSelect: (node: FileNode) => void;
  selectedNode: FileNode | null;
}

const TreeNode: React.FC<TreeNodeProps> = ({ node, level, onSelect, selectedNode }) => {
  const [isOpen, setIsOpen] = useState(true);
  const isFolder = node.type === 'folder';
  const isSelected = selectedNode?.name === node.name;

  return (
    <div>
      <div
        id={`tree-node-${node.name.replace(/[^a-zA-Z0-9]/g, '-')}`}
        onClick={() => {
          if (isFolder) setIsOpen(!isOpen);
          onSelect(node);
        }}
        className={`flex items-center gap-2 py-1.5 px-2 rounded-lg cursor-pointer text-sm font-mono transition-colors select-none ${
          isSelected
            ? 'bg-indigo-50 text-indigo-900 font-semibold'
            : 'hover:bg-slate-100 text-slate-700'
        }`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        {isFolder ? (
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 focus:outline-none"
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(!isOpen);
            }}
          >
            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        ) : (
          <span className="w-3.5" />
        )}

        {isFolder ? (
          isOpen ? (
            <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
          ) : (
            <Folder className="w-4 h-4 text-amber-500 shrink-0" />
          )
        ) : (
          <FileCode className="w-4 h-4 text-indigo-500 shrink-0" />
        )}

        <span className="truncate">{node.name}</span>

        {node.badge && (
          <span className="ml-auto text-[11px] font-sans px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">
            {node.badge}
          </span>
        )}
      </div>

      {isFolder && isOpen && node.children && (
        <div>
          {node.children.map((child, index) => (
            <TreeNode
              key={`${child.name}-${index}`}
              node={child}
              level={level + 1}
              onSelect={onSelect}
              selectedNode={selectedNode}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const FolderStructureView: React.FC = () => {
  const [selectedNode, setSelectedNode] = useState<FileNode | null>(FOLDER_STRUCTURE.children?.[4] || null);
  const [copied, setCopied] = useState(false);

  const generateTreeString = (node: FileNode, prefix = ''): string => {
    let result = `${prefix}${node.name}${node.type === 'folder' ? '/' : ''}\n`;
    if (node.children) {
      node.children.forEach((child) => {
        result += generateTreeString(child, prefix + '  ');
      });
    }
    return result;
  };

  const handleCopyTree = () => {
    const text = generateTreeString(FOLDER_STRUCTURE);
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                Step 1: Modular Architecture
              </span>
              <span className="text-xs text-slate-500 font-mono">Discord.js v14 Ready</span>
            </div>
            <h2 className="text-xl font-bold text-slate-900 mt-1">
              Scalable Folder Structure for EngageBot
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Clean separation of concerns with dynamic Command & Event handlers, Supabase database repositories, and in-memory cooldown caching.
            </p>
          </div>
          <button
            id="copy-tree-btn"
            onClick={handleCopyTree}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg transition-colors shrink-0"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied Tree!' : 'Copy Tree Structure'}
          </button>
        </div>
      </div>

      {/* Explorer & Detail Pane */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Tree Panel */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between pb-3 mb-2 border-b border-slate-100">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <Layers className="w-4 h-4 text-indigo-500" />
              File Tree Navigation
            </div>
            <span className="text-xs text-slate-400">Click to inspect</span>
          </div>

          <div className="py-1 max-h-[500px] overflow-y-auto">
            <TreeNode
              node={FOLDER_STRUCTURE}
              level={0}
              onSelect={setSelectedNode}
              selectedNode={selectedNode}
            />
          </div>
        </div>

        {/* Selected File Details */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <FileCode className="w-4 h-4 text-indigo-600" />
                <span className="font-mono text-sm font-bold text-slate-900">
                  {selectedNode?.name || 'Select a file'}
                </span>
              </div>
              {selectedNode?.badge && (
                <span className="text-xs font-sans px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-semibold border border-indigo-200">
                  {selectedNode.badge}
                </span>
              )}
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Purpose & Role
                </h4>
                <p className="text-sm text-slate-700 leading-relaxed">
                  {selectedNode?.description || 'Select any file or folder from the tree to view its role in the bot architecture.'}
                </p>
              </div>

              {selectedNode?.details && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    Implementation Notes
                  </h4>
                  <pre className="text-xs font-mono bg-slate-900 text-slate-100 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap">
                    {selectedNode.details}
                  </pre>
                </div>
              )}

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600 space-y-1.5">
                <div className="font-semibold text-slate-800">Architectural Key Points:</div>
                <div className="flex items-start gap-1.5">
                  <span className="text-emerald-600 font-bold">•</span>
                  <span><strong>Zero Spaghetti Code:</strong> Commands are categorized into subfolders (`economy`, `raffle`, `quests`).</span>
                </div>
                <div className="flex items-start gap-1.5">
                  <span className="text-emerald-600 font-bold">•</span>
                  <span><strong>Rate-Limit Shield:</strong> In-memory Map cooldown in `utils/cooldownManager.js` ensures high-velocity chat never bombards Supabase.</span>
                </div>
                <div className="flex items-start gap-1.5">
                  <span className="text-emerald-600 font-bold">•</span>
                  <span><strong>Service Role Client:</strong> Supabase client runs with backend privilege, bypassing RLS while tables remain locked down from browser clients.</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-slate-400" />
              Node.js v18+ & Discord.js v14
            </span>
            <span className="font-mono text-indigo-600">Ready for Step 3</span>
          </div>
        </div>
      </div>
    </div>
  );
};
