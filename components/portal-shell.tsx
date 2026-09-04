'use client';

import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import {
  Activity,
  Bell,
  BookOpenText,
  ChevronDown,
  Coins,
  LogOut,
  Menu,
  Search,
} from 'lucide-react';

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
  const [notificationsOpen, setNotificationsOpen] = useState(false);

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
            <span className="block text-[9px] font-semibold uppercase tracking-[0.2em] text-ink-muted">
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
              <p className="truncate text-[10px] text-ink-muted">
                {mode === 'admin' ? 'Global control plane' : 'Growth workspace'}
              </p>
            </div>
            <ChevronDown className="size-3.5 text-ink-muted" />
          </div>
        </div>

        <nav
          className="flex-1 overflow-y-auto px-3 py-4"
          aria-label={`${mode} navigation`}
        >
          {groups.map((group, groupIndex) => (
            <div key={group.label} className={groupIndex ? 'mt-6' : ''}>
              <p className="mb-2 px-3 text-[9px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
                {group.translationKey ? t(group.translationKey) : group.label}
              </p>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onNavigate(item.id)}
                    className={`flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-xs transition-colors ${
                      active === item.id
                        ? 'border border-hairline bg-surface-strong text-ink shadow-[inset_0_1px_0_rgba(255,255,255,.08)]'
                        : 'text-ink-muted hover:bg-surface-strong hover:text-ink'
                    }`}
                  >
                    <item.icon
                      className={`size-3.5 ${active === item.id ? 'text-primary' : ''}`}
                    />
                    <span className="flex-1">
                      {item.translationKey
                        ? t(item.translationKey)
                        : item.label}
                    </span>
                    {item.badge ? (
                      <span className="rounded-md border border-hairline bg-surface-strong px-1.5 py-0.5 font-mono text-[9px] text-ink-body">
                        {item.badge}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-hairline p-3">
          <div className="mb-2 flex items-center gap-2 rounded-lg px-2 py-2">
            <Avatar className="size-8">
              <AvatarFallback className="bg-surface-strong text-[10px]">
                {name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-medium">{name}</p>
              <p className="truncate text-[9px] text-ink-muted">{email}</p>
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
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
          >
            <Menu />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {activeItem?.label ?? 'Overview'}
            </p>
            <p className="hidden text-[10px] text-ink-muted sm:block">
              {mode === 'admin' ? 'Vaani platform control plane' : workspace}
            </p>
          </div>
          <div className="hidden w-56 items-center gap-2 rounded-lg border border-hairline bg-surface-muted px-3 py-2 text-[10px] text-ink-muted xl:flex">
            <Search className="size-3.5" /> Search anything
            <span className="ml-auto rounded border border-hairline px-1.5 py-0.5">
              ⌘K
            </span>
          </div>
          {typeof credits === 'number' ? (
            <button
              type="button"
              onClick={() => onNavigate('billing')}
              className="flex items-center gap-2 rounded-lg border border-hairline bg-surface-strong px-3 py-2 text-[10px] text-ink-body"
            >
              <Coins className="size-3.5 text-primary" />{' '}
              {credits.toLocaleString('en-IN')}
            </button>
          ) : null}
          <Link
            href="/docs"
            className="hidden items-center gap-2 rounded-lg px-2 py-2 text-[10px] text-ink-muted hover:bg-surface-strong hover:text-ink sm:flex"
          >
            <BookOpenText className="size-3.5" /> Docs
          </Link>
          <div className="relative">
            <Button
              onClick={() => setNotificationsOpen((value) => !value)}
              variant="ghost"
              size="icon-sm"
              className="relative"
              aria-label="Notifications"
              aria-expanded={notificationsOpen}
            >
              <Bell />
              <span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" />
            </Button>
            {notificationsOpen ? (
              <div className="absolute right-0 top-11 z-50 w-72 rounded-xl border border-hairline bg-surface/98 p-4 shadow-2xl backdrop-blur-xl">
                <p className="text-xs font-semibold">Notifications</p>
                <div className="mt-3 space-y-2">
                  <div className="rounded-lg border border-hairline bg-surface-muted p-3">
                    <p className="text-[10px] text-ink-body">
                      Workspace systems are healthy.
                    </p>
                    <p className="mt-1 text-[8px] text-ink-muted">
                      Provider readiness is shown on Overview.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onNavigate(mode === 'admin' ? 'system_audit' : 'alerts');
                      setNotificationsOpen(false);
                    }}
                    className="w-full rounded-lg border border-hairline px-3 py-2 text-[9px] text-ink-body hover:bg-surface-strong"
                  >
                    Open notification center
                  </button>
                </div>
              </div>
            ) : null}
          </div>
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
              className="rounded-lg border border-hairline bg-surface-strong px-2 py-1.5 text-[10px] text-ink-body outline-none focus:border-hairline"
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
            className="hidden border-emerald-400/15 bg-emerald-400/6 text-[9px] text-success-text sm:inline-flex"
          >
            Core healthy
          </Badge>
        </header>

        <div
          className={`${mobileOpen ? 'block' : 'hidden'} border-b border-hairline bg-surface-muted/90 px-3 py-2 backdrop-blur-xl lg:hidden`}
        >
          <div className="flex gap-1 overflow-x-auto">
            {groups
              .flatMap((group) => group.items)
              .map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onNavigate(item.id);
                    setMobileOpen(false);
                  }}
                  className={`whitespace-nowrap rounded-lg px-3 py-2 text-[10px] ${active === item.id ? 'bg-white text-black' : 'text-ink-muted'}`}
                >
                  {item.translationKey ? t(item.translationKey) : item.label}
                </button>
              ))}
          </div>
        </div>
        {children}
      </section>
    </main>
  );
}
