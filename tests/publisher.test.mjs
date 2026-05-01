import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findSecretMatch, publishProjectChanges } from "../server/publisher.mjs";

beforeEach(() => {
  delete process.env.PRETEXT_PUBLISH_NO_SECRET_GUARD;
});

afterEach(() => {
  delete process.env.PRETEXT_PUBLISH_NO_SECRET_GUARD;
});

describe("publisher", () => {
  it("skips publish when the repository is blocked", async () => {
    const calls = [];
    const result = await publishProjectChanges({
      publishStatus: { state: "blocked", reason: "wrong remote" },
      execGit: async (...args) => {
        calls.push(args);
        return { ok: true, stdout: "" };
      },
      execNpm: async (...args) => {
        calls.push(args);
        return { ok: true, stdout: "" };
      }
    });

    expect(result.status).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  it("runs check, audits diff, commits, and pushes when changes exist", async () => {
    const calls = [];
    const result = await publishProjectChanges({
      publishStatus: {
        state: "ready",
        remote: "https://github.com/sarveshsea/hermes-pretext-mission-control.git"
      },
      execNpm: async (args) => {
        calls.push(["npm", ...args]);
        return { ok: true, stdout: "ok" };
      },
      execGit: async (args) => {
        calls.push(["git", ...args]);
        if (args[0] === "status") return { ok: true, stdout: " M CHANGELOG.md" };
        if (args[0] === "diff") return { ok: true, stdout: "+ harmless changelog edit" };
        if (args[0] === "rev-parse") return { ok: true, stdout: "abc1234\n" };
        return { ok: true, stdout: "" };
      }
    });

    expect(result.status).toBe("published");
    expect(result.commit).toBe("abc1234");
    expect(calls).toContainEqual(["git", "diff", "--cached"]);
    expect(calls).toContainEqual(["git", "commit", "-m", "Automated Pretext improvement"]);
  });

  it("refuses to commit when the staged diff matches a secret pattern", async () => {
    await expect(
      publishProjectChanges({
        publishStatus: {
          state: "ready",
          remote: "https://github.com/sarveshsea/hermes-pretext-mission-control.git"
        },
        execNpm: async () => ({ ok: true, stdout: "ok" }),
        execGit: async (args) => {
          if (args[0] === "status") return { ok: true, stdout: " M CHANGELOG.md" };
          if (args[0] === "add") return { ok: true, stdout: "" };
          if (args[0] === "diff") {
            return { ok: true, stdout: "+ AKIAABCDEFGHIJKLMNOP fake aws key" };
          }
          return { ok: true, stdout: "" };
        }
      })
    ).rejects.toThrow(/secret pattern/);
  });

  it("respects the PRETEXT_PUBLISH_NO_SECRET_GUARD opt-out", async () => {
    process.env.PRETEXT_PUBLISH_NO_SECRET_GUARD = "true";
    const result = await publishProjectChanges({
      publishStatus: {
        state: "ready",
        remote: "https://github.com/sarveshsea/hermes-pretext-mission-control.git"
      },
      execNpm: async () => ({ ok: true, stdout: "ok" }),
      execGit: async (args) => {
        if (args[0] === "status") return { ok: true, stdout: " M CHANGELOG.md" };
        if (args[0] === "rev-parse") return { ok: true, stdout: "deadbeef\n" };
        return { ok: true, stdout: "" };
      }
    });
    expect(result.status).toBe("published");
  });

  it("findSecretMatch detects common token shapes", () => {
    expect(findSecretMatch("nothing to see here")).toBeNull();
    expect(findSecretMatch("AKIAABCDEFGHIJKLMNOP")?.pattern).toBeTruthy();
    expect(findSecretMatch("ghp_aaaabbbbccccddddeeeeffffgggghhhhiiiijj")?.pattern).toBeTruthy();
    expect(findSecretMatch("-----BEGIN OPENSSH PRIVATE KEY-----")?.pattern).toBeTruthy();
  });
});
