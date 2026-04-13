'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Meteors } from '@/components/ui/meteors';
import { useCompletion } from '@ai-sdk/react';
import ReactMarkdown from 'react-markdown';
import { Terminal } from '@/components/ui/terminal';
import { ShimmerButton } from '@/components/ui/shimmer-button';

// ─── Icons ───────────────────────────────────────────────────────────────────

function SearchIcon({ small }: { small?: boolean }) {
  return (
    <svg
      className={`absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none ${small ? 'w-3.5 h-3.5' : 'w-4 h-4'}`}
      style={{ color: '#52525b' }}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity ml-1 inline-block"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 17 17 7M7 7h10v10" />
    </svg>
  );
}

function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
    </svg>
  );
}

// ─── Shared search input ──────────────────────────────────────────────────────

interface SearchInputProps {
  query: string;
  isFocused: boolean;
  compact?: boolean;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
  onSearch: () => void;
  isLoading: boolean;
  autoFocus?: boolean;
}

function SearchInput({
  query, isFocused, compact, onChange, onKeyDown, onFocus, onBlur,
  onSearch, isLoading, autoFocus,
}: SearchInputProps) {
  return (
    <div className="relative w-full">
      <SearchIcon small={compact} />
      <input
        type="text"
        autoFocus={autoFocus}
        spellCheck={false}
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={compact ? 'Search or ask anything…' : 'Ask anything (Press ↵ for AI)…'}
        className="w-full outline-none transition-colors duration-150"
        style={{
          borderRadius: '0.75rem',
          fontSize: compact ? '0.875rem' : '1rem',
          paddingLeft: '2.6rem',
          paddingRight: '3.4rem',
          paddingTop: compact ? '0.55rem' : '1.2rem',
          paddingBottom: compact ? '0.55rem' : '1.2rem',
          backgroundColor: '#18181b',
          border: `1px solid ${isFocused ? '#3f3f46' : '#27272a'}`,
          color: '#fafafa',
          boxShadow: isFocused
            ? '0 0 0 3px rgba(63,63,70,0.25)'
            : compact ? 'none' : '0 4px 20px rgba(0,0,0,0.5)',
        }}
      />
      <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
        {isLoading ? (
          <div className={`spinner ${compact ? '' : 'mr-1'}`} />
        ) : (
          <ShimmerButton
            shimmerSize="0.05em"
            borderRadius={compact ? '10px' : '12px'}
            className={`flex items-center justify-center !p-0 ${compact ? 'w-8 h-8' : 'w-10 h-10'}`}
            onClick={onSearch}
          >
            <ArrowRightIcon className={`opacity-80 ${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
          </ShimmerButton>
        )}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [query, setQuery]               = useState('');
  const [results, setResults]           = useState<any[]>([]);
  const [isLoadingResults, setIsLoadingResults] = useState(false);
  const [hasSearched, setHasSearched]   = useState(false);
  const [isFocused, setIsFocused]       = useState(false);
  const [isAITriggered, setIsAITriggered] = useState(false);

  // Only move to results mode when user explicitly triggers AI (Enter / button)
  // Typing alone does NOT move the navbar up
  const isResultsMode = isAITriggered;

  const { completion, complete, isLoading: isAILoading, setCompletion } = useCompletion({
    api: '/api/ai-answer',
    streamProtocol: 'text',
  });

  // Search-as-you-type
  useEffect(() => {
    const run = async () => {
      if (query.trim().length < 2) {
        setResults([]);
        setHasSearched(false);
        if (query.trim().length === 0) {
          setIsAITriggered(false);
          setCompletion('');
        }
        return;
      }
      setHasSearched(true);
      setIsLoadingResults(true);
      try {
        const res  = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults((data.results || []).filter((r: any) => r?.url));
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setIsLoadingResults(false);
      }
    };
    const t = setTimeout(run, 400);
    return () => clearTimeout(t);
  }, [query]);

  // AI trigger (manual)
  const handleSearch = async () => {
    if (query.trim().length < 2) return;
    setIsAITriggered(true);
    setCompletion('');
    setIsLoadingResults(true);
    let cur: any[] = [];
    try {
      const res  = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      cur = (data.results || []).filter((r: any) => r?.url);
      setResults(cur);
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setIsLoadingResults(false);
    }
    if (cur.length > 0) {
      complete(query, { body: { results: cur.slice(0, 4) } });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSearch();
  };

  const showBeam = isAITriggered || isAILoading || completion.length > 0;
  const EASE = [0.25, 0.46, 0.45, 0.94] as const;

  // Shared input props
  const inputProps = {
    query, isFocused,
    onChange: setQuery,
    onKeyDown: handleKeyDown,
    onFocus: () => setIsFocused(true),
    onBlur: () => setIsFocused(false),
    onSearch: handleSearch,
    isLoading: isLoadingResults,
  };

  return (
    <main className="relative min-h-screen overflow-x-hidden" style={{ backgroundColor: '#09090b' }}>

      {/* Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <Meteors number={18} />
      </div>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(#27272a22 1px, transparent 1px), linear-gradient(90deg, #27272a22 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      {/* ── FIXED TOP BAR (results mode) ──────────────────────────────── */}
      <AnimatePresence>
        {isResultsMode && (
          <motion.header
            key="topbar"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.18, ease: EASE }}
            className="fixed top-0 left-0 right-0 z-50 flex items-center gap-4 px-6 py-3 border-b"
            style={{
              backgroundColor: 'rgba(9,9,11,0.92)',
              backdropFilter: 'blur(18px)',
              borderColor: '#27272a',
              willChange: 'opacity, transform',
            }}
          >
            <span
              className="text-xl font-semibold shrink-0 select-none"
              style={{ fontFamily: "'Audiowide', cursive", color: '#fafafa', letterSpacing: '-0.02em' }}
            >
              Trace
            </span>

            <div className="flex-1 max-w-2xl">
              <SearchInput {...inputProps} compact />
            </div>
          </motion.header>
        )}
      </AnimatePresence>

      {/* ── PAGE BODY ──────────────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-col items-center px-4 pt-20 pb-20 w-full">

        {/* HERO */}
        <AnimatePresence mode="wait">
          {!isResultsMode && (
            <motion.div
              key="hero"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, transition: { duration: 0.15, ease: EASE } }}
              transition={{ duration: 0.28, ease: EASE }}
              style={{ willChange: 'opacity, transform' }}
              className="text-center w-full max-w-2xl flex flex-col items-center"
            >
              <div className="inline-flex items-center gap-2 mb-7">
                <span
                  className="px-3 py-1 rounded-full text-xs font-medium border"
                  style={{
                    backgroundColor: '#18181b',
                    borderColor: '#27272a',
                    color: '#71717a',
                    fontFamily: "'Geist Mono', monospace",
                    letterSpacing: '0.08em',
                  }}
                >
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mr-2 align-middle shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                  NIM GPT ACTIVE
                </span>
              </div>

              <h1
                className="text-6xl font-semibold tracking-tight mb-3"
                style={{ color: '#fafafa', letterSpacing: '-0.03em', fontFamily: "'Audiowide', cursive" }}
              >
                Trace
              </h1>
              <p className="text-sm mb-8" style={{ color: '#52525b' }}>
                Index the web. Find anything instantly.
              </p>

              <SearchInput {...inputProps} autoFocus />

              {/* Typing-search results: float below the hero search bar */}
              <AnimatePresence>
                {!isResultsMode && results.length > 0 && (
                  <motion.div
                    key="hero-results"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.18, ease: EASE }}
                    className="w-full mt-2 rounded-xl border overflow-hidden no-scrollbar"
                    style={{
                      backgroundColor: '#131316',
                      borderColor: '#27272a',
                      boxShadow: '0 16px 48px rgba(0,0,0,0.7)',
                      maxHeight: '55vh',
                      overflowY: 'auto',
                    }}
                  >
                    {results.filter(r => r?.url).map((result, i) => (
                      <a
                        key={result.url ?? i}
                        href={result.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-col px-4 py-3 border-b last:border-b-0 transition-colors duration-100 no-underline"
                        style={{ borderColor: '#1f1f22', textDecoration: 'none', color: 'inherit' }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1c1c1f')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        <p className="text-xs text-zinc-500 font-mono truncate mb-0.5">{result.url}</p>
                        <p className="text-sm font-medium text-zinc-200 truncate">{result.title}</p>
                        {(result.description || result.content) && (
                          <p className="text-xs text-zinc-500 mt-0.5 line-clamp-1">
                            {result.description || result.content?.substring(0, 120)}
                          </p>
                        )}
                      </a>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

            </motion.div>
          )}
        </AnimatePresence>

        {/* RESULTS */}
        <div className={`w-full max-w-2xl ${isResultsMode ? 'pt-14' : ''}`}>

          {/* AI Terminal */}
          <AnimatePresence>
            {showBeam && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.25, ease: EASE }}
                className="w-full mt-4 relative z-10"
                style={{ willChange: 'opacity, transform' }}
              >
                <Terminal sequence={false} className="w-full shadow-2xl">
                  <div className="flex items-center gap-2 mb-3 text-[10px] font-bold uppercase tracking-widest text-purple-400/80">
                    <span className="flex h-1.5 w-1.5 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.5)]" />
                    Neural Inference Engine
                  </div>
                  {isAILoading && !completion && (
                    <p className="text-zinc-500 italic text-sm animate-pulse">Synthesizing context…</p>
                  )}
                  {completion && (
                    <div className="text-zinc-300 text-sm leading-relaxed prose prose-invert max-w-none prose-pre:bg-zinc-950 prose-pre:border prose-pre:border-zinc-800">
                      <ReactMarkdown>{completion}</ReactMarkdown>
                    </div>
                  )}
                </Terminal>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Traditional Results */}
          <AnimatePresence>
            {results.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full mt-8 relative z-0"
                style={{ willChange: 'opacity, transform' }}
              >
                <h3 className="text-zinc-500 text-xs font-semibold mb-6 tracking-wider uppercase pl-1 border-l-2 border-zinc-800">
                  Source Results
                </h3>
                <AnimatePresence mode="popLayout">
                  {results.map((result, i) => (
                    <motion.a
                      key={result.url ?? i}
                      href={result.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      layout
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.97 }}
                      transition={{ delay: i * 0.03, duration: 0.22, ease: 'easeOut' }}
                      className="group flex flex-col mb-3 p-4 rounded-xl no-underline transition-colors duration-150"
                      style={{
                        backgroundColor: '#131316',
                        border: '1px solid #27272a',
                        color: 'inherit',
                        textDecoration: 'none',
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.borderColor = '#3f3f46';
                        (e.currentTarget as HTMLElement).style.backgroundColor = '#1c1c1f';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.borderColor = '#27272a';
                        (e.currentTarget as HTMLElement).style.backgroundColor = '#131316';
                      }}
                    >
                      <p className="text-xs mb-1.5 truncate text-zinc-500 font-mono">{result.url}</p>
                      <h2 className="text-sm font-medium mb-1.5 flex items-center text-zinc-200">
                        {result.title}
                        <ArrowIcon />
                      </h2>
                      <p className="text-xs line-clamp-2 leading-relaxed text-zinc-500">
                        {result.description ||
                          (result.content ? result.content.substring(0, 150) + '…' : 'No content available.')}
                      </p>
                    </motion.a>
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </div>
    </main>
  );
}
