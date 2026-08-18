import assert from "node:assert/strict";
import test from "node:test";
import {
  BEACON_MAJOR,
  BEACON_UUID_BYTES,
  OFFERS,
  SOD_BEACON_NAME,
  createIBeaconScanOptions,
  createSoDBeaconDeviceOptions,
  findOffer,
  parseIBeacon,
} from "../lib/beacons.ts";

function frameForMinor(minor, includeCompanyIdentifier = false) {
  const payload = new Uint8Array(includeCompanyIdentifier ? 25 : 23);
  let offset = 0;
  if (includeCompanyIdentifier) {
    payload[offset++] = 0x4c;
    payload[offset++] = 0x00;
  }
  payload[offset++] = 0x02;
  payload[offset++] = 0x15;
  payload.set(BEACON_UUID_BYTES, offset);
  offset += 16;
  payload[offset++] = BEACON_MAJOR >> 8;
  payload[offset++] = BEACON_MAJOR & 0xff;
  payload[offset++] = minor >> 8;
  payload[offset++] = minor & 0xff;
  payload[offset] = 0xc5;
  return payload;
}

test("restricts direct scanning permission to the SoDBeacon name", () => {
  const options = createIBeaconScanOptions();
  assert.deepEqual(options.filters, [{ name: SOD_BEACON_NAME }]);
  assert.equal(options.keepRepeatedDevices, true);
  assert.equal("acceptAllAdvertisements" in options, false);
});

test("builds chooser permission options without requesting a GATT service", () => {
  const options = createSoDBeaconDeviceOptions();
  assert.deepEqual(options.filters, [{ name: SOD_BEACON_NAME }]);
  assert.deepEqual(options.optionalManufacturerData, [0x004c]);
  assert.equal("optionalServices" in options, false);
});

test("parses browser-style iBeacon manufacturer data", () => {
  const parsed = parseIBeacon(new DataView(frameForMinor(3).buffer), -70);
  assert.ok(parsed);
  assert.equal(parsed.uuid, "F0E1D2C3-B4A5-9687-7869-5A4B3C2D1E0F");
  assert.equal(parsed.major, 100);
  assert.equal(parsed.minor, 3);
  assert.equal(parsed.txPower, -59);
  assert.equal(findOffer(parsed)?.id, "zepto");
});

test("also accepts bridge frames that include the Apple company identifier", () => {
  const parsed = parseIBeacon(frameForMinor(4, true), -65);
  assert.equal(parsed?.minor, 4);
  assert.equal(findOffer(parsed)?.id, "apple");
});

test("rejects malformed frames and unknown campaign minors", () => {
  assert.equal(parseIBeacon(new Uint8Array([0x02, 0x15])), null);
  const parsed = parseIBeacon(frameForMinor(99));
  assert.ok(parsed);
  assert.equal(findOffer(parsed), undefined);
  assert.deepEqual(OFFERS.map((offer) => offer.minor), [1, 2, 3, 4]);
});
