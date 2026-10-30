import { expect, it } from "vitest";
import { stopAllImports } from "./stop-imports";

it("blocks discovery and dispatch before cancelling all unfinished saves", async () => {
  const events: string[] = [];
  const cancelled = await stopAllImports({
    pauseAll: () => {
      events.push("pause sources");
    },
    cancelAllSyncs: () => {
      events.push("cancel discovery");
    },
    setReconcilerPaused: async (paused) => {
      events.push(`pause queue ${paused}`);
      return paused;
    },
    cancelAllIngest: async () => {
      events.push("cancel downloads");
      return 8;
    },
  });
  expect(cancelled).toBe(8);
  expect(events).toEqual([
    "pause sources",
    "cancel discovery",
    "pause queue true",
    "cancel downloads",
  ]);
});
