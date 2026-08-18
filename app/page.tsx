"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  APPLE_COMPANY_ID,
  BEACON_MAJOR,
  BEACON_UUID_DISPLAY,
  OFFERS,
  type BeaconOffer,
  type ParsedIBeacon,
  createIBeaconScanOptions,
  findOffer,
  parseIBeacon,
} from "../lib/beacons";
import {
  BluetoothPermissionTimeoutError,
  waitForBluetoothScan,
} from "../lib/scan-timeout";

type ScanState = "idle" | "requesting" | "scanning" | "error";
type Capability = "checking" | "ready" | "insecure" | "unsupported" | "unavailable";

interface BluetoothLEScan {
  active: boolean;
  stop: () => void;
}

interface BluetoothAdvertisementEvent extends Event {
  manufacturerData: Map<number, DataView>;
  name?: string;
  device?: { name?: string | null };
  rssi?: number;
}

interface BluetoothScanner {
  requestLEScan?: (
    options: ReturnType<typeof createIBeaconScanOptions>,
  ) => Promise<BluetoothLEScan>;
  addEventListener: (
    type: "advertisementreceived",
    listener: (event: Event) => void,
  ) => void;
  removeEventListener: (
    type: "advertisementreceived",
    listener: (event: Event) => void,
  ) => void;
}

type BluetoothNavigator = Navigator & { bluetooth?: BluetoothScanner };

type BeaconSighting = {
  parsed: ParsedIBeacon;
  seenAt: number;
};

type ScanStats = {
  advertisements: number;
  sodNamedFrames: number;
  appleFrames: number;
  iBeaconFrames: number;
  campaignMatches: number;
  lastAdvertisementAt?: number;
  lastRssi?: number;
};

const MINIMUM_RSSI = -86;
const POPUP_COOLDOWN_MS = 20_000;
const EMPTY_SCAN_STATS: ScanStats = {
  advertisements: 0,
  sodNamedFrames: 0,
  appleFrames: 0,
  iBeaconFrames: 0,
  campaignMatches: 0,
};

function getBluetooth(): BluetoothScanner | undefined {
  return (navigator as BluetoothNavigator).bluetooth;
}

function signalLabel(rssi?: number) {
  if (rssi === undefined) return "Signal received";
  if (rssi >= -60) return "Very close";
  if (rssi >= -72) return "Nearby";
  if (rssi >= MINIMUM_RSSI) return "In range";
  return "Far away";
}

function timeAgo(timestamp: number | undefined, now: number) {
  if (!timestamp) return "Waiting for signal";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 2) return "Seen just now";
  if (seconds < 60) return `Seen ${seconds}s ago`;
  return `Seen ${Math.floor(seconds / 60)}m ago`;
}

function OfferModal({
  offer,
  onClose,
  onAccept,
}: {
  offer: BeaconOffer;
  onClose: () => void;
  onAccept: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <article
        aria-labelledby="offer-title"
        aria-modal="true"
        className={`offer-modal offer-${offer.id}`}
        role="dialog"
      >
        <div className="offer-orbit orbit-one" />
        <div className="offer-orbit orbit-two" />
        <button className="modal-close" onClick={onClose} aria-label="Close offer">
          ×
        </button>
        <p className="offer-kicker">Nearby drop · demo</p>
        <div className="offer-wordmark">{offer.brand}</div>
        <h2 id="offer-title">{offer.headline}</h2>
        <p className="offer-copy">{offer.copy}</p>
        <div className="offer-bottom">
          <span className="offer-code">{offer.code}</span>
          <button className="offer-action" onClick={onAccept}>
            {offer.cta}
            <span aria-hidden="true">↗</span>
          </button>
        </div>
        <p className="demo-disclaimer">Prototype promotion — no purchase or redemption.</p>
      </article>
    </div>
  );
}

