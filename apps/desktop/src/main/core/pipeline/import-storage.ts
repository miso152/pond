import type { ImportScope, Op, Save } from "@pond/schema/db";
import { getAccount } from "../sync/accounts";
import { readSave } from "./workers/apply";

type Storage = ImportScope["storage"];

export async function accountStorage(
  save: Pick<Save, "source" | "accountId">,
): Promise<Storage> {
  if (save.source !== "twitter" || !save.accountId) return undefined;
  return (await getAccount(save.accountId))?.sync.importScope?.storage;
}

function skipsStoredTask(storage: Storage, op: Op): boolean {
  if (storage === "metadata")
    return op !== "harvest_metadata" && op !== "finalize";
  return storage === "images" && op === "fetch_video_ytdlp";
}

/** Enforce account storage before a task can produce attachments or derived previews. */
export async function runWithImportStorage(
  op: Op,
  saveId: string,
  run: () => Promise<void>,
  dependencies: {
    readSave: (
      id: string,
    ) => Promise<Pick<Save, "source" | "accountId"> | null>;
    accountStorage: typeof accountStorage;
  } = { readSave, accountStorage },
): Promise<void> {
  const save = await dependencies.readSave(saveId);
  if (!save) return;
  if (skipsStoredTask(await dependencies.accountStorage(save), op)) return;
  await run();
}

export function includesStoredVideo(
  storage: Storage,
  autoDownload: boolean,
): boolean {
  if (storage === "metadata" || storage === "images") return false;
  return storage === "media" || autoDownload;
}
