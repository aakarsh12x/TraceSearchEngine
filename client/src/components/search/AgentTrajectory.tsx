'use client';

import { useState } from 'react';
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

export interface ToolCallStep {
  tool: string;
  label: string;
}

export function parseAgentCompletion(rawText: string): {
  sources: Source[];
  status: string;
  followUps: string[];
  concepts: string[];
  toolCalls: ToolCallStep[];
  markdown: string;
} {
  let sources: Source[] = [];
  let status = '';
  let followUps: string[] = [];
  let concepts: string[] = [];
  let toolCalls: ToolCallStep[] = [];

  const sourcesMatch = rawText.match(/\[\[SOURCES:([\s\S]*?)\]\]/);
  if (sourcesMatch) {
    try {
      const parsed = JSON.parse(sourcesMatch[1]);
      sources = parsed.sources || [];
      if (Array.isArray(parsed.followUps)) followUps = parsed.followUps;
      if (Array.isArray(parsed.concepts)) concepts = parsed.concepts;
    } catch {}
  }

  const statusMatch = rawText.match(/\[\[STATUS:([\s\S]*?)\]\]/);
  if (statusMatch) status = statusMatch[1].trim();

  // Parse all [[TOOL_CALL:tool|label]] tokens
  const toolCallRegex = /\[\[TOOL_CALL:([^|\]]+)\|([^\]]+)\]\]/g;
  let tc;
  while ((tc = toolCallRegex.exec(rawText)) !== null) {
    toolCalls.push({ tool: tc[1].trim(), label: tc[2].trim() });
  }

  const followUpsMatch = rawText.match(/\[\[FOLLOW_UPS:([\s\S]*?)\]\]/);
  if (followUpsMatch) {
    try {
      const parsed = JSON.parse(followUpsMatch[1]);
      if (Array.isArray(parsed) && parsed.length > 0) followUps = parsed;
    } catch {}
  }

  // Strip all control tokens from markdown
  let markdown = rawText
    .replace(/\[\[SOURCES:[\s\S]*?\]\]/g, '')
    .replace(/\[\[STATUS:[\s\S]*?\]\]/g, '')
    .replace(/\[\[TOOL_CALL:[^\]]*\]\]/g, '')
    .replace(/\[\[FOLLOW_UPS:[\s\S]*?\]\]/g, '')
    .replace(/\[\[FOLLOW_UPS:[\s\S]*/g, '')
    .replace(/\[\[SOURCES:[\s\S]*/g, '')
    .replace(/\[\[STATUS:[\s\S]*/g, '')
    .replace(/\[\[TOOL_CALL:[\s\S]*/g, '')
    .trim();

  sources.forEach((source, idx) => {
    const n = idx + 1;
    markdown = markdown.replace(
      new RegExp(`\\[${n}\\](?!\\()`, 'g'),
      `[[${n}]](${source.url})`
    );
  });

  return { sources, status, followUps, concepts, toolCalls, markdown };
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// ── ChatGPT / Claude style Colorized Code Box Component ──────────────────────────
export function CodeBlock({ node, inline, className, children, onInspectConcept, ...props }: any) {
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

      {/* Code body with full Prism color syntax highlighting */}
      <div className="overflow-x-auto bg-zinc-950">
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
      </div>
    </div>
  );
}

// Tool icon map for visual hints
function ToolIcon({ tool }: { tool: string }) {
  if (tool === 'fetch_full_page') {
    return (
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    );
  }
  // search_web icon
  return (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}

export function AgentTrajectory({
  completion, isAILoading, searchMode, onSelectFollowUp, onInspectConcept
}: AgentTrajectoryProps) {
  const { sources, status, followUps, concepts, toolCalls, markdown } = parseAgentCompletion(completion || '');
  const isAgentic = searchMode === 'agentic';

  return (
    <div className="w-full space-y-5">

      {/* Pre-sources loading state */}
      {isAgentic && isAILoading && sources.length === 0 && (
        <div className="flex items-center gap-2.5">
          <motion.span
            className="inline-block w-1.5 h-1.5 rounded-full bg-teal-500"
            animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
          />
          <span className="text-xs font-mono text-zinc-400">
            {status || 'Searching the web…'}
          </span>
        </div>
      )}

      {/* Tool Call Activity Feed — shows each ReAct step the agent takes */}
      <AnimatePresence>
        {isAgentic && toolCalls.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-1.5"
          >
            {toolCalls.map((step, idx) => {
              const isDone = !isAILoading || idx < toolCalls.length - 1;
              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05, duration: 0.2 }}
                  className="flex items-center gap-2"
                >
                  {/* Step indicator */}
                  {isDone ? (
                    <span className="flex-shrink-0 w-4 h-4 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  ) : (
                    <motion.span
                      className="flex-shrink-0 w-4 h-4 rounded-full bg-zinc-900 border border-teal-500/50 flex items-center justify-center"
                      animate={{ borderColor: ['rgba(20,184,166,0.3)', 'rgba(20,184,166,0.8)', 'rgba(20,184,166,0.3)'] }}
                      transition={{ duration: 1.4, repeat: Infinity }}
                    >
                      <motion.span
                        className="w-1.5 h-1.5 rounded-full bg-teal-400"
                        animate={{ opacity: [0.4, 1, 0.4] }}
                        transition={{ duration: 1.2, repeat: Infinity }}
                      />
                    </motion.span>
                  )}

                  {/* Tool name badge + label */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono flex-shrink-0 ${
                      isDone
                        ? 'bg-zinc-900 text-zinc-500 border border-zinc-800'
                        : 'bg-teal-950/60 text-teal-400 border border-teal-800/60'
                    }`}>
                      <ToolIcon tool={step.tool} />
                      {step.tool}
                    </span>
                    <span className="text-xs font-mono text-zinc-500 truncate min-w-0">
                      {step.label}
                    </span>
                  </div>
                </motion.div>
              );
            })}

            {/* Synthesizing state after tool calls while answer streams in */}
            {isAILoading && toolCalls.length > 0 && !markdown && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-2 pl-0"
              >
                <motion.span
                  className="flex-shrink-0 w-4 h-4 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center"
                  animate={{ borderColor: ['rgba(113,113,122,0.4)', 'rgba(113,113,122,0.9)', 'rgba(113,113,122,0.4)'] }}
                  transition={{ duration: 1.4, repeat: Infinity }}
                >
                  <motion.span className="w-1.5 h-1.5 rounded-full bg-zinc-400"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.2, repeat: Infinity }}
                  />
                </motion.span>
                <span className="text-xs font-mono text-zinc-500">Synthesizing answer…</span>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Source cards — the core proof of live web retrieval */}
      <AnimatePresence>
        {isAgentic && sources.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
          >
            {/* Section header */}
            <div className="flex items-center gap-3 mb-3">
              <span className="text-[11px] font-mono text-zinc-600 uppercase tracking-wider">
                {sources.length} source{sources.length !== 1 ? 's' : ''} retrieved
              </span>
              <div className="flex-1 h-px bg-zinc-800" />
            </div>

            {/* Source card grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {sources.map((source, idx) => {
                const domain = getDomain(source.url);
                return (
                  <motion.a
                    key={source.url}
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: idx * 0.04 }}
                    className="group flex flex-col gap-1.5 p-3 rounded-xl border border-zinc-800/60
                               bg-zinc-950 hover:border-zinc-700 hover:bg-zinc-900/80
                               transition-all duration-150 no-underline"
                  >
                    {/* Domain row */}
                    <div className="flex items-center gap-2 min-w-0">
                      <img
                        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=16`}
                        alt=""
                        width={12}
                        height={12}
                        className="flex-shrink-0 opacity-70 rounded-[2px]"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                      <span className="text-[10px] font-mono text-zinc-500 truncate flex-1 min-w-0">
                        {domain}
                      </span>
                      <span
                        className="flex-shrink-0 text-[10px] font-mono text-zinc-600
                                   bg-zinc-800 px-1.5 py-0.5 rounded"
                      >
                        {idx + 1}
                      </span>
                    </div>

                    {/* Title */}
                    <p className="text-xs font-medium text-zinc-400 group-hover:text-zinc-200
                                  line-clamp-2 leading-snug transition-colors duration-100">
                      {source.title || domain}
                    </p>
                  </motion.a>
                );
              })}
            </div>

            {/* Thin separator before answer */}
            <div className="mt-5 border-t border-zinc-800/40" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Key Concepts Chips Bar (Clickable Side Inspector Trigger) */}
      <AnimatePresence>
        {concepts.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-wrap items-center gap-2 pt-1"
          >
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider pr-1">
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

      {/* Synthesizing fallback (if no tool calls streamed yet) */}
      {isAgentic && isAILoading && sources.length > 0 && !markdown && toolCalls.length === 0 && (
        <div className="flex items-center gap-2.5">
          <motion.span
            className="inline-block w-1.5 h-1.5 rounded-full bg-teal-500"
            animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
          />
          <span className="text-xs font-mono text-zinc-400">Synthesizing answer…</span>
        </div>
      )}

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
            <ReactMarkdown
              components={{
                code: (props) => <CodeBlock {...props} onInspectConcept={onInspectConcept} />,
                a: ({ href, children }) => (
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
              }}
            >
              {markdown}
            </ReactMarkdown>

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
