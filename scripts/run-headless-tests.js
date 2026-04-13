const { spawn } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const SERVER_FILE = path.join(ROOT_DIR, "server.js");
const APP_ORIGIN = "http://localhost:8080";

const TEST_URLS = [
  "http://localhost:8080/tests/xfo-lab.html?auto=1",
  "http://localhost:8081/tests/xfo-lab.html?auto=1",
  "http://localhost:8082/tests/xfo-lab.html?auto=1",
  "http://localhost:8083/tests/xfo-lab.html?auto=1",
  "http://localhost:8080/tests/csp-lab.html?auto=1",
  "http://localhost:8081/tests/csp-lab.html?auto=1",
  "http://localhost:8082/tests/csp-lab.html?auto=1",
  "http://localhost:8083/tests/csp-lab.html?auto=1",
];

const KNOWN_BROWSERS = [
  {
    name: "chrome",
    path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    async buildRun(url) {
      return {
        args: [
          "--headless=new",
          "--disable-gpu",
          "--run-all-compositor-stages-before-draw",
          "--virtual-time-budget=5000",
          "--dump-dom",
          `${url}&browser=${this.name}`,
        ],
        timeoutMs: 20000,
      };
    },
  },
  {
    name: "edge",
    path: "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    async buildRun(url) {
      return {
        args: [
          "--headless=new",
          "--disable-gpu",
          "--run-all-compositor-stages-before-draw",
          "--virtual-time-budget=5000",
          "--dump-dom",
          `${url}&browser=${this.name}`,
        ],
        timeoutMs: 20000,
      };
    },
  },
  {
    name: "edge-x86",
    path: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    async buildRun(url) {
      return {
        args: [
          "--headless=new",
          "--disable-gpu",
          "--run-all-compositor-stages-before-draw",
          "--virtual-time-budget=5000",
          "--dump-dom",
          `${url}&browser=edge`,
        ],
        timeoutMs: 20000,
      };
    },
  },
  {
    name: "firefox",
    path: "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
    async buildRun(url) {
      const profilePath = path.join(
        os.tmpdir(),
        `frame-demo-firefox-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      );
      const screenshotPath = path.join(
        os.tmpdir(),
        `frame-demo-${Date.now()}-${Math.random().toString(16).slice(2)}.png`,
      );

      await fs.mkdir(profilePath, { recursive: true });

      return {
        args: [
          "-headless",
          "-no-remote",
          "-profile",
          profilePath,
          "-window-size",
          "1400,1100",
          "-screenshot",
          screenshotPath,
          `${url}&browser=${this.name}`,
        ],
        cleanupPaths: [screenshotPath, profilePath],
        timeoutMs: 10000,
      };
    },
  },
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function waitForHealth(timeoutMs = 10000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await fetchJson(`${APP_ORIGIN}/_health`);
      return;
    } catch {
      await delay(200);
    }
  }

  throw new Error("server did not become healthy in time");
}

async function removePathIfExists(targetPath) {
  try {
    await fs.rm(targetPath, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup.
  }
}

function runProcess(command, args, label, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "ignore",
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${label} exited with code ${code}`));
    });
  });
}

function compactResult(item) {
  return {
    browser: item.browser,
    suite: item.suite,
    role: item.role,
    passed: item.scenarios.filter((scenario) => scenario.passed).length,
    total: item.scenarios.length,
  };
}

async function main() {
  const availableBrowsers = [];
  for (const browser of KNOWN_BROWSERS) {
    if (await pathExists(browser.path)) {
      availableBrowsers.push(browser);
    }
  }

  if (availableBrowsers.length === 0) {
    throw new Error("no supported browsers were found");
  }

  const server = spawn(process.execPath, [SERVER_FILE], {
    cwd: ROOT_DIR,
    stdio: ["ignore", "ignore", "inherit"],
    windowsHide: true,
  });

  try {
    await waitForHealth();
    const allResults = [];
    const issues = [];

    for (const browser of availableBrowsers) {
      await fetchJson(`${APP_ORIGIN}/__results__`, { method: "DELETE" });

      try {
        for (const url of TEST_URLS) {
          const runConfig = await browser.buildRun(url);

          try {
            await runProcess(
              browser.path,
              runConfig.args,
              browser.name,
              runConfig.timeoutMs,
            );
          } finally {
            for (const cleanupPath of runConfig.cleanupPaths || []) {
              await removePathIfExists(cleanupPath);
            }
          }
        }

        await delay(800);
        const payload = await fetchJson(`${APP_ORIGIN}/__results__`);
        const browserResults = payload.items.filter((item) => item.browser === browser.name);

        if (browserResults.length === 0) {
          issues.push({
            browser: browser.name,
            status: "no-results",
            details: "Browser started, but the harness did not post results back to the demo server.",
          });
          continue;
        }

        allResults.push(...browserResults);
      } catch (error) {
        issues.push({
          browser: browser.name,
          status: "launch-failed",
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const outputPath = path.join(ROOT_DIR, "browser-test-results.json");
    const summary = allResults.map(compactResult);

    await fs.writeFile(
      outputPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          results: allResults,
          summary,
          issues,
        },
        null,
        2,
      ),
      "utf8",
    );

    console.log(JSON.stringify(summary, null, 2));
    if (issues.length > 0) {
      console.log(JSON.stringify({ issues }, null, 2));
    }
    console.log(`Saved results to ${outputPath}`);
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
