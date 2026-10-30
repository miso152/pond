const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtemp, mkdir, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

async function main() {
  const bundle = process.argv[2];
  const output = resolve(process.argv[3] ?? "packaged-smoke");
  assert.ok(bundle, "Pass the mounted Pond.app path");
  await mkdir(output, { recursive: true });
  const sandbox = await mkdtemp(join(tmpdir(), "pond-packaged-smoke-"));
  const child = spawn(
    join(bundle, "Contents/MacOS/Pond"),
    ["--remote-debugging-port=9223", "--remote-debugging-address=127.0.0.1"],
    {
      env: { ...process.env, POND_SANDBOX: sandbox },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";
  let socket;
  child.stdout.on("data", (chunk) => {
    logs += chunk;
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk;
  });
  const deadline = Date.now() + 60000;
  const timer = setTimeout(() => child.kill("SIGKILL"), 65000);
  async function until(read, description) {
    while (Date.now() < deadline) {
      const result = await read();
      if (result) return result;
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`Packaged app exited while waiting for ${description}`);
      await delay(150);
    }
    throw new Error(`Timed out waiting for ${description}`);
  }
  try {
    const page = await until(async () => {
      try {
        const pages = await fetch("http://127.0.0.1:9223/json/list").then(
          (response) => response.json(),
        );
        return pages.find(
          (entry) => entry.type === "page" && entry.url.includes("index.html"),
        );
      } catch {
        return null;
      }
    }, "packaged renderer");
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((accept, reject) => {
      socket.addEventListener("open", accept, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    let sequence = 0;
    const pending = new Map();
    socket.addEventListener("message", (event) => {
      const reply = JSON.parse(event.data);
      const request = pending.get(reply.id);
      if (!request) return;
      pending.delete(reply.id);
      if (reply.error) request.reject(new Error(JSON.stringify(reply.error)));
      else request.resolve(reply.result);
    });
    const command = (method, params = {}) => {
      const id = ++sequence;
      return new Promise((accept, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`DevTools command timed out: ${method}`));
        }, 10000);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timeout);
            accept(value);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    };
    const evaluate = async (expression) => {
      const reply = await command("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (reply.exceptionDetails)
        throw new Error(JSON.stringify(reply.exceptionDetails));
      return reply.result.value;
    };
    await until(
      () =>
        evaluate(
          "Boolean(window.pond && document.body && document.body.innerText.trim())",
        ),
      "Pond preload and UI",
    );
    const info = await evaluate("window.pond.appInfo()");
    assert.equal(info.isPackaged, true);
    assert.equal(info.arch, "arm64");
    assert.equal(info.version, "2.0.3-selective-sync.1");
    await evaluate(`(async () => {
      await window.pond.query("settings.setOnboarded", {});
      const result = await window.pond.query("settings.setPrefs", {
        setup: { version: 1 }, window: { startupPage: "continue" },
        sync: { cron: { enabled: false }, accounts: {
          "packaging-twitter": { id: "packaging-twitter", source: "twitter", handle: "packaging_fixture", identityKey: null, label: "Packaging fixture", addedAt: new Date().toISOString(), sync: {
            lastSyncedAt: null, lastError: null, highWaterMark: null, lastFullSyncAt: null, knownCount: 0, runningSince: null, importPending: true, importScope: { listKinds: ["saved"], storage: "metadata" }
          } }
        } }
      });
      if (!result.ok) throw new Error("Fixture preferences were rejected");
      localStorage.setItem("pond:startupPage", "continue");
      localStorage.setItem("pond:lastPath:" + window.pond.libraryId(), "/sources/account/packaging-twitter");
    })()`);
    await command("Page.reload");
    await until(async () => {
      try {
        return await evaluate(
          "Boolean(document.querySelector('[aria-label=\"Store\"]'))",
        );
      } catch {
        return false;
      }
    }, "Store control in the packaged Filters page");
    assert.ok(
      await evaluate('document.body.innerText.includes("Metadata Only")'),
    );
    await evaluate(
      `document.querySelector('[aria-label="Store"]').scrollIntoView({ block: "center" })`,
    );
    await command("Page.enable");
    const screenshot = await command("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    });
    await writeFile(
      join(output, "filters.png"),
      Buffer.from(screenshot.data, "base64"),
    );
    await evaluate(
      `localStorage.setItem("pond:lastPath:" + window.pond.libraryId(), "/downloads")`,
    );
    await command("Page.reload");
    await until(async () => {
      try {
        return await evaluate(
          "Boolean(document.querySelector('[aria-label=\"Stop All\"]'))",
        );
      } catch {
        return false;
      }
    }, "Stop All in the packaged Downloads page");
    await writeFile(
      join(output, "result.json"),
      JSON.stringify({ ...info, store: true, stopAll: true }, null, 2),
    );
    console.log("PACKAGED_SMOKE_PASSED", JSON.stringify(info));
  } finally {
    clearTimeout(timer);
    socket?.close();
    child.kill("SIGKILL");
    await writeFile(join(output, "app.log"), logs);
    await rm(sandbox, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("PACKAGED_SMOKE_FAILED", error);
  process.exitCode = 1;
});
