'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

export function DocCode({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : 'Copy code'}
        className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1.5 text-[10px] text-white/55 opacity-0 backdrop-blur transition hover:bg-white/12 hover:text-white group-hover:opacity-100 focus-visible:opacity-100"
      >
        {copied ? (
          <>
            <Check className="size-3 text-emerald-300" /> Copied
          </>
        ) : (
          <>
            <Copy className="size-3" /> Copy
          </>
        )}
      </button>
      <pre className="overflow-x-auto rounded-2xl border border-white/8 bg-black/30 p-5 font-mono text-[10px] leading-5 text-cyan-100/68">
        <code>{children}</code>
      </pre>
    </div>
  );
}
