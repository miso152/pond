import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { type BookmarksApiResult, buildBookmarksApiExpression } from "./api";
import type { BookmarksHarvestArgs } from "./list";

async function scan(
  args: BookmarksHarvestArgs,
  pages: { ids: string[]; next?: string }[],
  expireAfterPage = false,
) {
  const requested: (string | null)[] = [];
  let time = 0;
  const template = new URL("https://x.com/i/api/graphql/bookmarks");
  template.searchParams.set(
    "variables",
    JSON.stringify({ count: 20, cursor: "captured-page" }),
  );
  const result: BookmarksApiResult = await runInNewContext(
    buildBookmarksApiExpression(args),
    {
      location: { pathname: "/i/bookmarks", origin: "https://x.com" },
      __pondBookmarksRequest: {
        url: template.href,
        method: "GET",
        headers: {},
      },
      URL,
      Date: { now: () => time, parse: Date.parse },
      setTimeout: (fn: () => void) => {
        time += expireAfterPage ? 300_001 : 1;
        fn();
      },
      fetch: async (url: string) => {
        const variables: { cursor?: string } = JSON.parse(
          new URL(url).searchParams.get("variables") ?? "{}",
        );
        requested.push(variables.cursor ?? null);
        const page = pages.shift();
        if (!page) throw new Error("Unexpected extra request");
        const entries = [
          ...page.ids.map((id) => ({ entryId: `tweet-${id}` })),
          ...(page.next
            ? [{ entryId: "cursor-bottom", content: { value: page.next } }]
            : []),
        ];
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              data: {
                bookmark_timeline_v2: {
                  timeline: {
                    instructions: [{ type: "TimelineAddEntries", entries }],
                  },
                },
              },
            }),
        };
      },
    },
  );
  return { result, requested };
}

it("starts a baseline at the top even if the intercepted request was a later page", async () => {
  const { result, requested } = await scan(
    { knownIds: [] },
    [{ ids: ["old"], next: "page-2" }],
    true,
  );
  expect(requested).toEqual([null]);
  expect(result).toMatchObject({
    ok: true,
    seenIds: ["old"],
    reachedEnd: false,
    resumeCursor: "page-2",
  });
});

it("resumes from the persisted cursor and accepts an empty final page without restarting", async () => {
  const { result, requested } = await scan(
    { knownIds: [], resumeCursor: "page-2" },
    [{ ids: [] }],
  );
  expect(requested).toEqual(["page-2"]);
  expect(result).toMatchObject({ ok: true, seenIds: [], reachedEnd: true });
});

it("records IDs across pages without relying on decoded tweet metadata", async () => {
  const { result, requested } = await scan({ knownIds: [] }, [
    { ids: ["one"], next: "two" },
    { ids: ["two"] },
  ]);
  expect(requested).toEqual([null, "two"]);
  expect(result).toMatchObject({
    ok: true,
    seenIds: ["one", "two"],
    reachedEnd: true,
  });
});
