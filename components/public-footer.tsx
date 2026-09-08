import Link from 'next/link';
import { Activity, ArrowUpRight } from 'lucide-react';

export function PublicFooter() {
  return <footer className="vani-public-footer">
    <div className="vani-footer-top">
      <div className="vani-footer-brand"><span><Activity className="size-6" /></span><div><strong>Call Vani</strong><p>Good conversations. Meaningful next steps.</p></div></div>
      <nav aria-label="Support and legal"><h2>Support</h2><Link href="/terms">Terms & Conditions <ArrowUpRight /></Link><Link href="/privacy">Privacy Policy <ArrowUpRight /></Link><Link href="/docs">Help & API documentation <ArrowUpRight /></Link></nav>
      <nav aria-label="Your workspace"><h2>Your workspace</h2><Link href="/signup">Create an account <ArrowUpRight /></Link><Link href="/login">Sign in <ArrowUpRight /></Link><Link href="/#pricing">Plans & credits <ArrowUpRight /></Link></nav>
    </div>
    <div className="vani-footer-bottom"><span>© {new Date().getFullYear()} Call Vani. All rights reserved.</span><span>Voice · Workflows · Business</span></div>
    <div className="vani-footer-wordmark" aria-hidden="true">call vani<span>.</span></div>
  </footer>;
}
