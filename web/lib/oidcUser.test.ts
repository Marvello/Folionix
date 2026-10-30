import { describe, it, expect } from "vitest";
import { findOidcUser } from "./oidcUser";

const rows = new Map([["owner@example.com", { id: 7, email: "Owner@example.com", name: "Owner" }]]);
const find = async (email: string) => rows.get(email);

describe("findOidcUser", () => {
  it("maps a verified, known email to the users row (case-insensitive)", async () => {
    expect(await findOidcUser({ email: " OWNER@example.com ", email_verified: true }, find)).toEqual({
      id: "7",
      email: "Owner@example.com",
      name: "Owner",
    });
  });

  it("refuses unknown emails — SSO never creates accounts", async () => {
    expect(await findOidcUser({ email: "stranger@example.com", email_verified: true }, find)).toBeNull();
  });

  it("refuses unverified or missing emails", async () => {
    expect(await findOidcUser({ email: "owner@example.com", email_verified: false }, find)).toBeNull();
    expect(await findOidcUser({ email: "owner@example.com", email_verified: "true" }, find)).toBeNull();
    expect(await findOidcUser({ email_verified: true }, find)).toBeNull();
    expect(await findOidcUser(undefined, find)).toBeNull();
  });
});
