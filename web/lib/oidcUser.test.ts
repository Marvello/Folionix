import { describe, it, expect, beforeEach } from "vitest";
import { findOidcUser, type OidcUserStore } from "./oidcUser";

type Row = { id: number; email: string; name: string; oidc_subject: string | null };
let rows: Row[];
const store: OidcUserStore = {
  findBySubject: async (s) => rows.find((r) => r.oidc_subject === s),
  findByEmail: async (e) => rows.find((r) => r.email.toLowerCase() === e),
  bindSubject: async (id, s) => {
    const r = rows.find((x) => x.id === id && x.oidc_subject === null);
    if (r) r.oidc_subject = s;
    return Boolean(r);
  },
};
const ISS = "https://auth.example.com/application/o/folionix/";
const owner = { id: "7", email: "Owner@example.com", name: "Owner" };

beforeEach(() => {
  rows = [{ id: 7, email: "Owner@example.com", name: "Owner", oidc_subject: null }];
});

describe("findOidcUser", () => {
  it("binds a verified, known email on first login, then matches by subject", async () => {
    expect(await findOidcUser({ iss: ISS, sub: "u1", email: " OWNER@example.com ", email_verified: true }, store)).toEqual(owner);
    expect(rows[0].oidc_subject).toBe(`${ISS}#u1`);
    // Later logins match on (iss, sub) — the email no longer matters.
    expect(await findOidcUser({ iss: ISS, sub: "u1", email: "changed@example.com", email_verified: false }, store)).toEqual(owner);
  });

  it("refuses a different subject presenting the bound email", async () => {
    rows[0].oidc_subject = `${ISS}#u1`;
    expect(await findOidcUser({ iss: ISS, sub: "attacker", email: "owner@example.com", email_verified: true }, store)).toBeNull();
  });

  it("refuses unknown emails — SSO never creates accounts", async () => {
    expect(await findOidcUser({ iss: ISS, sub: "u2", email: "stranger@example.com", email_verified: true }, store)).toBeNull();
  });

  it("refuses unverified emails, missing claims, or a lost bind race", async () => {
    expect(await findOidcUser({ iss: ISS, sub: "u1", email: "owner@example.com", email_verified: false }, store)).toBeNull();
    expect(await findOidcUser({ iss: ISS, sub: "u1", email: "owner@example.com", email_verified: "true" }, store)).toBeNull();
    expect(await findOidcUser({ sub: "u1", email: "owner@example.com", email_verified: true }, store)).toBeNull();
    expect(await findOidcUser(undefined, store)).toBeNull();
    const racing = { ...store, bindSubject: async () => false };
    expect(await findOidcUser({ iss: ISS, sub: "u1", email: "owner@example.com", email_verified: true }, racing)).toBeNull();
  });
});
