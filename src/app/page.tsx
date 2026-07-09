'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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
const DUR = 0.38;

type SearchResult = {
  url: string;
  title?: string;
  description?: string;
  content?: string;
};

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
  inputRef?: React.RefObject<HTMLInputElement | null>;
  autoFocus?: boolean;
}

function SearchInput({
  query, isFocused, compact, onChange, onKeyDown, onFocus, onBlur,
  onSearch, isLoading, inputRef, autoFocus,
}: SearchInputProps) {
  const canSearch = query.trim().length >= 2 && !isLoading;

  return (
    <div className="relative w-full">
      <SearchIcon small={compact} />
      <input
        ref={inputRef}
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
          transition: 'border-color 0.18s ease, box-shadow 0.18s ease, background-color 0.18s ease',
          borderRadius: '0.65rem',
          fontSize: compact ? '0.875rem' : '1rem',
          paddingLeft: '2.6rem',
          paddingRight: '3.4rem',
          paddingTop: compact ? '0.55rem' : '1.2rem',
          paddingBottom: compact ? '0.55rem' : '1.2rem',
          backgroundColor: isFocused ? '#17181c' : '#111216',
          border: `1px solid ${isFocused ? '#2dd4bf' : '#2a2d34'}`,
          color: '#fafafa',
          boxShadow: isFocused
            ? '0 0 0 3px rgba(45,212,191,0.12)'
            : compact ? 'none' : '0 18px 60px rgba(0,0,0,0.32)',
        }}
      />
      <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
        {isLoading ? (
          <div className={`spinner ${compact ? '' : 'mr-1'}`} />
        ) : (
          <motion.button
            onClick={onSearch}
            disabled={!canSearch}
            aria-label="Search with AI"
            className="flex items-center justify-center border-none outline-none"
            style={{
              width: compact ? '1.85rem' : '2.3rem',
              height: compact ? '1.85rem' : '2.3rem',
              borderRadius: compact ? '10px' : '12px',
              backgroundColor: canSearch ? '#2dd4bf' : 'rgba(255, 255, 255, 0.02)',
              color: canSearch ? '#090a0d' : '#52525b',
              boxShadow: canSearch ? '0 0 10px rgba(45, 212, 191, 0.3)' : 'none',
              cursor: canSearch ? 'pointer' : 'not-allowed',
            }}
            whileHover={canSearch ? {
              backgroundColor: '#5eead4',
              boxShadow: '0 0 15px rgba(45, 212, 191, 0.5)',
              scale: 1.05,
            } : {}}
            whileTap={canSearch ? {
              scale: 0.95,
            } : {}}
            transition={{ type: 'spring', stiffness: 400, damping: 17 }}
          >
            <ArrowRightIcon className={`opacity-90 ${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
          </motion.button>
        )}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoadingResults, setIsLoadingResults] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isAITriggered, setIsAITriggered] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;
  const heroInputRef = useRef<HTMLInputElement>(null);
  const compactInputRef = useRef<HTMLInputElement>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchRequestRef = useRef(0);
  const lastSubmittedQueryRef = useRef('');
  const keepSearchFocusRef = useRef(true);

  // ── Index readiness polling ───────────────────────────────────────────────
  // A module-level ref ensures React Strict Mode's double effect invocation
  // shares the same cancelled flag — preventing two concurrent poll loops.
  const [showReadyBanner, setShowReadyBanner] = useState(true);
  const pollingStoppedRef = useRef(false);

  useEffect(() => {
    // Reset on mount (handles Strict Mode remount)
    pollingStoppedRef.current = false;
    let timerId: ReturnType<typeof setTimeout>;

    const dismiss = () => {
      pollingStoppedRef.current = true;
      setShowReadyBanner(false);
      clearTimeout(timerId);
    };

    // Hard fallback: always dismiss after 15 s even if backend never responds ready
    const fallback = setTimeout(dismiss, 15_000);

    const poll = async () => {
      if (pollingStoppedRef.current) return;
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        if (data.indexReady) {
          clearTimeout(fallback);
          dismiss();
          return; // stop — index is ready
        }
      } catch {
        // Backend not reachable yet — keep trying
      }
      if (!pollingStoppedRef.current) {
        timerId = setTimeout(poll, 1_500);
      }
    };

    poll();
    return () => {
      pollingStoppedRef.current = true;
      clearTimeout(timerId);
      clearTimeout(fallback);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Smoothly morph to results mode as soon as they type or trigger search (Google-style)
  const isResultsMode = isAITriggered || hasSearched || query.trim().length >= 2;

  const { completion, complete, isLoading: isAILoading, setCompletion, stop } = useCompletion({
    api: '/api/ai-answer',
    streamProtocol: 'text',
  });

  const runSearch = useCallback(async (term: string) => {
    const trimmed = term.trim();
    if (trimmed.length < 2) return [] as SearchResult[];

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    searchAbortRef.current = controller;
    setIsLoadingResults(true);

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Search failed with ${res.status}`);
      const data = await res.json();
      const nextResults = (data.results || []).filter((r: SearchResult) => r?.url);

      if (controller.signal.aborted || requestId !== searchRequestRef.current) {
        return [] as SearchResult[];
      }

      setResults(nextResults);
      return nextResults;
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error('Search error:', err);
      }
      if (requestId === searchRequestRef.current && !controller.signal.aborted) {
        setResults([]);
      }
      return [] as SearchResult[];
    } finally {
      if (requestId === searchRequestRef.current && !controller.signal.aborted) {
        setIsLoadingResults(false);
      }
      if (searchAbortRef.current === controller) {
        searchAbortRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    const trimmed = query.trim();

    // 1. If user edited the query after submitting, cancel AI generation and reset
    if (lastSubmittedQueryRef.current && trimmed !== lastSubmittedQueryRef.current) {
      stop();
      setCompletion('');
      setIsAITriggered(false);
      lastSubmittedQueryRef.current = '';
    }

    // 2. Handle completely empty query (return to Home / Hero state)
    if (trimmed.length === 0) {
      searchAbortRef.current?.abort();
      setIsLoadingResults(false);
      setResults([]);
      setHasSearched(false);
      setPage(1);
      stop();
      setIsAITriggered(false);
      setCompletion('');
      lastSubmittedQueryRef.current = '';
      return;
    }

    // 3. Handle short query (1 character) - keep in Results mode if already there, but clear results
    if (trimmed.length < 2) {
      searchAbortRef.current?.abort();
      setIsLoadingResults(false);
      setResults([]);
      return;
    }

    // 4. Handle valid search query (>= 2 characters) - trigger search with debounce
    const t = setTimeout(() => {
      setHasSearched(true);
      setPage(1);
      void runSearch(trimmed);
    }, 500);
    return () => clearTimeout(t);
  }, [query, runSearch, setCompletion, stop]);

  useEffect(() => {
    return () => {
      searchAbortRef.current?.abort();
      stop();
    };
  }, [stop]);

  // AI trigger (manual)
  const handleSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    stop();
    setIsAITriggered(true);
    setCompletion('');
    setHasSearched(true);
    setPage(1);
    lastSubmittedQueryRef.current = trimmed;

    const cur = await runSearch(trimmed);
    if (cur.length > 0 && lastSubmittedQueryRef.current === trimmed) {
      complete(trimmed, { body: { results: cur.slice(0, 4) } });
    }
  }, [complete, query, runSearch, setCompletion, stop]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleSearch();
    }
  }, [handleSearch]);

  // Stable callbacks — wrapped in useCallback so SearchInput never re-renders
  // due to a new function reference on unrelated state changes.
  const handleFocus = useCallback(() => {
    keepSearchFocusRef.current = true;
    setIsFocused(true);
  }, []);
  const handleBlur = useCallback(() => {
    requestAnimationFrame(() => {
      const active = document.activeElement;
      const stillInSearch = active === heroInputRef.current || active === compactInputRef.current;
      keepSearchFocusRef.current = stillInSearch;
      setIsFocused(stillInSearch);
    });
  }, []);

  // ── Focus management: when layout flips to results mode the hero input
  // unmounts and the compact top-bar input mounts. Using a ref + effect keeps
  // the cursor alive through the animation instead of relying on autoFocus
  // (which fires on DOM insertion and races with Framer Motion transitions).
  useEffect(() => {
    if (isResultsMode) {
      // requestAnimationFrame defers until after the browser has painted the
      // new DOM node, so the compact input is guaranteed to exist.
      const raf = requestAnimationFrame(() => {
        const node = compactInputRef.current;
        if (!node || !keepSearchFocusRef.current) return;
        node.focus({ preventScroll: true });
        const end = node.value.length;
        node.setSelectionRange(end, end);
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [isResultsMode]);

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
    <main className="relative min-h-screen overflow-x-hidden" style={{ backgroundColor: '#090a0d' }}>

      {/* ── INDEX READINESS BANNER ───────────────────────────────────────── */}
      <AnimatePresence>
        {showReadyBanner && (
          <motion.div
            key="index-banner"
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95, transition: { duration: 0.4, ease: 'easeIn' } }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="fixed bottom-5 right-5 z-[100] flex items-center gap-2.5 px-3.5 py-2 rounded-xl select-none"
            style={{
              backgroundColor: 'rgba(9,9,11,0.88)',
              border: '1px solid #27272a',
              backdropFilter: 'blur(14px)',
              boxShadow: '0 4px 24px rgba(0,0,0,0.45)',
              fontFamily: "'Geist Mono', ui-monospace, monospace",
            }}
          >
            {/* Amber pulsing dot */}
            <span
              className="inline-block w-2 h-2 rounded-full flex-shrink-0"
              style={{
                backgroundColor: '#f59e0b',
                boxShadow: '0 0 8px rgba(245,158,11,0.8)',
                animation: 'pulse 1.4s ease-in-out infinite',
              }}
            />

            {/* Label */}
            <span className="text-[11px] font-medium" style={{ color: '#71717a', letterSpacing: '0.04em' }}>
              Getting ready{'\u2009·\u2009'}loading index…
            </span>

            {/* Shimmer progress bar */}
            <span
              className="absolute bottom-0 left-0 h-[2px] rounded-b-xl overflow-hidden w-full"
              style={{ background: 'transparent' }}
            >
              <span
                className="block h-full w-1/2 rounded-full"
                style={{
                  background: 'linear-gradient(90deg, transparent, #f59e0b88, transparent)',
                  animation: 'shimmer-bar 1.6s ease-in-out infinite',
                }}
              />
            </span>
          </motion.div>
        )}
      </AnimatePresence>


      {/* Aurora green glow — slides down and fades when search activates */}
      <div
        className="fixed bottom-0 left-0 right-0 h-[38vh] overflow-hidden pointer-events-none select-none"
        style={{
          zIndex: 1,
          maskImage: 'linear-gradient(to top, black 0%, black 25%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to top, black 0%, black 25%, transparent 100%)',
          transform: isResultsMode ? 'translateY(100%)' : 'translateY(0%)',
          opacity: isResultsMode ? 0 : 1,
          transition: `transform ${DUR}s cubic-bezier(0.32,0.72,0,1), opacity ${DUR * 0.8}s ease`,
          willChange: 'transform, opacity',
        }}
      >
        <Aurora
          colorStops={['#00ff88', '#34b857', '#2dd4bf']}
          amplitude={1.4}
          blend={0.5}
          speed={0.7}
        />
      </div>

      {/* ── FIXED TOP BAR (results mode) ──────────────────────────────── */}
      <AnimatePresence>
        {isResultsMode && (
          <motion.header
            key="topbar"
            initial={{ opacity: 0, y: -28 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: DUR, ease: EASE }}
            className="fixed top-0 left-0 right-0 z-50 flex items-center gap-4 px-4 sm:px-6 py-3 border-b"
            style={{
              backgroundColor: 'rgba(9,10,13,0.88)',
              backdropFilter: 'blur(18px)',
              borderColor: '#22262d',
              willChange: 'opacity, transform',
            }}
          >
            {/* Left: logo — slides in from the left */}
            <motion.div
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.28, ease: EASE, delay: 0.04 }}
              className="hidden sm:block w-auto min-w-[5rem] shrink-0"
            >
              <span
                className="text-xl font-semibold select-none"
                style={{ fontFamily: "'Audiowide', cursive", color: '#f8fafc', letterSpacing: '0' }}
              >
                Trace
              </span>
            </motion.div>

            {/* Center: search bar — fades + scales in */}
            <motion.div
              initial={{ opacity: 0, scaleX: 0.92 }}
              animate={{ opacity: 1, scaleX: 1 }}
              transition={{ duration: 0.28, ease: EASE }}
              className="flex-1 flex justify-center min-w-0"
              style={{ transformOrigin: 'center' }}
            >
              <div className="w-full max-w-2xl">
                <SearchInput {...inputProps} compact inputRef={compactInputRef} />
              </div>
            </motion.div>

            {/* Right: NIM GPT ACTIVE badge */}
            <motion.div
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.28, ease: EASE, delay: 0.06 }}
              className="hidden sm:flex w-auto min-w-[5rem] shrink-0 justify-end"
            >
              <span
                className="px-2.5 py-1 rounded-full text-[10px] font-medium border whitespace-nowrap"
                style={{
                  backgroundColor: '#111216',
                  borderColor: '#2a2d34',
                  color: '#a1a1aa',
                  fontFamily: "'Geist Mono', monospace",
                  letterSpacing: '0.08em',
                }}
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-teal-400 mr-1.5 align-middle shadow-[0_0_8px_rgba(45,212,191,0.55)]" />
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
        }}
      >

        {/* HERO — floats up and fades out when typing starts */}
        <AnimatePresence mode="popLayout">
          {!isResultsMode && (
            <motion.div
              key="hero"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{
                opacity: 0,
                y: -22,
                transition: { duration: 0.24, ease: EASE },
              }}
              transition={{ duration: 0.34, ease: EASE }}
              style={{ willChange: 'opacity, transform' }}
              className="text-center w-full max-w-2xl flex flex-col items-center"
            >
              <div className="inline-flex items-center gap-2 mb-7">
                <NoiseBackground
                  containerClassName="rounded-full p-[1.5px]"
                  gradientColors={[
                    'rgb(45, 212, 191)',
                    'rgb(96, 165, 250)',
                    'rgb(20, 184, 166)',
                    'rgb(15, 23, 42)',
                  ]}
                  noiseOpacity={0.16}
                  noiseFrequency={0.8}
                >
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs"
                    style={{
                      backgroundColor: '#090a0d',
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
                  className="text-6xl font-semibold mb-3"
                  style={{ color: '#f8fafc', letterSpacing: '0', fontFamily: "'Audiowide', cursive" }}
                >
                  Trace
                </TextAnimate>
              </div>
              <p className="text-base mb-8" style={{ color: '#b6beca' }}>
                Search engine for{' '}
                <span style={{ filter: 'drop-shadow(0 0 12px rgba(45,212,191,0.45))' }}>
                  <CanvasText
                    text="developers"
                    className="font-bold text-lg"
                    backgroundClassName="bg-teal-900"
                    colors={[
                      '#5eead4',
                      '#bfdbfe',
                      '#2dd4bf',
                      '#93c5fd',
                      '#5eead4',
                      '#bfdbfe',
                      '#14b8a6',
                      '#93c5fd',
                    ]}
                    lineGap={1.5}
                    lineWidth={3.5}
                    animationDuration={8}
                    curveIntensity={28}
                  />
                </span>{' '}by a developer
              </p>

              <div className="relative w-full">
                <SearchInput {...inputProps} inputRef={heroInputRef} autoFocus />  {/* hero: autoFocus is safe here, it only fires once on initial page load */}
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
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="w-full mt-4 relative z-10"
                style={{ willChange: 'opacity, transform' }}
              >
                <Terminal sequence={false} className="w-full shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
                  <div className="flex items-center gap-2 mb-3 text-[10px] font-bold uppercase tracking-widest text-teal-300/85">
                    <span className="flex h-1.5 w-1.5 rounded-full bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.5)]" />
                    Answer Engine
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
                  {isAITriggered && !isAILoading && !completion && results.length === 0 && !isLoadingResults && (
                    <div className="text-zinc-500/80 text-sm italic">No source context found for an AI answer.</div>
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
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.22, ease: 'easeOut' }}
                  className="w-full mt-4 relative z-0"
                >
                  {/* Header row */}
                  <div className="flex items-center justify-between mb-6 pl-1">
                    <h3 className="text-zinc-500 text-xs font-semibold tracking-wider uppercase border-l-2 border-teal-500/40 pl-2">
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
                        transition={{ delay: i * 0.015, duration: 0.18, ease: 'easeOut' }}
                        className="group flex flex-col mb-3 p-4 rounded-lg border border-[#242832] bg-[#111216] hover:border-[#2dd4bf]/40 hover:bg-[#151821] transition-all duration-200 no-underline text-inherit"
                      >
                        <p className="text-xs mb-1.5 truncate text-zinc-500 font-mono">{result.url}</p>
                        <h2 className="text-sm font-medium mb-1.5 flex items-center text-zinc-100">
                          {result.title || result.url}
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
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[#242832] bg-[#111216] text-[#a1a1aa] hover:enabled:border-[#2dd4bf]/40 transition-all duration-150 disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer"
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
                                className={`w-7 h-7 rounded-lg text-xs font-mono font-medium border transition-all duration-150 cursor-pointer ${
                                  p === page
                                    ? 'bg-[#173b3b] border-[#2dd4bf]/40 text-[#ecfeff] shadow-[0_0_0_1px_rgba(45,212,191,0.18)]'
                                    : 'bg-[#111216] border-[#242832] text-[#64748b] hover:border-[#2dd4bf]/40'
                                }`}
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
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[#242832] bg-[#111216] text-[#a1a1aa] hover:enabled:border-[#2dd4bf]/40 transition-all duration-150 disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer"
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
