import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the finished Beacon Shelf experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Beacon Shelf — ESP32 iBeacon Offer Demo<\/title>/i);
  assert.match(html, /Walk in\./);
  assert.match(html, /Start scanner/);
  assert.match(html, /regular Google Chrome only/);
  assert.match(html, /Live Bluetooth scan diagnostics/);
  assert.match(html, /All ads/);
  assert.match(html, /Coca-Cola/);
  assert.match(html, /MAGGI/);
  assert.match(html, /zepto/);
  assert.match(html, /Apple/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});
