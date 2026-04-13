async function loadDemoConfig() {
  const response = await fetch("/demo-config.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`config request failed with ${response.status}`);
  }
  return response.json();
}

function fillText(selector, value) {
  document.querySelectorAll(selector).forEach((node) => {
    node.textContent = value;
  });
}

function fillList(selector, items) {
  document.querySelectorAll(selector).forEach((node) => {
    node.innerHTML = "";
    items.forEach((item) => {
      const li = document.createElement("li");
      const code = document.createElement("code");
      code.textContent = item;
      li.appendChild(code);
      node.appendChild(li);
    });
  });
}

function wireRoleLinks(config) {
  document.querySelectorAll("[data-role-link]").forEach((node) => {
    const role = node.dataset.roleLink;
    const targetPath = node.dataset.path || "/";
    if (!config.origins[role]) {
      return;
    }
    node.href = `${config.origins[role]}${targetPath}`;
  });
}

function summarizeContext(config) {
  fillText("[data-current-origin]", config.currentOrigin);
  fillText("[data-current-role]", config.currentRole);
  fillText("[data-xfo-allow-from-origin]", config.xfoAllowFromOrigin);
  fillText("[data-production-partner-origin]", config.productionPartnerOrigin);
  fillList("[data-csp-trusted-origins]", config.cspTrustedOrigins);
}

function expectedFor(card, role) {
  const key = `expected${role.charAt(0).toUpperCase()}${role.slice(1)}`;
  return card.dataset[key] || "blocked";
}

function setStatus(node, passed, expected, actual) {
  node.classList.remove("waiting", "pass", "fail");
  node.classList.add(passed ? "pass" : "fail");
  node.textContent = `${passed ? "PASS" : "FAIL"} — ожидалось ${expected}, получено ${actual}`;
}

async function publishResults(payload) {
  try {
    await fetch("/__results__", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // Manual mode.
  }
}

function installHarness(config) {
  const body = document.body;
  if (body.dataset.page !== "test-harness") {
    return;
  }

  const suite = body.dataset.suite;
  const role = config.currentRole;
  const browser = new URLSearchParams(window.location.search).get("browser") || "manual";
  const cards = Array.from(document.querySelectorAll("[data-test-card]"));
  const loadedPages = new Set();
  const cardIndex = new Map(cards.map((card) => [card.dataset.pageId, card]));

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.type !== "frame-demo:loaded") {
      return;
    }

    if (cardIndex.has(data.pageId)) {
      loadedPages.add(data.pageId);
    }
  });

  cards.forEach((card) => {
    const iframe = card.querySelector("iframe");
    const statusNode = card.querySelector("[data-status]");
    statusNode.textContent = "WAITING — ожидаем postMessage от вложенной страницы";
    statusNode.classList.add("waiting");
    iframe.src = `${config.origins.app}${card.dataset.targetPath}`;
  });

  window.setTimeout(async () => {
    const scenarios = cards.map((card) => {
      const expected = expectedFor(card, role);
      const actual = loadedPages.has(card.dataset.pageId) ? "allowed" : "blocked";
      const passed = expected === actual;
      setStatus(card.querySelector("[data-status]"), passed, expected, actual);
      return {
        pageId: card.dataset.pageId,
        expected,
        actual,
        passed,
      };
    });

    const passed = scenarios.filter((item) => item.passed).length;
    const failed = scenarios.length - passed;

    fillText("[data-summary-total]", String(scenarios.length));
    fillText("[data-summary-pass]", String(passed));
    fillText("[data-summary-fail]", String(failed));

    body.dataset.complete = "true";

    await publishResults({
      browser,
      suite,
      role,
      origin: config.currentOrigin,
      finishedAt: new Date().toISOString(),
      scenarios,
    });
  }, 2200);
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const config = await loadDemoConfig();
    wireRoleLinks(config);
    summarizeContext(config);
    installHarness(config);
  } catch (error) {
    console.error(error);
    fillText("[data-current-origin]", "config error");
    fillText("[data-current-role]", "unknown");
  }
});
