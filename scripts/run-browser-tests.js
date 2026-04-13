const { spawn } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const SERVER_FILE = path.join(ROOT_DIR, "server.js");
const APP_ORIGIN = "http://localhost:8080";
const OUTPUT_FILE = path.join(ROOT_DIR, "browser-test-results.json");

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

const BROWSERS = [
  {
    name: "chrome",
    path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    buildArgs(profilePath, url) {
      return [
        `--user-data-dir=${profilePath}`,
        "--new-window",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-session-crashed-bubble",
        url,
      ];
    },
  },
  {
    name: "firefox",
    path: "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
    buildArgs(profilePath, url) {
      return [
        "-no-remote",
        "-profile",
        profilePath,
        "-new-window",
        url,
      ];
    },
  },
  {
    name: "edge",
    path: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    buildArgs(profilePath, url) {
      return [
        `--user-data-dir=${profilePath}`,
        "--new-window",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-session-crashed-bubble",
        url,
      ];
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

function spawnDetached(command, args, cwd = ROOT_DIR) {
  return spawn(command, args, {
    cwd,
    stdio: "ignore",
    windowsHide: false,
  });
}

function runTaskkill(pid) {
  return new Promise((resolve) => {
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });

    killer.on("error", () => resolve());
    killer.on("exit", () => resolve());
  });
}

async function cleanupProfile(profilePath) {
  try {
    await fs.rm(profilePath, { recursive: true, force: true });
  } catch {
    // Best effort.
  }
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

function summarizeFailures(results) {
  return results.flatMap((entry) =>
    entry.scenarios
      .filter((scenario) => !scenario.passed)
      .map((scenario) => ({
        browser: entry.browser,
        suite: entry.suite,
        role: entry.role,
        pageId: scenario.pageId,
        expected: scenario.expected,
        actual: scenario.actual,
      })),
  );
}

async function runBrowserScenario(browser, url) {
  const browserUrl = `${url}&browser=${browser.name}`;
  const profilePath = path.join(
    os.tmpdir(),
    `frame-demo-${browser.name}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );

  await fs.mkdir(profilePath, { recursive: true });
  await fetchJson(`${APP_ORIGIN}/__results__`, { method: "DELETE" });

  const child = spawnDetached(browser.path, browser.buildArgs(profilePath, browserUrl));

  try {
    await delay(8000);
  } finally {
    await runTaskkill(child.pid);
    await delay(800);
    await cleanupProfile(profilePath);
  }

  const payload = await fetchJson(`${APP_ORIGIN}/__results__`);
  return payload.items.filter((item) => item.browser === browser.name);
}

async function main() {
  const availableBrowsers = [];
  for (const browser of BROWSERS) {
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
      for (const url of TEST_URLS) {
        try {
          const items = await runBrowserScenario(browser, url);

          if (items.length === 0) {
            issues.push({
              browser: browser.name,
              url,
              status: "no-results",
            });
            continue;
          }

          allResults.push(...items);
        } catch (error) {
          issues.push({
            browser: browser.name,
            url,
            status: "launch-failed",
            details: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const output = {
      generatedAt: new Date().toISOString(),
      results: allResults,
      summary: allResults.map(compactResult),
      failures: summarizeFailures(allResults),
      issues,
    };

    await fs.writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2), "utf8");
    console.log(JSON.stringify(output, null, 2));
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
