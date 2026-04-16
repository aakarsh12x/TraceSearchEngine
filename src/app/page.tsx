'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Meteors } from '@/components/ui/meteors';
import { useCompletion } from '@ai-sdk/react';
import ReactMarkdown from 'react-markdown';
import { Terminal } from '@/components/ui/terminal';
import { ShimmerButton } from '@/components/ui/shimmer-button';
import { TextAnimate } from '@/components/ui/text-animate';
import { CanvasText } from '@/components/ui/canvas-text';
import { NoiseBackground } from '@/components/ui/noise-background';

// ─── Animation constants (module-level = zero re-creation cost per render) ────
const EASE = [0.32, 0.72, 0, 1] as const;
const DUR = 0.55;

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
        className="w-full outline-none"
        style={{
          // Only transition compositor-friendly properties, never 'all'
          transition: 'border-color 0.2s ease, box-shadow 0.2s ease, padding 0.5s cubic-bezier(0.22, 1, 0.36, 1), font-size 0.5s cubic-bezier(0.22, 1, 0.36, 1)',  
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
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [isLoadingResults, setIsLoadingResults] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isAITriggered, setIsAITriggered] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  // Smoothly morph to results mode as soon as they type or trigger search (Google-style)
  const isResultsMode = isAITriggered || hasSearched || query.trim().length > 0;

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
        setPage(1);
        if (query.trim().length === 0) {
          setIsAITriggered(false);
          setCompletion('');
        }
        return;
      }
      setHasSearched(true);
      setIsLoadingResults(true);
      setPage(1); // reset to page 1 on new query
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
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
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
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

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSearch();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleSearch]);

  // Stable callbacks — wrapped in useCallback so SearchInput never re-renders
  // due to a new function reference on unrelated state changes.
  const handleFocus = useCallback(() => setIsFocused(true), []);
  const handleBlur  = useCallback(() => setIsFocused(false), []);

  const inputProps = {
    query, isFocused,
    onChange: setQuery,
    onKeyDown: handleKeyDown,
    onFocus: handleFocus,
    onBlur: handleBlur,
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
            initial={{ opacity: 0, y: -56 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -56 }}
            transition={{ duration: DUR, ease: EASE, delay: 0.08 }}
            className="fixed top-0 left-0 right-0 z-50 flex items-center px-6 py-3 border-b"
            style={{
              backgroundColor: 'rgba(9,9,11,0.92)',
              backdropFilter: 'blur(18px)',
              borderColor: '#27272a',
              willChange: 'opacity, transform',
            }}
          >
            {/* Left: logo — slides in from the left */}
            <motion.div
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: DUR, ease: EASE, delay: 0.18 }}
              className="w-auto min-w-[6rem] shrink-0"
            >
              <span
                className="text-xl font-semibold select-none"
                style={{ fontFamily: "'Audiowide', cursive", color: '#fafafa', letterSpacing: '-0.02em' }}
              >
                Trace
              </span>
            </motion.div>

            {/* Center: search bar — fades + scales in */}
            <motion.div
              initial={{ opacity: 0, scaleX: 0.92 }}
              animate={{ opacity: 1, scaleX: 1 }}
              transition={{ duration: DUR, ease: EASE, delay: 0.12 }}
              className="flex-1 flex justify-center"
              style={{ transformOrigin: 'center' }}
            >
              <div className="w-full max-w-2xl">
                <SearchInput {...inputProps} compact autoFocus />
              </div>
            </motion.div>

            {/* Right: NIM GPT ACTIVE badge */}
            <motion.div
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: DUR, ease: EASE, delay: 0.22 }}
              className="w-auto min-w-[6rem] shrink-0 flex justify-end"
            >
              <span
                className="px-2.5 py-1 rounded-full text-[10px] font-medium border whitespace-nowrap"
                style={{
                  backgroundColor: '#18181b',
                  borderColor: '#27272a',
                  color: '#71717a',
                  fontFamily: "'Geist Mono', monospace",
                  letterSpacing: '0.08em',
                }}
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 align-middle shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                NIM GPT
              </span>
            </motion.div>
          </motion.header>
        )}
      </AnimatePresence>

      {/* ── PAGE BODY ──────────────────────────────────────────────────── */}
      <div
        className="relative z-10 flex flex-col items-center px-4 w-full min-h-screen justify-start"
        style={{
          paddingTop: isResultsMode ? '5rem' : 'calc(50vh - 180px)',
          transition: `padding-top ${DUR}s cubic-bezier(0.32, 0.72, 0, 1)`,
        }}
      >

        {/* HERO — smoothly floats up and fades out when typing starts */}
        <AnimatePresence mode="wait">
          {!isResultsMode && (
            <motion.div
              key="hero"
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{
                opacity: 0,
                y: -40,
                transition: { duration: DUR, ease: EASE },
              }}
              transition={{ duration: 0.45, ease: EASE }}
              style={{ willChange: 'opacity, transform' }}
              className="text-center w-full max-w-2xl flex flex-col items-center"
            >
              <div className="inline-flex items-center gap-2 mb-7">
                <NoiseBackground
                  containerClassName="rounded-full p-[1.5px]"
                  gradientColors={[
                    'rgb(16, 185, 129)',
                    'rgb(52, 211, 153)',
                    'rgb(6, 78, 59)',
                    'rgb(5, 150, 105)',
                  ]}
                  noiseOpacity={0.22}
                  noiseFrequency={0.8}
                >
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs"
                    style={{
                      backgroundColor: '#080a09',
                      fontFamily: 'ui-monospace, monospace',
                      letterSpacing: '0.04em',
                    }}
                  >
                    <span style={{ color: '#3f3f46' }}>ai</span>
                    <span style={{ color: '#27272a' }}>/</span>
                    <span style={{ color: '#34d399', fontWeight: 600 }}>nim</span>
                    <span style={{ color: '#27272a' }}>·</span>
                    <span style={{ color: '#52525b' }}>llama-3.1-70b</span>
                  </span>
                </NoiseBackground>
              </div>

              <div>
                <TextAnimate
                  as="h1"
                  animation="blurInUp"
                  by="character"
                  once={true}
                  className="text-6xl font-semibold tracking-tight mb-3"
                  style={{ color: '#fafafa', letterSpacing: '-0.03em', fontFamily: "'Audiowide', cursive" }}
                >
                  Trace
                </TextAnimate>
              </div>
              <p className="text-base mb-8" style={{ color: '#a1a1aa' }}>
                Search engine for{' '}
                <span style={{ filter: 'drop-shadow(0 0 12px rgba(52,211,153,0.55))' }}>
                  <CanvasText
                    text="developers"
                    className="font-bold text-lg"
                    backgroundClassName="bg-emerald-800"
                    colors={[
                      '#34d399',
                      '#a7f3d0',
                      '#10b981',
                      '#6ee7b7',
                      '#34d399',
                      '#a7f3d0',
                      '#059669',
                      '#6ee7b7',
                    ]}
                    lineGap={1.5}
                    lineWidth={3.5}
                    animationDuration={8}
                    curveIntensity={28}
                  />
                </span>{' '}by a developer
              </p>

              <div className="relative w-full">
                <SearchInput {...inputProps} autoFocus />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* RESULTS */}
        <div className="w-full max-w-2xl">

          {/* AI Terminal */}
          <AnimatePresence>
            {isResultsMode && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.35, ease: 'easeOut', delay: 0.05 }}
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
                  {!isAITriggered && !isAILoading && !completion && (
                    <div className="flex items-center gap-2 text-zinc-500/80 text-sm italic">
                      Press <kbd className="font-sans px-1.5 py-0.5 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-400 text-xs shadow-sm">Enter</kbd> to generate an AI summary
                    </div>
                  )}
                </Terminal>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Traditional Results */}
          <AnimatePresence>
            {results.length > 0 && (() => {
              const totalPages = Math.ceil(results.length / PAGE_SIZE);
              const pageResults = results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

              return (
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="w-full mt-4 relative z-0"
                >
                  {/* Header row */}
                  <div className="flex items-center justify-between mb-6 pl-1">
                    <h3 className="text-zinc-500 text-xs font-semibold tracking-wider uppercase border-l-2 border-zinc-800 pl-2">
                      Source Results
                    </h3>
                    <span className="text-zinc-600 text-xs font-mono">
                      {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, results.length)} of {results.length}
                    </span>
                  </div>

                  {/* Result cards */}
                  <AnimatePresence mode="popLayout">
                    {pageResults.map((result, i) => (
                      <motion.a
                        key={result.url ?? i}
                        href={result.url}
                        target="_blank"
                        rel="noopener noreferrer"
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

                  {/* ── Pagination bar ── */}
                  {totalPages > 1 && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                      className="flex items-center justify-center gap-2 mt-6 mb-8 select-none"
                    >
                      {/* Prev */}
                      <button
                        disabled={page === 1}
                        onClick={() => { setPage(p => p - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 disabled:opacity-25 disabled:cursor-not-allowed"
                        style={{
                          backgroundColor: '#18181b',
                          border: '1px solid #27272a',
                          color: '#a1a1aa',
                        }}
                        onMouseEnter={(e) => { if (page !== 1) (e.currentTarget as HTMLElement).style.borderColor = '#3f3f46'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#27272a'; }}
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                        </svg>
                        Prev
                      </button>

                      {/* Page numbers */}
                      <div className="flex items-center gap-1">
                        {Array.from({ length: totalPages }, (_, i) => i + 1)
                          .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                          .reduce<(number | 'gap')[]>((acc, p, idx, arr) => {
                            if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('gap');
                            acc.push(p);
                            return acc;
                          }, [])
                          .map((p, idx) =>
                            p === 'gap' ? (
                              <span key={`gap-${idx}`} className="text-zinc-600 text-xs px-1">…</span>
                            ) : (
                              <button
                                key={p}
                                onClick={() => { setPage(p as number); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                                className="w-7 h-7 rounded-lg text-xs font-mono font-medium transition-all duration-150"
                                style={{
                                  backgroundColor: p === page ? '#27272a' : '#131316',
                                  border: `1px solid ${p === page ? '#3f3f46' : '#1f1f23'}`,
                                  color: p === page ? '#fafafa' : '#52525b',
                                  boxShadow: p === page ? '0 0 0 1px rgba(63,63,70,0.4)' : 'none',
                                }}
                              >
                                {p}
                              </button>
                            )
                          )
                        }
                      </div>

                      {/* Next */}
                      <button
                        disabled={page === totalPages}
                        onClick={() => { setPage(p => p + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 disabled:opacity-25 disabled:cursor-not-allowed"
                        style={{
                          backgroundColor: '#18181b',
                          border: '1px solid #27272a',
                          color: '#a1a1aa',
                        }}
                        onMouseEnter={(e) => { if (page !== totalPages) (e.currentTarget as HTMLElement).style.borderColor = '#3f3f46'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#27272a'; }}
                      >
                        Next
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                        </svg>
                      </button>
                    </motion.div>
                  )}
                </motion.div>
              );
            })()}
          </AnimatePresence>

        </div>
      </div>
    </main>
  );
}
