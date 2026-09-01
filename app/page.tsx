'use client';

import { LandingPage } from '@/components/landing-page';

export default function Home() {
  return (
    <LandingPage onEnterWorkspace={() => window.location.assign('/login')} />
  );
}
