// Runtime environment access — read at request time, never inlined at build.
const read = (key: string): string => process.env[key] ?? "";

export const PUBLIC_ENV_KEYS = [
  "NEXT_PUBLIC_APP_VERSION",
  "NEXT_PUBLIC_GIT_SHA",
  "NEXT_PUBLIC_BUILD_DATE",
] as const;

export type PublicEnv = Record<(typeof PUBLIC_ENV_KEYS)[number], string>;

export const serverEnv = (key: string): string => read(key);

export const publicEnv = (): PublicEnv =>
  Object.fromEntries(PUBLIC_ENV_KEYS.map((k) => [k, read(k)])) as PublicEnv;
