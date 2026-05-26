import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockAuth = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));

const { checkOwner } = await import("@/lib/insights/owner");

const ORIGINAL = process.env.POTLUCK_OWNER_HANDLE;

beforeEach(() => {
  mockAuth.mockReset();
});

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.POTLUCK_OWNER_HANDLE;
  } else {
    process.env.POTLUCK_OWNER_HANDLE = ORIGINAL;
  }
});

describe("checkOwner", () => {
  it('returns "no-config" when POTLUCK_OWNER_HANDLE is unset', async () => {
    delete process.env.POTLUCK_OWNER_HANDLE;
    mockAuth.mockResolvedValue({ user: { id: "u1", handle: "anyone" } });
    expect(await checkOwner()).toEqual({ kind: "no-config" });
  });

  it('returns "no-config" when the env var is whitespace-only', async () => {
    process.env.POTLUCK_OWNER_HANDLE = "   ";
    mockAuth.mockResolvedValue({ user: { id: "u1", handle: "anyone" } });
    expect(await checkOwner()).toEqual({ kind: "no-config" });
  });

  it('returns "no-session" when no user is signed in', async () => {
    process.env.POTLUCK_OWNER_HANDLE = "owner";
    mockAuth.mockResolvedValue(null);
    expect(await checkOwner()).toEqual({ kind: "no-session" });
  });

  it('returns "not-owner" when the signed-in user has a different handle', async () => {
    process.env.POTLUCK_OWNER_HANDLE = "owner";
    mockAuth.mockResolvedValue({ user: { id: "u1", handle: "guest" } });
    expect(await checkOwner()).toEqual({ kind: "not-owner" });
  });

  it('returns "not-owner" when the signed-in user has no handle at all', async () => {
    process.env.POTLUCK_OWNER_HANDLE = "owner";
    mockAuth.mockResolvedValue({ user: { id: "u1", handle: null } });
    expect(await checkOwner()).toEqual({ kind: "not-owner" });
  });

  it('returns "ok" when the handle matches (case-insensitive both sides)', async () => {
    process.env.POTLUCK_OWNER_HANDLE = "OwnerHandle";
    mockAuth.mockResolvedValue({ user: { id: "u1", handle: "ownerhandle" } });
    expect(await checkOwner()).toEqual({ kind: "ok" });
  });

  it("trims env-var whitespace so a typo'd .env line still works", async () => {
    process.env.POTLUCK_OWNER_HANDLE = "  owner  ";
    mockAuth.mockResolvedValue({ user: { id: "u1", handle: "owner" } });
    expect(await checkOwner()).toEqual({ kind: "ok" });
  });
});
