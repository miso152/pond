import type { ConnectedAccount, SourceSyncPrefs } from "@pond/schema/db";
import type {
  BookmarksEntry,
  BookmarksHarvestArgs,
  BookmarksHarvestResult,
} from "../refresh/harvest/twitter";
import { listHarvestPlan } from "./import-scope";

export type TwitterHistory = NonNullable<SourceSyncPrefs["twitterHistory"]>;

interface HistoryDependencies {
  bookmarks: (args: BookmarksHarvestArgs) => Promise<BookmarksHarvestResult>;
  folder: (
    id: string,
    args: BookmarksHarvestArgs,
  ) => Promise<BookmarksHarvestResult>;
  likes: (args: BookmarksHarvestArgs) => Promise<BookmarksHarvestResult>;
  persist: (history: TwitterHistory) => Promise<void>;
}

export function twitterHistoryLists(account: ConnectedAccount): string[] {
  const plan = listHarvestPlan("twitter", account.sync.importScope);
  return [
    ...(plan.primary ? ["saved"] : []),
    ...(plan.collections?.map((c) => `folder:${c.id}`) ?? []),
    ...(plan.liked ? ["liked"] : []),
  ];
}

/** Never imports while the baseline is incomplete. Each bounded harvest survives restart. */
export async function prepareTwitterHistory(
  account: ConnectedAccount,
  signal: AbortSignal,
  deps: HistoryDependencies,
): Promise<{ ready: boolean; history: TwitterHistory; problem?: string }> {
  const history: TwitterHistory = { ...account.sync.twitterHistory };
  for (const key of twitterHistoryLists(account)) {
    if (signal.aborted) return { ready: false, history };
    const current = history[key];
    if (current?.complete) continue;
    const args: BookmarksHarvestArgs = {
      knownIds: [],
      resumeCursor: current?.cursor,
    };
    const result =
      key === "saved"
        ? await deps.bookmarks(args)
        : key === "liked"
          ? await deps.likes(args)
          : await deps.folder(key.slice("folder:".length), args);
    if (signal.aborted) return { ready: false, history };
    if (!result.ok) return { ready: false, history, problem: result.reason };
    history[key] = {
      ids: [
        ...new Set([
          ...(current?.ids ?? []),
          ...(result.seenIds ?? result.entries.map((e) => e.tweetId)),
        ]),
      ],
      cursor: result.resumeCursor,
      complete: result.reachedEnd,
    };
    await deps.persist(history);
    if (!result.reachedEnd)
      return { ready: false, history, problem: "baseline_incomplete" };
  }
  return { ready: true, history };
}

/** A post previously liked can still be a new bookmark, and vice versa. */
export function filterTwitterHistory(
  entries: readonly BookmarksEntry[],
  history: TwitterHistory,
): BookmarksEntry[] {
  const ids = new Map(
    Object.entries(history).map(([key, list]) => [key, new Set(list.ids)]),
  );
  return entries.flatMap((entry) => {
    const listKinds = (entry.listKinds ?? ["saved"]).filter((kind) => {
      if (kind === "liked") return !ids.get("liked")?.has(entry.tweetId);
      const lists = entry.collectionIds?.length
        ? entry.collectionIds.map((id) => `folder:${id}`)
        : ["saved"];
      return lists.some((key) => !ids.get(key)?.has(entry.tweetId));
    });
    return listKinds.length ? [{ ...entry, listKinds }] : [];
  });
}
