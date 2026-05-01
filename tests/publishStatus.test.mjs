import { describe, expect, it } from "vitest";
import { classifyPublishStatus } from "../server/publishStatus.mjs";

describe("publish status", () => {
  it("blocks publishing when pretext resolves to the home-level repository", () => {
    const status = classifyPublishStatus({
      projectRoot: "/Users/sarveshchidambaram/Desktop/Projects/Other/pretext",
      gitRoot: "/Users/sarveshchidambaram",
      remote: "https://github.com/sarveshsea/Labor-Budgeting.git"
    });

    expect(status.state).toBe("blocked");
    expect(status.reason).toContain("home-level");
    expect(status.remote).toContain("Labor-Budgeting");
  });

  it("allows publishing status when the project owns its repository", () => {
    const status = classifyPublishStatus({
      projectRoot: "/Users/sarveshchidambaram/Desktop/Projects/Other/pretext",
      gitRoot: "/Users/sarveshchidambaram/Desktop/Projects/Other/pretext",
      remote: "https://github.com/sarveshsea/hermes-pretext-mission-control.git"
    });

    expect(status.state).toBe("ready");
  });
});
