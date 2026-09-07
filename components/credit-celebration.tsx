'use client';
import { useEffect } from 'react';
import { Coins, X } from 'lucide-react';
import type { CreditReceipt } from '@/lib/credit-feedback';

export function CreditCelebration({ receipt, onDismiss }: { receipt: CreditReceipt; onDismiss: () => void }) {
  useEffect(() => { const timer = window.setTimeout(onDismiss, 6500); return () => window.clearTimeout(timer); }, [onDismiss]);
  return <output className="vani-credit-celebration" aria-live="polite">
    <div className="vani-coin-rain" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <span key={i} style={{ left: `${5 + (i * 37) % 90}%`, animationDelay: `${i * 75}ms` }}><Coins /></span>)}</div>
    <div className="vani-credit-receipt"><span className="vani-credit-icon"><Coins /></span><div><p>+{receipt.creditsAdded.toLocaleString('en-IN')} credits</p><span>{receipt.sandbox ? 'Sandbox top-up · ' : 'Payment confirmed · '}Balance {receipt.balance.toLocaleString('en-IN')}</span></div><button type="button" onClick={onDismiss} aria-label="Dismiss credit confirmation"><X className="size-4" /></button></div>
  </output>;
}
