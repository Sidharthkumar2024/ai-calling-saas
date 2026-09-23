"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  KeyRound,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { CallVaniLogo } from "@/components/call-vani-logo";
import { Input } from "@/components/ui/input";
import { SocialAuthButtons } from "@/components/social-auth-buttons";
import { useT } from "@/components/locale-provider";
import type { TranslationKey } from "@/lib/i18n";

type PortalLoginProps = {
  portal: "admin" | "customer";
};

const portalCopy = {
  admin: {
    eyebrow: "Platform control",
    title: "Call Vani admin console",
    description:
      "Manage customers, provider connections, calling operations, plans, credits, integrations and platform health.",
    icon: ShieldCheck,
    accent: "from-emerald-100 via-white to-white",
  },
  customer: {
    eyebrow: "Customer workspace",
    title: "Run your revenue voice OS",
    description:
      "Capture leads, qualify intent, automate calling, manage CRM and measure every revenue outcome.",
    icon: Building2,
    accent: "from-emerald-100 via-white to-white",
  },
};

async function readJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json"))
    throw new Error(
      response.ok
        ? "The service returned an invalid response. Please try again."
        : "The service is temporarily unavailable. Please try again.",
    );
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(
      "The service returned an invalid response. Please try again.",
    );
  }
}

