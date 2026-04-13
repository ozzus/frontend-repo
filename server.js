const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const { URL } = require("url");

const PUBLIC_DIR = path.join(__dirname, "public");

const PORTS = Object.freeze({
  app: 8080,
  trusted: 8081,
  attacker: 8082,
  review: 8083,
});

const DEMO_HOST = process.env.DEMO_HOST || "localhost";
const DEMO_ORIGINS = Object.freeze({
  app: `http://${DEMO_HOST}:${PORTS.app}`,
  trusted: `http://${DEMO_HOST}:${PORTS.trusted}`,
  attacker: `http://${DEMO_HOST}:${PORTS.attacker}`,
  review: `http://${DEMO_HOST}:${PORTS.review}`,
});

const XFO_ALLOW_FROM_ORIGIN =
  process.env.XFO_ALLOW_FROM_ORIGIN || DEMO_ORIGINS.trusted;

const CSP_TRUSTED_ORIGINS = (
  process.env.CSP_TRUSTED_ORIGINS ||
  [DEMO_ORIGINS.trusted, DEMO_ORIGINS.review].join(",")
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const HTML_POLICIES = {
  "/xfo/admin-panel.html": {
    xFrameOptions: "DENY",
  },
  "/xfo/public-widget.html": {
    xFrameOptions: "SAMEORIGIN",
  },
  "/xfo/partner-widget.html": {
    xFrameOptions: `ALLOW-FROM ${XFO_ALLOW_FROM_ORIGIN}`,
  },
  "/csp/secure-dashboard.html": {
    csp: buildCsp(["'none'"]),
  },
  "/csp/embedded-content.html": {
    csp: buildCsp(CSP_TRUSTED_ORIGINS),
  },
  "/csp/self-embedded.html": {
    csp: buildCsp(["'self'"]),
  },
};

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const testResults = new Map();
const servers = [];

function buildCsp(frameAncestors) {
  return [
    "default-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "style-src 'self'",
    "script-src 'self'",
    `frame-ancestors ${frameAncestors.join(" ")}`,
  ].join("; ");
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(payload, null, 2));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function safePublicPath(requestPath) {
  const normalized = path.normalize(
    path.join(PUBLIC_DIR, requestPath === "/" ? "/index.html" : requestPath),
  );

  if (!normalized.startsWith(PUBLIC_DIR)) {
    return null;
  }

  return normalized;
}

function currentOrigin(req) {
  return `http://${req.headers.host}`;
}

function currentRole(req) {
  const port = Number(req.socket.localPort);
  const match = Object.entries(PORTS).find(([, knownPort]) => knownPort === port);
  return match ? match[0] : "unknown";
}

async function handleResults(req, res) {
  if (req.method === "GET") {
    return sendJson(res, 200, {
      count: testResults.size,
      items: Array.from(testResults.values()),
    });
  }

  if (req.method === "DELETE") {
    testResults.clear();
    return sendJson(res, 200, { cleared: true });
  }

  if (req.method === "POST") {
    const payload = JSON.parse((await readBody(req)) || "{}");
    const key = [
      payload.browser || "manual",
      payload.suite || "unknown",
      payload.role || "unknown",
      payload.origin || "unknown",
    ].join(":");

    testResults.set(key, payload);
    return sendJson(res, 201, { stored: true, key });
  }

  return sendJson(res, 405, { error: "method not allowed" });
}

async function serveStatic(res, requestPath) {
  const filePath = safePublicPath(requestPath);
  if (!filePath) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }

  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    sendJson(res, 404, { error: "not found" });
    return;
  }

  if (!stat.isFile()) {
    sendJson(res, 404, { error: "not found" });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const headers = {
    "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=60",
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };

  const policy = HTML_POLICIES[requestPath];
  if (policy?.xFrameOptions) {
    headers["X-Frame-Options"] = policy.xFrameOptions;
  }
  if (policy?.csp) {
    headers["Content-Security-Policy"] = policy.csp;
  }

  res.writeHead(200, headers);
  res.end(await fs.readFile(filePath));
}

async function handleRequest(req, res) {
  const url = new URL(req.url, currentOrigin(req));

  if (url.pathname === "/_health") {
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === "/demo-config.json") {
    return sendJson(res, 200, {
      currentOrigin: currentOrigin(req),
      currentRole: currentRole(req),
      ports: PORTS,
      origins: DEMO_ORIGINS,
      productionPartnerOrigin: "https://trusted-partner.com",
      xfoAllowFromOrigin: XFO_ALLOW_FROM_ORIGIN,
      cspTrustedOrigins: CSP_TRUSTED_ORIGINS,
    });
  }

  if (url.pathname === "/__results__") {
    try {
      return await handleResults(req, res);
    } catch (error) {
      return sendJson(res, 400, {
        error: "invalid result payload",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return serveStatic(res, url.pathname);
}

function startServer(role, port) {
  const server = http.createServer(handleRequest);
  server.listen(port, () => {
    console.log(`[${role}] ${DEMO_ORIGINS[role]}`);
  });
  servers.push(server);
}

function shutdown() {
  for (const server of servers) {
    server.close();
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

for (const [role, port] of Object.entries(PORTS)) {
  startServer(role, port);
}
