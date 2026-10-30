import { pauseAll } from "./pipeline/rate-governor";
import {
  cancelAllIngest,
  setReconcilerPaused,
} from "./pipeline/reconciler-client";
import { cancelAllSyncs } from "./sync/sync-status";

/** Close discovery and queue admission before cancelling existing work. */
export async function stopAllImports(
  deps = { pauseAll, cancelAllSyncs, setReconcilerPaused, cancelAllIngest },
): Promise<number> {
  deps.pauseAll();
  deps.cancelAllSyncs();
  await deps.setReconcilerPaused(true);
  return deps.cancelAllIngest();
}