export function PortalLogin({ portal }: PortalLoginProps) {
  const t = useT();
  const config = portalCopy[portal];
  const copy = {
    eyebrow: t(`login.${portal}.eyebrow` as TranslationKey),
    title: t(`login.${portal}.title` as TranslationKey),
    description: t(`login.${portal}.description` as TranslationKey),
  };
  const Icon = config.icon;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [otp, setOtp] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetNotice, setResetNotice] = useState("");
  useLayoutEffect(() => {
      const queryParams = new URLSearchParams(window.location.search);
      const fragmentParams = new URLSearchParams(
        window.location.hash.replace(/^#/, ""),
      );
      const token =
        fragmentParams.get("reset_token") ?? queryParams.get("reset_token");
      if (token) {
        setResetToken(token);
        setResetMode(true);
      }
      if (queryParams.has("error")) {
        const googleError = queryParams.get("error") || "";
        const messages: Record<string, string> = {
          google_verification_required:
            "This account needs a one-time Google link from the platform team before its first Google sign-in.",
          google_account_required:
            "No active Call Vani account matches that Google email. Create or activate the customer account first.",
          wrong_portal:
            portal === "admin"
              ? "That Google account belongs to the customer portal. Use the customer login instead."
              : "That Google account belongs to the admin portal. Use the admin login instead.",
          google_exchange:
            "Google could not complete the secure sign-in exchange. Please start again.",
          google_config:
            "Google sign-in is not fully configured. Contact the platform administrator.",
          google_state:
            "This Google sign-in request expired or was opened in another browser. Please start again here.",
          google_disabled:
            "Google sign-in is currently disabled by the platform administrator.",
          google_mfa_use_password:
            "This account uses an authenticator. Sign in with email, password and your authenticator code.",
        };
        setError(
          messages[googleError] ??
            "Google sign-in could not be completed. Please start again or use email and password.",
        );
      }
      if (token) window.history.replaceState(null, "", window.location.pathname);
  }, [portal]);

  async function submit(event: { preventDefault: () => void }) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          portal,
          ...(mfaRequired ? { otp } : {}),
        }),
      });
      const payload = await readJsonResponse<{
        error?: string;
        redirectTo?: string;
        code?: string;
      }>(response);
      if (!response.ok || !payload.redirectTo) {
        if (payload.code === "MFA_REQUIRED") setMfaRequired(true);
        throw new Error(payload.error || "Unable to sign in.");
      }
      window.location.assign(payload.redirectTo);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sign in.");
      setLoading(false);
    }
  }

  async function requestReset() {
    setLoading(true);
    setError("");
    setResetNotice("");
    try {
      const response = await fetch(
        `/api/auth/password-reset?portal=${portal}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "request", email }),
        },
      );
      const payload = await readJsonResponse<{
        error?: string;
        message?: string;
        developmentToken?: string;
      }>(response);
      if (!response.ok) {
        const retryAfter = Number(response.headers.get("retry-after") || 0);
        throw new Error(
          response.status === 429
            ? `Too many reset requests. Check your inbox or try again in ${Math.max(1, Math.ceil(retryAfter / 60))} minutes.`
            : (payload.error ?? "Unable to start password reset."),
        );
      }
      setResetToken(payload.developmentToken ?? "");
      setResetNotice(
        payload.developmentToken
          ? "Local reset link is ready. Choose a new password below."
          : (payload.message ?? "Check your email for the secure reset link."),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to start password reset.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function confirmReset() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "confirm",
          token: resetToken,
          password: newPassword,
        }),
      });
      const payload = await readJsonResponse<{
        error?: string;
        reset?: boolean;
      }>(response);
      if (!response.ok || !payload.reset)
        throw new Error(payload.error ?? "Unable to reset password.");
      setResetMode(false);
      setPassword(newPassword);
      setNewPassword("");
      setResetToken("");
      setResetNotice("Password updated. Sign in with the new password.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to reset password.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="vani-auth relative min-h-screen overflow-hidden bg-surface-muted text-ink">
      <div className="vani-auth-backdrop pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex min-h-screen max-w-[1040px] items-center px-4 py-6 sm:px-6 sm:py-8">
        <div className="vani-auth-card grid w-full overflow-hidden rounded-[26px] border border-hairline bg-surface/94 md:grid-cols-[0.88fr_1.12fr]">
          <section
            className={`relative hidden min-h-[600px] overflow-hidden border-r border-hairline bg-gradient-to-br ${config.accent} p-8 md:flex md:flex-col`}
          >
            <Link
              href="/"
              className="flex items-center gap-3 text-ink"
              aria-label={t("aria.vaaniHome")}
            >
              <CallVaniLogo className="size-10" />
              <span>
                <span className="block text-base font-semibold">Call Vani</span>
                <span className="block text-[11px] uppercase tracking-[0.2em] text-ink-muted">
                  {t("login.tagline")}
                </span>
              </span>
            </Link>
            <div className="my-auto max-w-md">
              <span className="inline-flex items-center gap-2 rounded-full border border-hairline bg-surface-strong px-3 py-1.5 text-[11px] text-ink-body">
                <Sparkles className="size-3 text-warning-text" /> {copy.eyebrow}
              </span>
              <h1 className="mt-5 text-4xl font-semibold leading-[1.04] tracking-[-0.045em]">
                {copy.title}
              </h1>
              <p className="mt-5 text-base leading-7 text-ink-body">
                {copy.description}
              </p>
              <div className="mt-8 space-y-3 text-sm text-ink-body">
                {[
                  "One workspace for calls, leads and follow-ups",
                  "Your team, with the right access for each role",
                  "Try your agent before going live",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3">
                    <CheckCircle2 className="size-4 text-success-text" /> {item}
                  </div>
                ))}
              </div>
            </div>
            <p className="text-xs text-ink-muted">
              A little less busywork. A lot more conversation.
            </p>
          </section>

          <section className="flex min-h-[600px] items-center justify-center p-5 sm:p-8 lg:p-10">
            <div className="w-full max-w-sm">
              <Link
                href="/"
                className="mb-7 inline-flex items-center gap-2 text-xs text-ink-muted transition-colors hover:text-ink md:hidden"
              >
                <ArrowLeft className="size-3.5" /> {t("login.backToVaani")}
              </Link>
              <span className="grid size-12 place-items-center rounded-2xl border border-hairline bg-surface-strong">
                <Icon className="size-5 text-warning-text" />
              </span>
              <p className="mt-7 text-xs font-semibold uppercase tracking-[0.2em] text-warning-text">
                {copy.eyebrow}
              </p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">
                {t("login.signIn")}
              </h2>
              <p className="mt-2 text-sm leading-6 text-ink-muted">
                {t(`login.${portal}.useAccount` as TranslationKey)}
              </p>

              <SocialAuthButtons portal={portal} />

              {resetMode ? (
                <div
                  className={`${portal === "customer" ? "mt-2" : "mt-7"} space-y-4`}
                >
                  {resetToken ? (
                    <>
                      <p className="rounded-xl border border-emerald-400/15 bg-emerald-400/6 p-3 text-xs text-success-text">
                        Secure reset link verified. Enter your new password.
                      </p>
                      <label
                        htmlFor={`${portal}-new-password`}
                        className="block text-xs font-medium text-ink-body"
                      >
                        {t("login.newPassword")}
                        <Input
                          id={`${portal}-new-password`}
                          value={newPassword}
                          onChange={(event) =>
                            setNewPassword(event.target.value)
                          }
                          type="password"
                          autoComplete="new-password"
                          placeholder={t("login.passwordHint")}
                          className="mt-2 h-11 border-hairline bg-surface-strong"
                        />
                      </label>
                      <Button
                        type="button"
                        onClick={() => void confirmReset()}
                        disabled={
                          loading || !resetToken || newPassword.length < 10
                        }
                        className="h-11 w-full bg-primary text-primary-foreground hover:bg-primary/90"
                      >
                        <LockKeyhole /> Update password
                      </Button>
                    </>
                  ) : (
                    <>
                      <label
                        htmlFor={`${portal}-reset-email`}
                        className="block text-xs font-medium text-ink-body"
                      >
                        {t("login.accountEmail")}
                        <Input
                          id={`${portal}-reset-email`}
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                          type="email"
                          autoComplete="email"
                          className="mt-2 h-11 border-hairline bg-surface-strong"
                        />
                      </label>
                      <Button
                        type="button"
                        onClick={() => void requestReset()}
                        disabled={loading || !email}
                        variant="outline"
                        className="h-11 w-full border-hairline bg-surface-muted"
                      >
                        {loading ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <KeyRound />
                        )}{" "}
                        {t("login.sendResetLink")}
                      </Button>
                    </>
                  )}
                  {resetNotice ? (
                    <p className="rounded-xl border border-emerald-400/15 bg-emerald-400/6 p-3 text-xs text-success-text">
                      {resetNotice}
                    </p>
                  ) : null}
                  {error ? (
                    <p className="rounded-xl border border-red-400/15 bg-red-400/5 p-3 text-xs text-danger-text">
                      {error}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setResetMode(false);
                      setError("");
                    }}
                    className="text-xs text-ink-muted hover:text-ink"
                  >
                    {t("login.backToSignIn")}
                  </button>
                </div>
              ) : (
                <form
                  className={`${portal === "customer" ? "mt-2" : "mt-7"} space-y-4`}
                  onSubmit={submit}
                >
                  <label
                    htmlFor={`${portal}-email`}
                    className="block text-xs font-medium text-ink-body"
                  >
                    {t("login.email")}
                    <Input
                      id={`${portal}-email`}
                      value={email}
                      disabled={loading}
                      onChange={(event) => {
                        setEmail(event.target.value);
                        setMfaRequired(false);
                        setOtp("");
                        setError("");
                      }}
                      type="email"
                      autoComplete="username"
                      className="mt-2 h-11 border-hairline bg-surface-strong text-ink placeholder:text-ink-muted"
                      required
                    />
                  </label>
                  {mfaRequired ? (
                    <label
                      htmlFor={`${portal}-otp`}
                      className="block text-xs font-medium text-ink-body"
                    >
                      {t("login.authenticatorCode")}
                      <Input
                        id={`${portal}-otp`}
                        value={otp}
                        onChange={(event) =>
                          setOtp(
                            event.target.value.replace(/\D/g, "").slice(0, 6),
                          )
                        }
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder={t("login.codePlaceholder")}
                        className="mt-2 h-11 border-hairline bg-surface-strong font-mono tracking-[0.3em] text-ink"
                        required
                      />
                    </label>
                  ) : null}
                  <label
                    htmlFor={`${portal}-password`}
                    className="block text-xs font-medium text-ink-body"
                  >
                    {t("login.password")}
                    <Input
                      id={`${portal}-password`}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      type="password"
                      autoComplete="current-password"
                      className="mt-2 h-11 border-hairline bg-surface-strong text-ink placeholder:text-ink-muted"
                      required
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setResetMode(true);
                      setError("");
                      setResetNotice("");
                    }}
                    className="text-xs text-ink-muted hover:text-ink"
                  >
                    {t("login.forgotPassword")}
                  </button>
                  {error ? (
                    <div className="rounded-xl border border-red-400/20 bg-red-400/8 px-3 py-2.5 text-xs text-danger-text">
                      {error}
                    </div>
                  ) : null}
                  <Button
                    type="submit"
                    disabled={loading}
                    className="h-11 w-full bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {loading ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <LockKeyhole />
                    )}
                    {loading ? "Signing in…" : "Sign in"}
                    {!loading && <ArrowRight className="ml-auto" />}
                  </Button>
                </form>
              )}
              {!resetMode && resetNotice ? (
                <p className="mt-4 rounded-xl border border-emerald-400/15 bg-emerald-400/6 p-3 text-xs text-success-text">
                  {resetNotice}
                </p>
              ) : null}
              <div className="mt-7 flex items-center justify-between text-xs text-ink-muted">
                <Link href="/docs" className="hover:text-ink">
                  API documentation
                </Link>
                <Link
                  href={portal === "admin" ? "/login" : "/signup"}
                  className="hover:text-ink"
                >
                  {portal === "admin"
                    ? "Customer login"
                    : "Create free account"}
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
