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

document.addEventListener("DOMContentLoaded", () => {
  fillText("[data-current-origin]", window.location.origin);
  fillText("[data-current-path]", window.location.pathname);

  if (window.parent && window.parent !== window) {
    window.parent.postMessage(
      {
        type: "frame-demo:loaded",
        pageId: document.body.dataset.pageId,
        suite: document.body.dataset.suite || "standalone",
        origin: window.location.origin,
        path: window.location.pathname,
      },
      "*",
    );
  }

  loadDemoConfig()
    .then((config) => {
      fillText("[data-xfo-allow-from-origin]", config.xfoAllowFromOrigin);
      fillText("[data-production-partner-origin]", config.productionPartnerOrigin);
      fillList("[data-csp-trusted-origins]", config.cspTrustedOrigins);
    })
    .catch((error) => {
      console.error(error);
    });
});
