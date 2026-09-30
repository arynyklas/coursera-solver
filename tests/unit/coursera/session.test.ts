import { describe, expect, it } from "vitest";
import { createSessionCredentials } from "@/coursera/session";

describe("session credentials", () => {
  it("replaces the token with a later token", () => {
    const session = createSessionCredentials();
    session.update({ csrf3Token: "first" });
    session.update({ csrf3Token: "second" });
    session.update({ csrf3Token: "" });
    expect(session.get().csrf3Token).toBe("second");
  });

  it("lets a dispatcher user id replace a URL-derived id", () => {
    const session = createSessionCredentials();
    session.update({ urlUserId: "111" });
    session.update({ userId: "222" });
    expect(session.get().userId).toBe("222");
  });

  it("ignores URL user ids once a dispatcher id is known", () => {
    const session = createSessionCredentials();
    session.update({ userId: "222" });
    session.update({ urlUserId: "333" });
    expect(session.get()).toEqual({ userId: "222" });
  });

  it("uses a URL user id when no id is known", () => {
    const session = createSessionCredentials();
    session.update({ csrf3Token: "token", urlUserId: "111" });
    expect(session.get()).toEqual({ csrf3Token: "token", userId: "111" });
  });
});
