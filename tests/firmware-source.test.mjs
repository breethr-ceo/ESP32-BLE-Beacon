import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sketchUrl = new URL(
  "../arduino/BeaconAdvertiser/BeaconAdvertiser.ino",
  import.meta.url,
);

test("firmware keeps iBeacon advertisements separate from optional GATT", async () => {
  const sketch = await readFile(sketchUrl, "utf8");

  assert.match(sketch, /BLEBeacon beacon;/);
  assert.match(sketch, /kDeviceName\[\] = "SoDBeacon"/);
  assert.match(sketch, /setScanResponse\(true\)/);
  assert.match(sketch, /setScanResponseData\(scanResponseData\)/);
  assert.match(
    sketch,
    /BLECharacteristic::PROPERTY_READ\s*\|\s*BLECharacteristic::PROPERTY_NOTIFY/,
  );
  assert.match(sketch, /Campaign detection requires no connection/);
});
