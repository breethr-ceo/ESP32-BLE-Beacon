"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  APPLE_COMPANY_ID,
  BEACON_MAJOR,
  BEACON_UUID_BYTES,
  BEACON_UUID_DISPLAY,
  OFFERS,
  type BeaconOffer,
  type ParsedIBeacon,
  findOffer,
  parseIBeacon,
} from "../lib/beacons";

type ScanState = "idle" | "requesting" | "scanning" | "error";
type Capability = "checking" | "ready" | "insecure" | "unsupported" | "unavailable";

interface BluetoothLEScan {
  active: boolean;
  stop: () => void;
}

interface BluetoothAdvertisementEvent extends Event {
  manufacturerData: Map<number, DataView>;
  rssi?: number;
}

interface BluetoothScanner {
  requestLEScan?: (options: {
    filters: Array<{
      manufacturerData: Record<number, { dataPrefix: Uint8Array }>;
    }>;
    keepRepeatedDevices: boolean;
  }) => Promise<BluetoothLEScan>;
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

const MINIMUM_RSSI = -86;
const POPUP_COOLDOWN_MS = 20_000;

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
  const [clock, setClock] = useState(0);
  const [toast, setToast] = useState("");
  const scanRef = useRef<BluetoothLEScan | null>(null);
  const lastPopupRef = useRef<Record<string, number>>({});

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
    const appleData = advertisement.manufacturerData?.get(APPLE_COMPANY_ID);
    if (!appleData) return;

    const parsed = parseIBeacon(appleData, advertisement.rssi);
    if (!parsed) return;

    const offer = findOffer(parsed);
    if (!offer) return;

    const seenAt = Date.now();
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

  const startScan = async () => {
    const bluetooth = getBluetooth();
    if (!bluetooth?.requestLEScan) {
      setCapability(bluetooth ? "unavailable" : "unsupported");
      return;
    }

    setScanState("requesting");
    setStatusMessage("Waiting for Bluetooth permission…");
    try {
      scanRef.current = await bluetooth.requestLEScan({
        filters: [
          {
            manufacturerData: {
              [APPLE_COMPANY_ID]: {
                dataPrefix: new Uint8Array([
                  0x02,
                  0x15,
                  ...BEACON_UUID_BYTES,
                ]),
              },
            },
          },
        ],
        keepRepeatedDevices: true,
      });
      setScanState("scanning");
      setStatusMessage("Listening for four campaign beacons");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setScanState("error");
      setStatusMessage(message || "The Bluetooth scan could not start");
    }
  };

  const stopScan = () => {
    scanRef.current?.stop();
    scanRef.current = null;
    setScanState("idle");
    setStatusMessage("Scan stopped");
  };

  const capabilityMessage = useMemo(() => {
    if (capability === "checking") return "Checking browser capability…";
    if (capability === "insecure") return "Use HTTPS or localhost to unlock Bluetooth.";
    if (capability === "unsupported") return "This browser does not expose Web Bluetooth.";
    if (capability === "unavailable") {
      return "BLE advertisement scanning is unavailable. Use the demo buttons or see the setup guide.";
    }
    return statusMessage;
  }, [capability, statusMessage]);

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

  return (
    <main className="site-shell">
      <header className="topbar">
        <a className="logo" href="#top" aria-label="Beacon Shelf home">
          <span className="logo-signal" aria-hidden="true"><i /><i /><i /></span>
          Beacon Shelf
        </a>
        <div className="topbar-note">ESP32 × iBeacon × Web Bluetooth</div>
        <a className="guide-link" href="#how-it-works">How it works <span>↓</span></a>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow"><span /> Live proximity prototype</div>
          <h1>Walk in.<br /><em>Offers wake up.</em></h1>
          <p className="hero-lede">
            A four-beacon retail demo. ESP32 transmitters announce tiny iBeacon frames;
            this page turns a nearby signal into the right branded moment.
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

          <div className={`scanner-message scanner-${capability}`}>
            <span>{isScanning ? "LIVE" : capability === "ready" ? "READY" : "NOTE"}</span>
            <p>{capabilityMessage}</p>
          </div>

          <div className="scanner-actions">
            <button className="primary-button" onClick={startScan} disabled={startDisabled}>
              {scanState === "requesting" ? "Requesting…" : isScanning ? "Scanning…" : "Start scanner"}
            </button>
            <button className="stop-button" onClick={stopScan} disabled={!isScanning}>
              Stop
            </button>
          </div>
          <p className="privacy-note">Foreground only · nothing is uploaded · RSSI trigger ≥ {MINIMUM_RSSI} dBm</p>
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
            No connection is made to a beacon. The page listens for public manufacturer data,
            validates the campaign identity, then maps the minor value to local content.
          </p>
          <div className="privacy-pill">Designed as a foreground, consent-led demo</div>
        </div>
        <ol className="signal-steps">
          <li><span>1</span><div><h3>Broadcast</h3><p>Each ESP32 repeats a 30-byte legacy BLE advertisement.</p></div></li>
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