export default function Home() {
  const [capability, setCapability] = useState<Capability>("checking");
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [statusMessage, setStatusMessage] = useState("Ready when you are");
  const [currentOffer, setCurrentOffer] = useState<BeaconOffer | null>(null);
  const [sightings, setSightings] = useState<Record<string, BeaconSighting>>({});
  const [scanStats, setScanStats] = useState<ScanStats>(EMPTY_SCAN_STATS);
  const [scanStartedAt, setScanStartedAt] = useState<number>();
  const [clock, setClock] = useState(0);
  const [toast, setToast] = useState("");
  const scanRef = useRef<BluetoothLEScan | null>(null);
  const lastPopupRef = useRef<Record<string, number>>({});
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const capabilityCheck = window.setTimeout(() => {
      if (!window.isSecureContext) {
        setCapability("insecure");
        return;
      }
      const bluetooth = getBluetooth();
      if (!bluetooth) {
        setCapability("unsupported");
        return;
      }
      setCapability(
        typeof bluetooth.requestLEScan === "function" ? "ready" : "unavailable",
      );
    }, 0);
    return () => window.clearTimeout(capabilityCheck);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const handleAdvertisement = useCallback((event: Event) => {
    const advertisement = event as BluetoothAdvertisementEvent;
    const advertisedName = advertisement.name ?? advertisement.device?.name ?? undefined;
    const appleData = advertisement.manufacturerData?.get(APPLE_COMPANY_ID);
    const parsed = appleData ? parseIBeacon(appleData, advertisement.rssi) : null;
    const offer = parsed ? findOffer(parsed) : undefined;
    const seenAt = Date.now();

    setScanStats((previous) => ({
      advertisements: previous.advertisements + 1,
      sodNamedFrames: previous.sodNamedFrames + (advertisedName === "SoDBeacon" ? 1 : 0),
      appleFrames: previous.appleFrames + (appleData ? 1 : 0),
      iBeaconFrames: previous.iBeaconFrames + (parsed ? 1 : 0),
      campaignMatches: previous.campaignMatches + (offer ? 1 : 0),
      lastAdvertisementAt: seenAt,
      lastRssi: advertisement.rssi,
    }));

    if (!parsed || !offer) return;

    setSightings((previous) => ({
      ...previous,
      [offer.id]: { parsed, seenAt },
    }));

    const isCloseEnough = parsed.rssi === undefined || parsed.rssi >= MINIMUM_RSSI;
    const lastPopup = lastPopupRef.current[offer.id] ?? 0;
    if (isCloseEnough && seenAt - lastPopup >= POPUP_COOLDOWN_MS) {
      lastPopupRef.current[offer.id] = seenAt;
      setCurrentOffer(offer);
    }
  }, []);

  useEffect(() => {
    const bluetooth = getBluetooth();
    if (!bluetooth) return;

    bluetooth.addEventListener("advertisementreceived", handleAdvertisement);
    return () => {
      bluetooth.removeEventListener("advertisementreceived", handleAdvertisement);
      scanRef.current?.stop();
      scanRef.current = null;
    };
  }, [handleAdvertisement]);

  useEffect(() => {
    if (scanState !== "scanning" || !scanRef.current || scanRef.current.active) return;
    scanRef.current = null;
    setScanState("idle");
    setScanStartedAt(undefined);
    setStatusMessage("Chrome stopped the scan. Keep this tab visible, then start it again.");
  }, [clock, scanState]);

  const startScan = async () => {
    const bluetooth = getBluetooth();
    if (!bluetooth?.requestLEScan) {
      setCapability(bluetooth ? "unavailable" : "unsupported");
      return;
    }

    setScanState("requesting");
    setScanStats({ ...EMPTY_SCAN_STATS });
    setScanStartedAt(undefined);
    setStatusMessage("Waiting for Bluetooth permission…");
    try {
      const scan = await waitForBluetoothScan(
        bluetooth.requestLEScan(createIBeaconScanOptions()),
        undefined,
        (lateScan) => lateScan.stop(),
      );
      if (!mountedRef.current) {
        scan.stop();
        return;
      }
      scanRef.current = scan;
      setScanState("scanning");
      setScanStartedAt(Date.now());
      setStatusMessage("Scan active. Waiting for nearby BLE advertisements…");
    } catch (error) {
      if (!mountedRef.current) return;
      const message = error instanceof BluetoothPermissionTimeoutError
        ? "Bluetooth permission timed out. Open this URL in regular Google Chrome (not an in-app browser), enable Experimental Web Platform features, allow Chrome in macOS Bluetooth settings, then retry."
        : error instanceof Error
          ? error.message
          : String(error);
      setScanState("error");
      setStatusMessage(message || "The Bluetooth scan could not start");
    }
  };

  const stopScan = () => {
    scanRef.current?.stop();
    scanRef.current = null;
    setScanState("idle");
    setScanStartedAt(undefined);
    setStatusMessage("Scan stopped");
  };

  const capabilityMessage = useMemo(() => {
    if (capability === "checking") return "Checking browser capability…";
    if (capability === "insecure") return "Use HTTPS or localhost to unlock Bluetooth.";
    if (capability === "unsupported") return "This browser does not expose Web Bluetooth.";
    if (capability === "unavailable") {
      return "BLE advertisement scanning is unavailable here. Open this URL in regular Google Chrome on macOS, or use the demo buttons.";
    }
    if (scanState === "scanning" && scanStats.campaignMatches > 0) {
      return `Campaign beacon detected. ${scanStats.campaignMatches} matching advertisement${scanStats.campaignMatches === 1 ? "" : "s"} received.`;
    }
    if (scanState === "scanning" && scanStats.iBeaconFrames > 0) {
      return `Chrome received ${scanStats.iBeaconFrames} iBeacon frame${scanStats.iBeaconFrames === 1 ? "" : "s"}, but the UUID, major, or minor did not match this campaign.`;
    }
    if (scanState === "scanning" && scanStats.appleFrames > 0) {
      return `Chrome received ${scanStats.appleFrames} Apple manufacturer frame${scanStats.appleFrames === 1 ? "" : "s"}, but none parsed as iBeacon.`;
    }
    if (scanState === "scanning" && scanStats.sodNamedFrames > 0) {
      return "Chrome sees SoDBeacon by its scan-response name, but has not delivered its iBeacon manufacturer data yet.";
    }
    if (scanState === "scanning" && scanStats.advertisements > 0) {
      return `Chrome is receiving BLE advertisements (${scanStats.advertisements}), but none currently contains Apple iBeacon data.`;
    }
    if (
      scanState === "scanning"
      && scanStartedAt
      && clock - scanStartedAt >= 8_000
    ) {
      return "Scan is active, but Chrome has delivered 0 advertisements. Keep this tab visible and check chrome://bluetooth-internals in another Chrome tab.";
    }
    return statusMessage;
  }, [capability, clock, scanStartedAt, scanState, scanStats, statusMessage]);

  const simulateOffer = (offer: BeaconOffer) => {
    const parsed: ParsedIBeacon = {
      uuid: BEACON_UUID_DISPLAY,
      major: BEACON_MAJOR,
      minor: offer.minor,
      txPower: -59,
      rssi: -62,
      estimatedDistanceMetres: 1.4,
    };
    setSightings((previous) => ({
      ...previous,
      [offer.id]: { parsed, seenAt: Date.now() },
    }));
    setCurrentOffer(offer);
  };

  const isScanning = scanState === "scanning";
  const startDisabled = capability !== "ready" || ["requesting", "scanning"].includes(scanState);
  const scannerMessageKind = scanState === "error" ? "error" : capability;
  const scannerMessageLabel = isScanning
    ? "LIVE"
    : scanState === "error"
      ? "ERROR"
      : capability === "ready"
        ? "READY"
        : "NOTE";

  return (
    <main className="site-shell">
      <header className="topbar">
        <a className="logo" href="#top" aria-label="Beacon Shelf home">
          <span className="logo-signal" aria-hidden="true"><i /><i /><i /></span>
          Beacon Shelf
        </a>
        <div className="topbar-note">ESP32 × iBeacon + GATT × Web Bluetooth</div>
        <a className="guide-link" href="#how-it-works">How it works <span>↓</span></a>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow"><span /> Live proximity prototype</div>
          <h1>Walk in.<br /><em>Offers wake up.</em></h1>
          <p className="hero-lede">
            A four-beacon retail demo. Each ESP32 advertises an iBeacon campaign frame
            plus an optional SoDBeacon GATT endpoint; pop-ups use advertisements only.
          </p>
          <div className="hero-meta">
            <span>01</span><p>One campaign UUID</p>
            <span>04</span><p>Unique beacon minors</p>
            <span>20s</span><p>Per-offer cooldown</p>
          </div>
        </div>

        <aside className="scanner-card" aria-label="Bluetooth scanner controls">
          <div className="scanner-head">
            <span className={`status-light ${isScanning ? "is-live" : ""}`} />
            <div>
              <p className="scanner-label">Scanner</p>
              <h2>{isScanning ? "Sweep in progress" : "Standing by"}</h2>
            </div>
            <span className="scanner-number">BLE / 01</span>
          </div>

          <div className={`radar ${isScanning ? "is-scanning" : ""}`} aria-hidden="true">
            <div className="radar-ring ring-a" />
            <div className="radar-ring ring-b" />
            <div className="radar-ring ring-c" />
            <div className="radar-core"><span /></div>
            <div className="radar-sweep" />
          </div>

          <div className={`scanner-message scanner-${scannerMessageKind}`} aria-live="polite">
            <span>{scannerMessageLabel}</span>
            <p>{capabilityMessage}</p>
          </div>

          <dl className="scan-metrics" aria-label="Live Bluetooth scan diagnostics">
            <div><dt>All ads</dt><dd>{scanStats.advertisements}</dd></div>
            <div><dt>SoD name</dt><dd>{scanStats.sodNamedFrames}</dd></div>
            <div><dt>Apple</dt><dd>{scanStats.appleFrames}</dd></div>
            <div><dt>iBeacon</dt><dd>{scanStats.iBeaconFrames}</dd></div>
            <div><dt>Matched</dt><dd>{scanStats.campaignMatches}</dd></div>
          </dl>

          <div className="scanner-actions">
            <button className="primary-button" onClick={startScan} disabled={startDisabled}>
              {scanState === "requesting" ? "Requesting…" : isScanning ? "Scanning…" : "Start scanner"}
            </button>
            <button className="stop-button" onClick={stopScan} disabled={!isScanning}>
              Stop
            </button>
          </div>
          <p className="privacy-note">Campaign trigger: advertisements only · no GATT connection</p>
          <p className="privacy-note privacy-note-secondary">macOS scan: regular Google Chrome only · not an in-app browser</p>
          <p className="privacy-note privacy-note-secondary">
            Foreground only · ads filtered locally · nothing uploaded · last signal {scanStats.lastAdvertisementAt ? `${scanStats.lastRssi ?? "—"} dBm` : "—"}
          </p>
        </aside>
      </section>

      <section className="beacon-section" aria-labelledby="beacon-heading">
        <div className="section-heading">
          <div>
            <p className="section-index">02 / CAMPAIGN MAP</p>
            <h2 id="beacon-heading">Four signals. Four stories.</h2>
          </div>
          <p>Bring a beacon close, or tap any card to preview its exact pop-up.</p>
        </div>

        <div className="beacon-grid">
          {OFFERS.map((offer, index) => {
            const sighting = sightings[offer.id];
            const recentlySeen = Boolean(sighting && clock - sighting.seenAt < 10_000);
            return (
              <button
                className={`beacon-tile tile-${offer.id} ${recentlySeen ? "is-detected" : ""}`}
                key={offer.id}
                onClick={() => simulateOffer(offer)}
                aria-label={`Preview ${offer.brand} beacon offer`}
              >
                <div className="tile-top">
                  <span className="tile-index">0{index + 1}</span>
                  <span className="tile-state"><i />{recentlySeen ? "Detected" : "Preview"}</span>
                </div>
                <div className="tile-brand">{offer.brand}</div>
                <p>{offer.headline}</p>
                <div className="tile-footer">
                  <span>MINOR {String(offer.minor).padStart(2, "0")}</span>
                  <span>{sighting ? signalLabel(sighting.parsed.rssi) : timeAgo(undefined, clock)}</span>
                </div>
                <div className="tile-time">{timeAgo(sighting?.seenAt, clock)}</div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="how-section" id="how-it-works" aria-labelledby="how-heading">
        <div className="how-copy">
          <p className="section-index">03 / SIGNAL PATH</p>
          <h2 id="how-heading">From air packet<br />to offer in three beats.</h2>
          <p>
            No connection is made for campaign detection. The page listens for public
            manufacturer data, validates the campaign identity, then maps the minor value
            to local content. GATT read/notify remains available to diagnostic apps.
          </p>
          <div className="privacy-pill">Designed as a foreground, consent-led demo</div>
        </div>
        <ol className="signal-steps">
          <li><span>1</span><div><h3>Broadcast</h3><p>Each ESP32 repeats the iBeacon frame and answers active scans as SoDBeacon.</p></div></li>
          <li><span>2</span><div><h3>Recognize</h3><p>UUID <code>F0E1…1E0F</code>, major <code>100</code>, minor <code>1–4</code>.</p></div></li>
          <li><span>3</span><div><h3>Reveal</h3><p>A nearby RSSI opens the matched offer with a 20-second frequency cap.</p></div></li>
        </ol>
      </section>

      <footer>
        <p>Beacon Shelf / reference build</p>
        <p>Educational prototype. Brand names are used only as demo labels; no affiliation implied.</p>
      </footer>

      {currentOffer && (
        <OfferModal
          offer={currentOffer}
          onClose={() => setCurrentOffer(null)}
          onAccept={() => {
            setCurrentOffer(null);
            setToast(`${currentOffer.brand} demo acknowledged — nothing was stored.`);
          }}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
