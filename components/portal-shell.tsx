'use client';

import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  BookOpenText,
  ChevronDown,
  Coins,
  LogOut,
  Menu,
  Search,
  X,
} from 'lucide-react';

import { NotificationBell } from '@/components/notification-center';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/components/locale-provider';
import { PORTAL_LOCALES, type TranslationKey } from '@/lib/i18n';

export type PortalNavGroup = {
  label: string;
  /** When present, the label is translated; `label` is the English fallback. */
  translationKey?: TranslationKey;
  items: {
    id: string;
    label: string;
    icon: LucideIcon;
    badge?: string;
    translationKey?: TranslationKey;
  }[];
};

type PortalShellProps = {
  mode: 'admin' | 'customer';
  active: string;
  groups: PortalNavGroup[];
  onNavigate: (id: string) => void;
  name: string;
  email: string;
  workspace?: string | null;
  credits?: number;
  children: React.ReactNode;
};

export function PortalShell({
  mode,
  active,
  groups,
  onNavigate,
  name,
  email,
  workspace,
  credits,
  children,
}: PortalShellProps) {
  const { locale, setLocale, t } = useLocale();
  const activeItem = groups
    .flatMap((group) => group.items)
    .find((item) => item.id === active);
  const [mobileOpen, setMobileOpen] = useState(false);

  const drawerRef = useRef<HTMLDialogElement>(null);

  /**
   * The drawer is a real `<dialog>` opened as a modal, which is what makes
   * Escape, the backdrop, focus containment and inertness of the page behind
   * it the browser's job rather than four hand-written listeners that each
   * have to be got right. Only the page's own scrolling is left to us.
   */
  useEffect(() => {
    const drawer = drawerRef.current;
    if (!drawer) return;
    if (mobileOpen && !drawer.open) drawer.showModal();
    if (!mobileOpen && drawer.open) drawer.close();
    if (!mobileOpen) return;
    // A click that lands on the dialog element itself landed on its backdrop —
    // every part of the panel is a child, so nothing else reaches here. Bound
    // as a listener rather than in JSX because a `<dialog>` is interactive
    // already and its keyboard equivalent, Escape, is the browser's.
    const onBackdrop = (event: MouseEvent) => {
      if (event.target === drawer) setMobileOpen(false);
    };
    drawer.addEventListener('click', onBackdrop);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      drawer.removeEventListener('click', onBackdrop);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen]);

  /**
   * A phone turned sideways into the desktop layout would otherwise leave the
   * drawer open on top of the sidebar it duplicates.
   */
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1024px)');
    const sync = () => {
      if (wide.matches) setMobileOpen(false);
    };
    wide.addEventListener('change', sync);
    return () => wide.removeEventListener('change', sync);
  }, []);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.assign(mode === 'admin' ? '/admin/login' : '/login');
  }

  return (
    <main className="portal-shell min-h-screen text-ink lg:grid lg:grid-cols-[244px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen border-r border-hairline bg-surface-muted/88 backdrop-blur-2xl lg:flex lg:flex-col">
        <Link
          href="/"
          className="flex h-[74px] items-center gap-3 border-b border-hairline px-5"
        >
          <span className="grid size-9 place-items-center rounded-xl border border-hairline bg-white text-black shadow-[0_12px_34px_-14px_rgba(255,255,255,.7)]">
            <Activity className="size-5" />
          </span>
          <span>
            <span className="block text-sm font-semibold">Vaani</span>
            <span className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-muted">
              {mode === 'admin' ? 'Platform admin' : 'Revenue Voice OS'}
            </span>
          </span>
        </Link>

        <div className="border-b border-hairline p-3">
          <div className="flex items-center gap-2.5 rounded-xl border border-hairline bg-surface-strong p-2.5">
            <Avatar className="size-8 border border-hairline">
              <AvatarFallback className="bg-surface-strong text-xs text-ink">
                {(workspace || name).slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">
                {workspace || 'Vaani Platform'}
              </p>
              <p className="truncate text-[11px] text-ink-muted">
                {mode === 'admin' ? 'Global control plane' : 'Growth workspace'}
              </p>
            </div>
            <ChevronDown className="size-3.5 text-ink-muted" />
          </div>
        </div>

        <NavList
          groups={groups}
          active={active}
          onNavigate={onNavigate}
          label={`${mode} navigation`}
          t={t}
        />

        <div className="border-t border-hairline p-3">
          <div className="mb-2 flex items-center gap-2 rounded-lg px-2 py-2">
            <Avatar className="size-8">
              <AvatarFallback className="bg-surface-strong text-[11px]">
                {name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-medium">{name}</p>
              <p className="truncate text-[11px] text-ink-muted">{email}</p>
            </div>
            <button
              type="button"
              onClick={logout}
              className="rounded-md p-2 text-ink-muted hover:bg-surface-strong hover:text-ink"
              aria-label="Log out"
            >
              <LogOut className="size-3.5" />
            </button>
          </div>
        </div>
      </aside>

      <section className="min-w-0">
        <header className="sticky top-0 z-40 flex h-[62px] items-center gap-3 border-b border-hairline bg-surface-muted/72 px-4 backdrop-blur-2xl sm:px-6">
          <Button
            onClick={() => setMobileOpen((value) => !value)}
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={mobileOpen}
            aria-controls="portal-mobile-nav"
          >
            <Menu />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {activeItem?.label ?? 'Overview'}
            </p>
            <p className="hidden text-[11px] text-ink-muted sm:block">
              {mode === 'admin' ? 'Vaani platform control plane' : workspace}
            </p>
          </div>
          <div className="hidden w-56 items-center gap-2 rounded-lg border border-hairline bg-surface-muted px-3 py-2 text-[11px] text-ink-muted xl:flex">
            <Search className="size-3.5" /> Search anything
            <span className="ml-auto rounded border border-hairline px-1.5 py-0.5">
              ⌘K
            </span>
          </div>
          {typeof credits === 'number' ? (
            <button
              type="button"
              onClick={() => onNavigate('billing')}
              className="flex items-center gap-2 rounded-lg border border-hairline bg-surface-strong px-3 py-2 text-[11px] text-ink-body"
            >
              <Coins className="size-3.5 text-primary" />{' '}
              {credits.toLocaleString('en-IN')}
            </button>
          ) : null}
          <Link
            href="/docs"
            className="hidden items-center gap-2 rounded-lg px-2 py-2 text-[11px] text-ink-muted hover:bg-surface-strong hover:text-ink sm:flex"
          >
            <BookOpenText className="size-3.5" /> Docs
          </Link>
          <NotificationBell />
          {/* Interface language is per person, not per workspace: two people in
              one workspace can want different languages, and the workspace
              setting already means which languages the AI may speak. */}
          <label className="hidden items-center gap-1.5 sm:flex">
            <span className="sr-only">{t('shell.language')}</span>
            <select
              aria-label={t('shell.language')}
              value={locale}
              onChange={(event) =>
                setLocale(event.target.value as typeof locale)
              }
              className="rounded-lg border border-hairline bg-surface-strong px-2 py-1.5 text-[11px] text-ink-body outline-none focus:border-hairline"
            >
              {PORTAL_LOCALES.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.nativeLabel}
                </option>
              ))}
            </select>
          </label>
          <Badge
            variant="outline"
            className="hidden border-emerald-400/15 bg-emerald-400/6 text-[11px] text-success-text sm:inline-flex"
          >
            Core healthy
          </Badge>
        </header>

        {children}
      </section>

      {/* Sits outside the scrolling section: a sheet fixed to the viewport must
          not inherit a transform or an overflow from the page under it. */}
      <dialog
        id="portal-mobile-nav"
        ref={drawerRef}
        aria-label={`${mode} navigation`}
        onClose={() => setMobileOpen(false)}
        className="m-0 h-full max-h-none w-[86%] max-w-[300px] flex-col border-r border-hairline bg-surface-muted p-0 text-ink shadow-2xl backdrop:bg-black/45 open:flex lg:hidden!"
      >
        <div className="flex h-[62px] shrink-0 items-center gap-3 border-b border-hairline px-4">
          <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-hairline bg-white text-black">
            <Activity className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">
              {workspace || 'Vaani Platform'}
            </p>
            <p className="truncate text-[11px] uppercase tracking-[0.18em] text-ink-muted">
              {mode === 'admin' ? 'Platform admin' : 'Revenue Voice OS'}
            </p>
          </div>
          <Button
            onClick={() => setMobileOpen(false)}
            variant="ghost"
            size="icon-sm"
            aria-label="Close navigation"
          >
            <X />
          </Button>
        </div>

        <NavList
          groups={groups}
          active={active}
          onNavigate={(id) => {
            onNavigate(id);
            setMobileOpen(false);
          }}
          label={`${mode} sections`}
          t={t}
        />

        <div className="flex shrink-0 items-center gap-2 border-t border-hairline p-3">
          <Avatar className="size-8">
            <AvatarFallback className="bg-surface-strong text-[11px]">
              {name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-medium">{name}</p>
            <p className="truncate text-[11px] text-ink-muted">{email}</p>
          </div>
          <button
            type="button"
            onClick={logout}
            className="rounded-md p-2 text-ink-muted hover:bg-surface-strong hover:text-ink"
            aria-label="Log out"
          >
            <LogOut className="size-3.5" />
          </button>
        </div>
      </dialog>
    </main>
  );
}

