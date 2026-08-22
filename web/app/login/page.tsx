"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("error")) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time URL read on mount
      setHasError(true);
    }
  }, []);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setHasError(false);
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    if (result?.error) {
      setLoading(false);
      setHasError(true);
      return;
    }
    window.location.assign("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-page">
      <form
        onSubmit={handleSignIn}
        className="w-full max-w-sm rounded-xl border border-edge bg-component p-8"
      >
        <Image
          src="/logo/wordmark-transparent.svg"
          alt="Folionix"
          width={160}
          height={55}
          priority
          className="mb-6 h-auto w-40"
        />
        {hasError && (
          <p className="mb-4 text-sm text-critical">
            Sign-in failed. Check your email and password.
          </p>
        )}
        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-tmuted">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="w-full rounded-md border border-edge bg-page px-3 py-2 text-sm outline-none focus:border-btn"
          />
        </label>
        <label className="mb-5 block">
          <span className="mb-1 block text-sm text-tmuted">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="w-full rounded-md border border-edge bg-page px-3 py-2 text-sm outline-none focus:border-btn"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-btn px-3 py-2 font-semibold text-page disabled:opacity-60"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
