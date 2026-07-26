'use client';

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCompletion } from '@ai-sdk/react';
import ReactMarkdown from 'react-markdown';
import { CodeBlock } from './AgentTrajectory';

interface ConceptDrawerProps {
  term: string | null;
  mainQuery: string;
  onClose: () => void;
}

export function ConceptDrawer({ term, mainQuery, onClose }: ConceptDrawerProps) {
  const { completion, complete, isLoading, setCompletion, stop } = useCompletion({
    api: '/api/explain-term',
    streamProtocol: 'text',
  });

  const prevTermRef = useRef<string | null>(null);

  useEffect(() => {
    if (term && term !== prevTermRef.current) {
      prevTermRef.current = term;
      setCompletion('');
      complete(term, { body: { term, mainQuery } });
    } else if (!term && prevTermRef.current) {
      prevTermRef.current = null;
      stop();
      setCompletion('');
    }
  }, [term, mainQuery, complete, setCompletion, stop]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && term) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [term, onClose]);

  return (
    <AnimatePresence>
      {term && (
        <>
          {/* Backdrop overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 backdrop-blur-xs z-40"
          />

          {/* Slide-Over Side Drawer */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            className="fixed right-0 top-0 bottom-0 w-96 max-w-[90vw] bg-zinc-950 border-l border-zinc-800 p-6 shadow-2xl z-50 flex flex-col justify-between overflow-y-auto"
          >
            <div>
              {/* Header Bar */}
              <div className="flex items-center justify-between pb-4 border-b border-zinc-800/80 mb-5">
                <div className="flex flex-col min-w-0 pr-2">
                  <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-1">
                    Concept Inspector
                  </span>
                  <h3 className="text-sm font-semibold text-zinc-100 truncate font-mono">
                    {term}
                  </h3>
                </div>

                <button
                  onClick={onClose}
                  type="button"
                  aria-label="Close inspector"
                  className="flex items-center justify-center w-7 h-7 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors border border-zinc-800 cursor-pointer outline-none flex-shrink-0"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Loading indicator */}
              {isLoading && !completion && (
                <div className="flex items-center gap-2.5 py-4">
                  <motion.span
                    className="w-1.5 h-1.5 rounded-full bg-zinc-500"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                  />
                  <span className="text-xs font-mono text-zinc-500">
                    Inspecting {term}…
                  </span>
                </div>
              )}

              {/* Inspection Output */}
              {completion && (
                <div className="text-xs text-zinc-300 leading-relaxed prose prose-invert max-w-none
                                prose-headings:text-zinc-200 prose-headings:text-xs prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-1
                                prose-p:my-2 prose-p:text-zinc-400
                                prose-blockquote:border-l-zinc-700 prose-blockquote:text-zinc-400">
                  <ReactMarkdown components={{ code: CodeBlock }}>{completion}</ReactMarkdown>
                </div>
              )}
            </div>

            {/* Footer tip */}
            <div className="pt-4 border-t border-zinc-900 mt-6 flex items-center justify-between text-[10px] font-mono text-zinc-600">
              <span>Press Esc to close</span>
              <span>Trace Inspector</span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
