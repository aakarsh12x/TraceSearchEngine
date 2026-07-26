'use client';

export type SearchMode = 'agentic' | 'direct';

interface AgentModeSwitchProps {
  mode: SearchMode;
  onModeChange: (mode: SearchMode) => void;
  compact?: boolean;
}

export function AgentModeSwitch({ mode, onModeChange, compact }: AgentModeSwitchProps) {
  return (
    <div
      className="inline-flex items-center rounded-lg border border-zinc-800 bg-zinc-950 p-0.5 select-none"
      style={{ fontSize: compact ? '11px' : '12px' }}
    >
      {(['agentic', 'direct'] as SearchMode[]).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onModeChange(m)}
          className={`px-3 py-1.5 rounded-md font-medium transition-all duration-150 cursor-pointer border-none outline-none whitespace-nowrap
            ${mode === m
              ? 'bg-zinc-800 text-zinc-100'
              : 'text-zinc-500 hover:text-zinc-300 bg-transparent'
            }`}
        >
          {m === 'agentic' ? 'AI Search' : 'Direct'}
        </button>
      ))}
    </div>
  );
}
