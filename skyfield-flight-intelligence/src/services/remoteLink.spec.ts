import { describe, it, expect } from "vitest";
import { parseRemoteMessage, pollGap, queueAddSas, screenSas } from "./remoteLink.js";

describe("parseRemoteMessage", () => {
  it("splits an action from its arguments", () => {
    expect(parseRemoteMessage("nextCountry")).toEqual(["nextCountry", []]);
    expect(parseRemoteMessage("feedStart:india:15")).toEqual(["feedStart", ["india", "15"]]);
    expect(parseRemoteMessage(" band:low ")).toEqual(["band", ["low"]]);
  });
  it("rejects anything that is not a known action", () => {
    expect(parseRemoteMessage("bogus:thing")).toBeNull();
    expect(parseRemoteMessage("")).toBeNull();
    expect(parseRemoteMessage("<script>")).toBeNull();
  });
});

// Expected signatures were computed separately (Python hmac) from the string-to-sign formats in the Azure
// Storage docs, so a slip in field order or newlines fails here instead of as a 403 in front of an audience.
describe("storage passes", () => {
  const key = "c2t5ZmllbGQtdGVzdC1rZXk=";
  const start = new Date("2026-01-01T00:00:00Z");
  const expiry = new Date("2026-01-01T06:00:00Z");
  it("signs the phone's add-only pass for one queue", async () => {
    expect(await queueAddSas("acct", key, "skyfield-abc", start, expiry)).toBe(
      "sv=2020-12-06&sp=a&st=2026-01-01T00:00:00Z&se=2026-01-01T06:00:00Z&spr=https&sig=hygmluj73ij0VdUt4JccmF7IdwVF2d%2FbmuVpFh1pxRg%3D",
    );
  });
  it("signs the screen's queue pass", async () => {
    expect(await screenSas("acct", key, start, expiry)).toBe(
      "sv=2020-12-06&ss=q&srt=co&sp=dcp&st=2026-01-01T00:00:00Z&se=2026-01-01T06:00:00Z&spr=https&sig=FBlrAHVNySpTVVxxo2Hu%2BAxgpzPBqNVqeEY7kXWYDBQ%3D",
    );
  });
});

describe("pollGap", () => {
  it("polls fast right after a tap and relaxes as the phone goes quiet", () => {
    expect(pollGap(0)).toBe(120);
    expect(pollGap(14_999)).toBe(120);
    expect(pollGap(15_000)).toBe(350);
    expect(pollGap(5 * 60_000)).toBe(1500);
  });
});
