import {
  type ConnectedAccount,
  DEFAULT_SOURCE_SYNC_PREFS,
} from "@pond/schema/db";
import { describe, expect, it, vi } from "vitest";
import type { BookmarksHarvestResult } from "../refresh/harvest/twitter";
import {
  filterTwitterHistory,
  prepareTwitterHistory,
  type TwitterHistory,
} from "./twitter-history";

function account(history?: TwitterHistory): ConnectedAccount {
  return {
    id: "x-account",
    source: "twitter",
    handle: "pond",
    identityKey: null,
    label: null,
    addedAt: "2026-10-30T00:00:00Z",
    sync: {
      ...DEFAULT_SOURCE_SYNC_PREFS,
      importScope: { history: "new", listKinds: ["saved"] },
      twitterHistory: history,
    },
  };
}
function page(
  ids: string[],
  reachedEnd: boolean,
  resumeCursor?: string,
): BookmarksHarvestResult {
  return {
    ok: true,
    entries: [],
    seenIds: ids,
    captures: [],
    reachedEnd,
    resumeCursor,
  };
}

describe("X new bookmarks", () => {
  it("resumes a large baseline and excludes existing IDs even when metadata could not be decoded", async () => {
    let saved: TwitterHistory = {};
    const persist = vi.fn(async (value: TwitterHistory) => {
      saved = structuredClone(value);
    });
    const bookmarks = vi.fn(async () =>
      page(["old", "unavailable"], false, "next-page"),
    );
    const deps = {
      bookmarks,
      folder: vi.fn(async () => page([], true)),
      likes: vi.fn(async () => page([], true)),
      persist,
    };
    const first = await prepareTwitterHistory(
      account(),
      new AbortController().signal,
      deps,
    );
    expect(first.ready).toBe(false);
    expect(saved.saved?.complete).toBe(false);
    bookmarks.mockImplementation(async () => page(["older"], true));
    const second = await prepareTwitterHistory(
      account(saved),
      new AbortController().signal,
      deps,
    );
    expect(second.ready).toBe(true);
    expect(bookmarks).toHaveBeenLastCalledWith({
      knownIds: [],
      resumeCursor: "next-page",
    });
    const entries = [
      "old",
      "older",
      "unavailable",
      "old-tweet-bookmarked-today",
    ].map((tweetId) => ({ tweetId, url: `https://x.com/i/status/${tweetId}` }));
    expect(
      filterTwitterHistory(entries, second.history).map((e) => e.tweetId),
    ).toEqual(["old-tweet-bookmarked-today"]);
    bookmarks.mockClear();
    await prepareTwitterHistory(
      account(saved),
      new AbortController().signal,
      deps,
    );
    expect(bookmarks).not.toHaveBeenCalled();
  });

  it("keeps a new bookmark of a previously liked post", () => {
    const entries = [
      {
        tweetId: "1",
        url: "https://x.com/i/status/1",
        listKinds: ["saved", "liked"] as const,
      },
    ];
    expect(
      filterTwitterHistory(
        entries.map((e) => ({ ...e, listKinds: [...e.listKinds] })),
        {
          saved: { ids: [], complete: true },
          liked: { ids: ["1"], complete: true },
        },
      ),
    ).toEqual([{ ...entries[0], listKinds: ["saved"] }]);
  });

  it("does not declare readiness or persist a cancelled or failed scan", async () => {
    const controller = new AbortController();
    const deps = {
      bookmarks: vi.fn(
        async (): Promise<BookmarksHarvestResult> => ({
          ok: false,
          reason: "rate_limited",
        }),
      ),
      folder: vi.fn(async () => page([], true)),
      likes: vi.fn(async () => page([], true)),
      persist: vi.fn(async () => {}),
    };
    expect(
      (await prepareTwitterHistory(account(), controller.signal, deps)).ready,
    ).toBe(false);
    expect(deps.persist).not.toHaveBeenCalled();
    deps.bookmarks.mockImplementation(async () => {
      controller.abort();
      return page(["1"], true);
    });
    expect(
      (await prepareTwitterHistory(account(), controller.signal, deps)).ready,
    ).toBe(false);
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it("snapshots chosen folders and Likes independently", async () => {
    const current = account();
    current.sync.importScope = {
      history: "new",
      collections: [{ id: "design", name: "Design" }],
    };
    const deps = {
      bookmarks: vi.fn(async () => page([], true)),
      folder: vi.fn(async () => page(["folder-old"], true)),
      likes: vi.fn(async () => page(["liked-old"], true)),
      persist: vi.fn(async () => {}),
    };
    const baseline = await prepareTwitterHistory(
      current,
      new AbortController().signal,
      deps,
    );
    expect(baseline.ready).toBe(true);
    expect(deps.bookmarks).not.toHaveBeenCalled();
    expect(deps.folder).toHaveBeenCalledWith("design", {
      knownIds: [],
      resumeCursor: undefined,
    });
    expect(
      filterTwitterHistory(
        [
          {
            tweetId: "folder-old",
            url: "https://x.com/i/status/1",
            collectionIds: ["design"],
            listKinds: ["saved"],
          },
          {
            tweetId: "new",
            url: "https://x.com/i/status/2",
            collectionIds: ["design"],
            listKinds: ["saved"],
          },
        ],
        baseline.history,
      ).map((e) => e.tweetId),
    ).toEqual(["new"]);
  });
});
