'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CallVaniLogo } from '@/components/call-vani-logo';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useLocale } from '@/components/locale-provider';
import { PORTAL_LOCALES, type TranslationKey } from '@/lib/i18n';

const navigation = [
  ['#vani-platform', 'landing.nav.demos'],
  ['#product', 'landing.nav.product'],
  ['#solutions', 'landing.nav.solutions'],
  ['#pricing', 'landing.nav.pricing'],
  ['/docs', 'landing.nav.apiDocs'],
] as const;

export function LandingHeader({
  onEnterWorkspace,
}: {
  onEnterWorkspace: () => void;
}) {
  const { locale, setLocale, t } = useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const languageSelector = (
    <label className="vani-language">
      <span className="sr-only">{t('shell.language')}</span>
      <select
        aria-label={t('shell.language')}
        value={locale}
        onChange={(event) => setLocale(event.target.value as typeof locale)}
      >
        {PORTAL_LOCALES.map((option) => (
          <option key={option.code} value={option.code}>
            {option.nativeLabel}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <header className="vani-site-header">
      <a className="vani-skip-link" href="#vani-platform">
        {locale === 'hi' ? 'परिचय छोड़ें' : 'Skip introduction'}
      </a>
      <div className="vani-header-pill">
        <a
          href="#video-intro"
          className="vani-wordmark"
          aria-label={t('landing.home.aria')}
        >
          <CallVaniLogo className="size-10" />
          <span>Call Vani</span>
        </a>
        <nav className="vani-desktop-nav" aria-label={t('landing.nav.aria')}>
          {navigation.map(([href, key]) => (
            <Link key={href} href={href}>
              {t(key)}
            </Link>
          ))}
        </nav>
        <div className="vani-header-actions">
          <div className="vani-desktop-language">{languageSelector}</div>
          <Button onClick={onEnterWorkspace} className="vani-platform-button">
            {t('landing.openPlatform')} <ArrowRight className="size-4" />
          </Button>
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  className="vani-menu-toggle"
                  aria-label={t('landing.nav.aria')}
                />
              }
            >
              <Menu className="size-5" />
            </SheetTrigger>
            <SheetContent className="!w-[min(90vw,380px)] !bg-white !text-[#17221e]">
              <SheetHeader>
                <SheetTitle className="!text-[#17221e]">Call Vani</SheetTitle>
              </SheetHeader>
              <nav
                className="flex flex-col gap-1 px-5"
                aria-label={t('landing.nav.aria')}
              >
                {[
                  ...navigation,
                  ['#workflow', 'landing.nav.workflow'],
                  ['#engines', 'landing.nav.engines'],
                  ['#security', 'landing.nav.security'],
                ].map(([href, key]) => (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMenuOpen(false)}
                    className="rounded-xl px-3 py-3 text-base hover:bg-slate-100"
                  >
                    {t(key as TranslationKey)}
                  </Link>
                ))}
              </nav>
              <div className="mt-auto space-y-4 px-8 pb-8">
                <Button
                  className="vani-platform-button w-full"
                  onClick={() => {
                    setMenuOpen(false);
                    onEnterWorkspace();
                  }}
                >
                  {t('landing.openPlatform')} <ArrowRight className="size-4" />
                </Button>
                {languageSelector}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
