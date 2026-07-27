'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { SearchMode } from './AgentModeSwitch';

export interface Source {
  url: string;
  title: string;
  snippet: string;
}

interface AgentTrajectoryProps {
  completion: string;
  isAILoading: boolean;
  searchMode: SearchMode;
  onSelectFollowUp?: (question: string) => void;
  onInspectConcept?: (concept: string) => void;
}

const CLOSED_SOURCES_REGEX = /\[\[SOURCES:[\s\S]*?\]\]/g;
const CLOSED_STATUS_REGEX = /\[\[STATUS:[\s\S]*?\]\]/g;
const CLOSED_STEP_REGEX = /\[\[STEP:[\s\S]*?\]\]/g;
const CLOSED_FOLLOW_UPS_REGEX = /\[\[FOLLOW_UPS:[\s\S]*?\]\]/g;

const OPEN_SOURCES_REGEX = /\[\[SOURCES:[\s\S]*$/g;
const OPEN_STATUS_REGEX = /\[\[STATUS:[\s\S]*$/g;
const OPEN_STEP_REGEX = /\[\[STEP:[\s\S]*$/g;
const OPEN_FOLLOW_UPS_REGEX = /\[\[FOLLOW_UPS:[\s\S]*$/g;

// Pre-compiled static regex cache for citations up to 20 sources (zero allocation per frame)
const CITATION_REGEX_CACHE: RegExp[] = Array.from({ length: 20 }, (_, i) => new RegExp(`\\[${i + 1}\\](?!\\()`, 'g'));

export function parseAgentCompletion(rawText: string): {
  sources: Source[];
  status: string;
  step: string;
  followUps: string[];
  concepts: string[];
  markdown: string;
} {
  let sources: Source[] = [];
  let status = '';
  let step = '';
  let followUps: string[] = [];
  let concepts: string[] = [];

  const sourcesMatch = rawText.match(/\[\[SOURCES:([\s\S]*?)\]\]/) || rawText.match(/\[\[SOURCES:([\s\S]*)/);
  if (sourcesMatch) {
    try {
      let jsonStr = sourcesMatch[1].trim();
      if (jsonStr.endsWith(']]')) jsonStr = jsonStr.slice(0, -2);
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed.sources)) sources = parsed.sources;
      if (Array.isArray(parsed.followUps)) followUps = parsed.followUps;
      if (Array.isArray(parsed.concepts)) concepts = parsed.concepts;
    } catch {
      // Regex fallback for partial streaming JSON string
      const urlMatches = Array.from(sourcesMatch[1].matchAll(/"url"\s*:\s*"([^"]+)"/g));
      const titleMatches = Array.from(sourcesMatch[1].matchAll(/"title"\s*:\s*"([^"]+)"/g));
      const fallbackSources: Source[] = [];
      urlMatches.forEach((m, i) => {
        if (m[1] && m[1].startsWith('http')) {
          fallbackSources.push({
            url: m[1],
            title: titleMatches[i]?.[1] || m[1],
            snippet: '',
          });
        }
      });
      if (fallbackSources.length > 0) sources = fallbackSources;
    }
  }

  const statusMatch = rawText.match(/\[\[STATUS:([^\]]+)\]\]/);
  if (statusMatch) status = statusMatch[1].trim();

  const stepMatch = rawText.match(/\[\[STEP:([^\]]+)\]\]/);
  if (stepMatch) step = stepMatch[1].trim();

  const followUpsMatch = rawText.match(/\[\[FOLLOW_UPS:([\s\S]*?)\]\]/);
  if (followUpsMatch) {
    try {
      const parsed = JSON.parse(followUpsMatch[1]);
      if (Array.isArray(parsed) && parsed.length > 0) followUps = parsed;
    } catch {}
  }

  // Strip all closed control tokens from markdown using static cached regexes
  let markdown = rawText
    .replace(CLOSED_SOURCES_REGEX, '')
    .replace(CLOSED_STATUS_REGEX, '')
    .replace(CLOSED_STEP_REGEX, '')
    .replace(CLOSED_FOLLOW_UPS_REGEX, '');

  // Strip any incomplete trailing control tokens currently being streamed at the end
  markdown = markdown
    .replace(OPEN_SOURCES_REGEX, '')
    .replace(OPEN_STATUS_REGEX, '')
    .replace(OPEN_STEP_REGEX, '')
    .replace(OPEN_FOLLOW_UPS_REGEX, '')
    .trim();

  sources.forEach((source, idx) => {
    const n = idx + 1;
    const regex = CITATION_REGEX_CACHE[idx] || new RegExp(`\\[${n}\\](?!\\()`, 'g');
    markdown = markdown.replace(regex, `[[${n}]](${source.url})`);
  });

  return { sources, status, step, followUps, concepts, markdown };
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// ── ChatGPT / Claude style Colorized Code Box Component ──────────────────────────
export const CodeBlock = React.memo(function CodeBlock({ node, inline, className, children, onInspectConcept, isAILoading, ...props }: any) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : '';
  const codeString = String(children).replace(/\n$/, '');

  if (inline || (!match && !codeString.includes('\n'))) {
    return (
      <code
        onClick={() => onInspectConcept?.(codeString)}
        className="text-zinc-200 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 px-1.5 py-0.5 rounded text-xs font-mono cursor-pointer transition-colors"
        title={`Click to inspect concept: ${codeString}`}
        {...props}
      >
        {children}
      </code>
    );
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(codeString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-4 rounded-xl border border-zinc-800/80 bg-zinc-950 overflow-hidden shadow-sm">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#12131a] border-b border-zinc-800/80 select-none">
        <span className="text-[11px] font-mono text-zinc-400 lowercase">
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          type="button"
          className="flex items-center gap-1.5 text-[11px] font-mono text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer bg-transparent border-none outline-none"
        >
          {copied ? (
            <span className="text-emerald-400 font-medium">Copied!</span>
          ) : (
            <>
              <svg className="w-3.5 h-3.5 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span>Copy code</span>
            </>
          )}
        </button>
      </div>

      {/* Code body — uses ultra-fast plain pre/code while streaming, upgrades to Prism syntax highlighting on finish */}
      <div className="overflow-x-auto bg-zinc-950">
        {isAILoading ? (
          <pre className="p-4 m-0 text-xs font-mono text-zinc-200 leading-relaxed overflow-x-auto whitespace-pre">
            <code>{codeString}</code>
          </pre>
        ) : (
          <SyntaxHighlighter
            language={language || 'text'}
            style={oneDark}
            customStyle={{
              margin: 0,
              padding: '1rem',
              backgroundColor: 'transparent',
              fontSize: '0.75rem',
              lineHeight: '1.6',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            }}
            codeTagProps={{
              style: {
                fontFamily: 'inherit',
              },
            }}
          >
            {codeString}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  );
});

const AGENT_THOUGHT_STEPS = [
  'Thinking…',
  'Searching live web sources…',
  'Reading retrieved pages & documentation…',
  'Extracting key insights & evidence…',
  'Analyzing technical specifications…',
  'Verifying code examples & details…',
  'Synthesizing comprehensive answer…',
  'Formulating final response…',
];

export function AgentTrajectory({
  completion, isAILoading, searchMode, onSelectFollowUp, onInspectConcept
}: AgentTrajectoryProps) {
  const [deferredCompletion, setDeferredCompletion] = useState(completion);
  const targetCompletionRef = useRef(completion);
  const currentLenRef = useRef(completion.length);
  const animFrameRef = useRef<number | null>(null);

  // Dynamic step rotator to keep user engaged while agent processes
  const [dynamicStepIndex, setDynamicStepIndex] = useState(0);

  useEffect(() => {
    if (!isAILoading) {
      setDynamicStepIndex(0);
      return;
    }
    const interval = setInterval(() => {
      setDynamicStepIndex((prev) => (prev + 1) % AGENT_THOUGHT_STEPS.length);
    }, 1400);

    return () => clearInterval(interval);
  }, [isAILoading]);

  useEffect(() => {
    targetCompletionRef.current = completion;
  }, [completion]);

  // ── Smooth Character Interpolator (Pacing Engine) ───────────────────────────
  // Smooths out bursty TCP network packets from cloud AI APIs into a fluid, 60fps continuous stream
  useEffect(() => {
    if (!isAILoading) {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      currentLenRef.current = completion.length;
      setDeferredCompletion(completion);
      return;
    }

    const tick = () => {
      const target = targetCompletionRef.current;
      const targetLen = target.length;
      let curr = currentLenRef.current;

      if (curr < targetLen) {
        const diff = targetLen - curr;
        // Dynamic pacing: catch up smoothly on large bursts, flow 2-5 chars/frame on close stream
        const step = diff > 200 ? Math.ceil(diff / 5) : diff > 50 ? Math.ceil(diff / 3) : Math.min(diff, Math.max(2, Math.ceil(diff / 2)));
        curr += step;
        currentLenRef.current = curr;
        setDeferredCompletion(target.slice(0, curr));
      }

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [isAILoading, completion]);

  // Read latest live status from stream
  const liveStatusMatches = useMemo(() => {
    return Array.from(completion.matchAll(/\[\[STATUS:([^\]]+)\]\]/g)).map(m => m[1].trim());
  }, [completion]);

  const latestLiveStatus = liveStatusMatches.length > 0
    ? liveStatusMatches[liveStatusMatches.length - 1]
    : '';

  const liveStep = useMemo(() => {
    const m = completion.match(/\[\[STEP:([^\]]+)\]\]/);
    return m ? m[1].trim() : '';
  }, [completion]);

  // Full parse (sources, markdown, followUps) runs on smoothly interpolated value
  const { sources, followUps, concepts, markdown } = useMemo(
    () => parseAgentCompletion(deferredCompletion || ''),
    [deferredCompletion]
  );

  const isAgentic = searchMode === 'agentic';

  // Dynamic status text — alternates smoothly between current backend status and engaging thought steps
  const displayStatus = useMemo(() => {
    const currentThought = AGENT_THOUGHT_STEPS[dynamicStepIndex];
    if (latestLiveStatus && dynamicStepIndex % 2 === 0) return latestLiveStatus;
    return currentThought;
  }, [latestLiveStatus, dynamicStepIndex]);

  // Memoize markdown component overrides so React does NOT unmount/remount code blocks & links on every frame
  const markdownComponents = useMemo(() => ({
    code: (props: any) => <CodeBlock {...props} isAILoading={isAILoading} onInspectConcept={onInspectConcept} />,
    a: ({ href, children }: any) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="no-underline text-zinc-500 hover:text-zinc-200 transition-colors
                   font-mono text-[10px] align-super leading-none
                   border border-zinc-800 hover:border-zinc-600
                   bg-zinc-900 hover:bg-zinc-800
                   px-1 py-px rounded"
      >
        {children}
      </a>
    ),
  }), [isAILoading, onInspectConcept]);

  return (
    <div className="w-full space-y-5">

      {/* Dynamic agent reasoning status — minimal text rotator */}
      {isAgentic && isAILoading && !markdown && (
        <AnimatePresence mode="wait">
          <motion.div
            key={displayStatus}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-2"
          >
            <span className="text-xs font-mono text-zinc-500">*</span>
            <span className="text-xs font-mono text-zinc-500">{displayStatus}</span>
          </motion.div>
        </AnimatePresence>
      )}

      {/* Source pills — compact horizontal row above key concepts */}
      <AnimatePresence>
        {isAgentic && sources.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
            className="space-y-2"
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-wider shrink-0">
                {sources.length} source{sources.length !== 1 ? 's' : ''}
              </span>
              <div className="flex-1 h-px bg-zinc-800/60" />
            </div>

            {/* Horizontal scroll row of compact source pills */}
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
              {sources.map((source, idx) => {
                const domain = getDomain(source.url);
                return (
                  <motion.a
                    key={source.url}
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: idx * 0.03 }}
                    className="group flex items-center gap-1.5 px-2 py-1 rounded-lg border border-zinc-800/70
                               bg-zinc-950 hover:border-zinc-700 hover:bg-zinc-900
                               transition-all duration-150 no-underline shrink-0 max-w-[160px]"
                    title={source.title || domain}
                  >
                    <img
                      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=16`}
                      alt=""
                      width={11}
                      height={11}
                      className="flex-shrink-0 opacity-60 rounded-[2px]"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                    <span className="text-[10px] font-mono text-zinc-500 group-hover:text-zinc-300 truncate transition-colors">
                      {domain}
                    </span>
                    <span className="flex-shrink-0 text-[9px] font-mono text-zinc-700 bg-zinc-800/80 px-1 rounded">
                      {idx + 1}
                    </span>
                  </motion.a>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Key Concepts chips */}
      <AnimatePresence>
        {concepts.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-wrap items-center gap-1.5"
          >
            <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-wider pr-0.5">
              Key Concepts:
            </span>
            {concepts.map((concept, idx) => (
              <button
                key={idx}
                onClick={() => onInspectConcept?.(concept)}
                className="group inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-mono
                           bg-zinc-900/90 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200
                           border border-zinc-800 hover:border-zinc-700 transition-all cursor-pointer outline-none"
              >
                <span>{concept}</span>
                <span className="text-zinc-600 group-hover:text-zinc-400 text-[9px]">↗</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>


      {/* The answer — with inline numbered citation links & ChatGPT/Claude style syntax highlighting */}
      <AnimatePresence>
        {markdown && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
            className={[
              'text-zinc-300 text-sm leading-[1.85] prose prose-invert max-w-none',
              'prose-headings:text-zinc-100 prose-headings:font-semibold prose-headings:tracking-tight prose-headings:mb-2 prose-headings:mt-5',
              'prose-p:text-zinc-300 prose-p:leading-[1.85] prose-p:my-3',
              'prose-strong:text-zinc-100 prose-strong:font-semibold',
              'prose-em:text-zinc-300',
              'prose-li:text-zinc-300 prose-li:leading-7',
              'prose-ul:my-3 prose-ol:my-3',
              'prose-blockquote:border-l-zinc-700 prose-blockquote:text-zinc-400',
              'prose-hr:border-zinc-800',
            ].join(' ')}
          >
            <ReactMarkdown components={markdownComponents}>
              {markdown}
            </ReactMarkdown>

            {/* Pulsing cursor indicator while model is actively streaming markdown */}
            {isAILoading && (
              <span className="inline-block w-2 h-4 ml-1 rounded-sm bg-teal-400/80 animate-pulse vertical-middle" />
            )}

            {/* AI Follow-Up Flashcards */}
            {followUps.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 }}
                className="mt-8 pt-5 border-t border-zinc-800/60"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider">
                    Suggested Follow-Ups
                  </span>
                </div>

                <div className="flex flex-col gap-2">
                  {followUps.map((question, idx) => (
                    <button
                      key={idx}
                      onClick={() => onSelectFollowUp?.(question)}
                      className="group flex items-center justify-between p-3 rounded-xl border border-zinc-800/70
                                 bg-zinc-950 hover:bg-zinc-900 hover:border-zinc-700 text-left
                                 transition-all duration-150 cursor-pointer outline-none"
                    >
                      <span className="text-xs font-medium text-zinc-300 group-hover:text-zinc-100">
                        {question}
                      </span>
                      <span className="text-zinc-600 group-hover:text-zinc-300 text-xs font-mono pl-3">
                        ↳
                      </span>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Direct search mode: simple loading state */}
      {!isAgentic && isAILoading && !markdown && (
        <div className="flex items-center gap-2.5">
          <motion.span
            className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-500"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.4, repeat: Infinity }}
          />
          <span className="text-xs font-mono text-zinc-500">Generating answer…</span>
        </div>
      )}
    </div>
  );
}
