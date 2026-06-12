// Local preview server: node scripts/serve.js  →  http://localhost:8000
// Serves web/ with no-store headers so you always see your working tree.
//
// By default the Firebase <script> tags are stripped from index.html, which
// puts the app in its local-only mode: no sign-in gate, favorites/bar from
// localStorage — ideal for previewing UI changes. Pass --firebase to keep
// the real sign-in flow.
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "web");
const PORT = process.env.PORT || 8000;
const KEEP_FIREBASE = process.argv.includes("--firebase");
const FIREBASE_TAG_RE = /[ \t]*<script src="https:\/\/www\.gstatic\.com\/firebasejs[^"]*"><\/script>\r?\n?/g;

// Served instead of the real sw.js: a previously-installed service worker
// from an earlier preview session would otherwise serve its cached copy of
// the app (cache-first) and you'd never see your edits. This stub takes
// over, wipes every cache, and unregisters itself — after one reload the
// page talks straight to this server.
const KILL_SW = `
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.map(k => caches.delete(k))))
    .then(() => self.registration.unregister())
    .then(() => self.clients.claim())
));
`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png":  "image/png",
  ".svg":  "image/svg+xml",
};

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  if (p === "/sw.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
    res.end(KILL_SW);
    return;
  }
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    if (!KEEP_FIREBASE && path.basename(file) === "index.html") {
      data = Buffer.from(data.toString("utf8").replace(FIREBASE_TAG_RE, ""));
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",   // dev: always serve the working tree
    });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`Preview of web/ at http://localhost:${PORT}`);
  console.log(KEEP_FIREBASE
    ? "Mode: real Firebase sign-in (--firebase)."
    : "Mode: local-only — sign-in gate skipped, data from localStorage.");
  console.log("Tip: use a private/incognito window so the service worker");
  console.log("cache from a previous preview session never shows stale files.");
});
