'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

export function DocCode({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setCopyError(false);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : 'Copy code'}
        className="absolute right-3 top-3 z-10 flex min-h-9 items-center gap-1.5 rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-xs text-ink-body"
      >
        {copied ? (
          <>
            <Check className="size-3 text-success-text" /> Copied
          </>
        ) : (
          <>
            <Copy className="size-3" /> Copy
          </>
        )}
      </button>
      <pre className="overflow-x-auto rounded-2xl border border-hairline bg-surface-muted px-5 pb-5 pt-16 font-mono text-sm leading-6 text-ink-body">
        <code>{children}</code>
      </pre>
      {copyError ? <output className="mt-2 block text-sm">Clipboard unavailable. Select the code to copy it.</output> : null}
    </div>
  );
}
