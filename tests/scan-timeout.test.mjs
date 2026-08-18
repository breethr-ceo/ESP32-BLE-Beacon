import assert from "node:assert/strict";
import test from "node:test";

import {
  BluetoothPermissionTimeoutError,
  waitForBluetoothScan,
} from "../lib/scan-timeout.ts";

test("returns a Bluetooth scan that resolves before the deadline", async () => {
  const scan = { active: true };
  assert.equal(await waitForBluetoothScan(Promise.resolve(scan), 50), scan);
});

test("times out a scan request that never settles", async () => {
  await assert.rejects(
    waitForBluetoothScan(new Promise(() => {}), 5),
    BluetoothPermissionTimeoutError,
  );
});

test("stops a scan that resolves after the page has timed out", async () => {
  let resolveScan;
  const scanRequest = new Promise((resolve) => {
    resolveScan = resolve;
  });
  let lateResult;

  await assert.rejects(
    waitForBluetoothScan(scanRequest, 5, (scan) => {
      lateResult = scan;
    }),
    BluetoothPermissionTimeoutError,
  );

  const scan = { active: true };
  resolveScan(scan);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(lateResult, scan);
});