/**
 * The section list, shared by the sidebar and the mobile drawer.
 *
 * It lives in one place because the two used to be different things: the
 * sidebar showed grouped sections with icons, and the phone showed the same
 * thirty-five destinations flattened into one horizontal strip. Anything added
 * to one had to be remembered for the other.
 */
function NavList({
  groups,
  active,
  onNavigate,
  label,
  t,
}: {
  groups: PortalNavGroup[];
  active: string;
  onNavigate: (id: string) => void;
  label: string;
  t: (key: TranslationKey) => string;
}) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label={label}>
      {groups.map((group, groupIndex) => (
        <div key={group.label} className={groupIndex ? 'mt-6' : ''}>
          <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
            {group.translationKey ? t(group.translationKey) : group.label}
          </p>
          <div className="space-y-1">
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                aria-current={active === item.id ? 'page' : undefined}
                className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-xs transition-colors ${
                  active === item.id
                    ? 'border border-hairline bg-surface-strong text-ink shadow-[inset_0_1px_0_rgba(255,255,255,.08)]'
                    : 'text-ink-muted hover:bg-surface-strong hover:text-ink'
                }`}
              >
                <item.icon
                  className={`size-3.5 shrink-0 ${active === item.id ? 'text-primary' : ''}`}
                />
                <span className="flex-1">
                  {item.translationKey ? t(item.translationKey) : item.label}
                </span>
                {item.badge ? (
                  <span className="rounded-md border border-hairline bg-surface-strong px-1.5 py-0.5 font-mono text-[11px] text-ink-body">
                    {item.badge}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
