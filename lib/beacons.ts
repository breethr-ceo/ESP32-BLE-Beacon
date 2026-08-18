export const APPLE_COMPANY_ID = 0x004c;
export const BEACON_MAJOR = 100;
export const SOD_BEACON_NAME = "SoDBeacon";
export const BEACON_UUID_DISPLAY = "F0E1D2C3-B4A5-9687-7869-5A4B3C2D1E0F";
export const BEACON_UUID_BYTES = [
  0xf0, 0xe1, 0xd2, 0xc3, 0xb4, 0xa5, 0x96, 0x87,
  0x78, 0x69, 0x5a, 0x4b, 0x3c, 0x2d, 0x1e, 0x0f,
] as const;

export type IBeaconScanOptions = {
  filters: Array<{ name: string }>;
  keepRepeatedDevices: boolean;
};

export type SoDBeaconDeviceOptions = {
  acceptAllDevices: true;
  optionalManufacturerData: number[];
};

export type BeaconOffer = {
  id: "coca-cola" | "maggi" | "zepto" | "apple";
  brand: string;
  minor: number;
  headline: string;
  copy: string;
  code: string;
  cta: string;
};

export type ParsedIBeacon = {
  uuid: string;
  major: number;
  minor: number;
  txPower: number;
  rssi?: number;
  estimatedDistanceMetres?: number;
};

export const OFFERS: readonly BeaconOffer[] = [
  {
    id: "coca-cola",
    brand: "Coca-Cola",
    minor: 1,
    headline: "A little fizz found you.",
    copy: "Take 20% off one chilled Coca-Cola in this proximity-demo moment.",
    code: "FIZZ20",
    cta: "Use demo offer",
  },
  {
    id: "maggi",
    brand: "MAGGI",
    minor: 2,
    headline: "Two minutes to something good.",
    copy: "A nearby bowl is calling. Preview a buy-two, save-₹20 Maggi offer.",
    code: "2MIN20",
    cta: "Use demo offer",
  },
  {
    id: "zepto",
    brand: "zepto",
    minor: 3,
    headline: "Blink and the basket is here.",
    copy: "Preview free delivery on a first nearby Zepto order in this prototype.",
    code: "NEARBY",
    cta: "Use demo offer",
  },
  {
    id: "apple",
    brand: "Apple",
    minor: 4,
    headline: "Make room for something new.",
    copy: "Explore a sample trade-in consultation offered when this beacon is close.",
    code: "HELLO04",
    cta: "Use demo offer",
  },
] as const;

export function createIBeaconScanOptions(): IBeaconScanOptions {
  return {
    // Restricting permission to the scan-response name avoids asking Chrome for
    // every nearby BLE advertisement. Campaign identity is still validated
    // from the iBeacon manufacturer payload before an offer is shown.
    filters: [{ name: SOD_BEACON_NAME }],
    keepRepeatedDevices: true,
  };
}

export function createSoDBeaconDeviceOptions(): SoDBeaconDeviceOptions {
  return {
    // The iBeacon packet fills almost all 31 legacy advertising bytes, so the
    // name is sent separately as a scan response. Chrome on macOS may not join
    // those two packets while applying a requestDevice name filter. Let the
    // user choose from all connectable BLE peripherals instead.
    acceptAllDevices: true,
    // Let advertisementreceived expose Apple's 0x004C manufacturer payload.
    // This grants data access only; the page never opens a GATT connection.
    optionalManufacturerData: [APPLE_COMPANY_ID],
  };
}

function uuidFromBytes(bytes: Uint8Array) {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toUpperCase();
}

export function parseIBeacon(
  input: DataView | Uint8Array,
  rssi?: number,
): ParsedIBeacon | null {
  const raw = input instanceof DataView
    ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);

  // Browser events omit the two-byte company identifier. Some native bridges
  // include it, so accept both representations.
  const offset = raw.length >= 25 && raw[0] === 0x4c && raw[1] === 0x00 ? 2 : 0;
  if (raw.length - offset < 23 || raw[offset] !== 0x02 || raw[offset + 1] !== 0x15) {
    return null;
  }

  const view = new DataView(raw.buffer, raw.byteOffset + offset, raw.byteLength - offset);
  const uuid = uuidFromBytes(raw.slice(offset + 2, offset + 18));
  const major = view.getUint16(18, false);
  const minor = view.getUint16(20, false);
  const txPower = view.getInt8(22);
  const estimatedDistanceMetres = rssi === undefined
    ? undefined
    : Math.pow(10, (txPower - rssi) / 20);

  return { uuid, major, minor, txPower, rssi, estimatedDistanceMetres };
}

export function findOffer(beacon: ParsedIBeacon): BeaconOffer | undefined {
  if (beacon.uuid !== BEACON_UUID_DISPLAY || beacon.major !== BEACON_MAJOR) {
    return undefined;
  }
  return OFFERS.find((offer) => offer.minor === beacon.minor);
}
