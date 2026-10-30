import { type ImportScope, OPS } from "@pond/schema/db";
import { expect, it } from "vitest";
import { includesStoredVideo, runWithImportStorage } from "./import-storage";

it("processes metadata and finalizes without running any attachment or preview worker", async () => {
  const ran: string[] = [];
  for (const op of OPS) {
    await runWithImportStorage(
      op,
      "tweet",
      async () => {
        ran.push(op);
      },
      {
        readSave: async () => ({ source: "twitter", accountId: "account" }),
        accountStorage: async () => "metadata",
      },
    );
  }
  expect(ran).toEqual(["harvest_metadata", "finalize"]);
});

it("honors image and video choices independently of source defaults", async () => {
  let storage: ImportScope["storage"] = "images";
  let downloads = 0;
  const deps = {
    readSave: async () => ({
      source: "twitter" as const,
      accountId: "account",
    }),
    accountStorage: async () => storage,
  };
  const download = async () => {
    downloads++;
  };
  await runWithImportStorage("fetch_video_ytdlp", "tweet", download, deps);
  expect(downloads).toBe(0);
  expect(includesStoredVideo(storage, true)).toBe(false);
  storage = "media";
  await runWithImportStorage("fetch_video_ytdlp", "tweet", download, deps);
  expect(downloads).toBe(1);
  expect(includesStoredVideo(storage, false)).toBe(true);
  expect(includesStoredVideo(undefined, false)).toBe(false);
  expect(includesStoredVideo(undefined, true)).toBe(true);
});

it("propagates a worker failure and skips saves that no longer exist", async () => {
  const fail = async () => {
    throw new Error("network failed");
  };
  const deps = {
    readSave: async () => ({
      source: "twitter" as const,
      accountId: "account",
    }),
    accountStorage: async () => undefined,
  };
  await expect(
    runWithImportStorage("fetch_blobs", "tweet", fail, deps),
  ).rejects.toThrow("network failed");
  await expect(
    runWithImportStorage("fetch_blobs", "missing", fail, {
      ...deps,
      readSave: async () => null,
    }),
  ).resolves.toBeUndefined();
});
