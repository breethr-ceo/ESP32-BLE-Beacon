# Beacon Shelf — ESP32 iBeacon offer demo

This repository is a small, end-to-end reference for proximity-triggered web content:

- one Arduino sketch, flashed with four profiles, advertises valid iBeacon frames, responds to scans as `SoDBeacon`, and exposes an optional read/notify GATT characteristic;
- one browser page listens for those frames and maps each beacon to a Coca-Cola, Maggi, Zepto, or Apple sample offer;
- the page includes manual preview buttons so the interface can be demonstrated without BLE hardware.

The offers and brand names are illustrative only. This project is not affiliated with or endorsed by any of the brands shown.

## Important browser reality

This is a foreground prototype, not a background advertising system. A normal web page cannot silently scan around a person, open itself, or show a pop-up after the tab is closed. The user must open the page, click **Choose SoDBeacon**, grant permission, and keep the page active. The “pop-up” in this project is an accessible in-page dialog, not a new browser window.

BLE advertisement scanning uses the experimental `navigator.bluetooth.requestLEScan()` API. The Web Bluetooth Community Group currently lists advertisement scanning as available behind Chrome’s experimental web-platform flag on **macOS and Android**, and not implemented for **Windows**. Chrome/Edge on Windows can run and preview the site, but cannot directly receive these broadcast-only iBeacon frames. Safari and Firefox do not implement Web Bluetooth.

For a production system or reliable Windows support, use a native mobile/desktop scanner or a local BLE-to-web bridge. The web parser and campaign mapping in this repository can be reused with such a bridge.

References: [Web Bluetooth scanning draft](https://webbluetoothcg.github.io/web-bluetooth/scanning.html), [implementation status](https://github.com/WebBluetoothCG/web-bluetooth/blob/main/implementation-status.md), and [Espressif Arduino BLE documentation](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/ble.html).

## Repository layout

```text
arduino/BeaconAdvertiser/BeaconAdvertiser.ino  ESP32 advertiser sketch
app/page.tsx                                   scanner and offer interface
lib/beacons.ts                                 iBeacon parser and campaign map
app/globals.css                                responsive visual design
```

## Campaign identifiers

All four beacons use one UUID and major value. The iBeacon minor identifies the offer.

| Profile | Offer | UUID | Major | Minor |
|---:|---|---|---:|---:|
| 1 | Coca-Cola | `F0E1D2C3-B4A5-9687-7869-5A4B3C2D1E0F` | 100 | 1 |
| 2 | Maggi | same | 100 | 2 |
| 3 | Zepto | same | 100 | 3 |
| 4 | Apple | same | 100 | 4 |

The 25-byte manufacturer data for profile 1 is:

```text
4C 00 02 15 F0 E1 D2 C3 B4 A5 96 87 78 69 5A 4B 3C 2D 1E 0F 00 64 00 01 C5
```

`4C 00` is Apple’s Bluetooth company identifier in on-air byte order, `02 15` is the iBeacon type/length marker, `00 64` is major 100, `00 01` is minor 1, and `C5` is the signed calibrated transmit-power byte (-59 dBm). Profiles 2–4 change the minor bytes to `00 02`, `00 03`, and `00 04`.

The sketch also adds the three-byte BLE flags field, producing a 30-byte legacy advertisement. That primary packet intentionally omits the local name because legacy advertising data is limited to 31 bytes.

The name and GATT service UUID are placed in the separate scan-response packet, so the full iBeacon manufacturer frame remains unchanged.

## BLE discovery and optional GATT

Every board uses the same discovery name and GATT UUIDs:

| Field | Value |
|---|---|
| Scan-response name | `SoDBeacon` |
| GATT service | `8E7A0001-4C3B-2D1E-0F10-F0E1D2C3B4A5` |
| Read/notify characteristic | `8E7A0002-4C3B-2D1E-0F10-F0E1D2C3B4A5` |

The characteristic contains a compact ASCII status value such as `P1|M100|m1|N0000`: profile, major, minor, and notification sequence. A connected GATT client can read it and subscribe to a notification every two seconds.

GATT is optional and is not used for campaign pop-ups. The default scanner receives the public iBeacon manufacturer data directly. The chooser fallback calls `requestDevice()` only to let the user authorize a named `SoDBeacon`, then calls `watchAdvertisements()`; it never calls `device.gatt.connect()` or subscribes to the characteristic.

## Hardware

- four ESP32 DevKit or ESP32-WROOM-32 development boards with BLE;
- four data-capable USB cables;
- a Mac with BLE for the direct browser experiment, or any Windows/Mac machine for the site and manual offer previews;
- optionally, the nRF Connect mobile app for independently checking packets.

## Flash the four ESP32 boards

These steps are the same on Windows and macOS.

1. Install [Arduino IDE 2](https://www.arduino.cc/en/software).
2. Open **Arduino IDE → Settings** and add this Board Manager URL:

   ```text
   https://espressif.github.io/arduino-esp32/package_esp32_index.json
   ```

3. Open **Boards Manager**, search for **esp32**, and install **esp32 by Espressif Systems** (3.x).
4. Open `arduino/BeaconAdvertiser/BeaconAdvertiser.ino`.
5. At the top of the sketch, set `BEACON_PROFILE` to `1`.
6. Select **Tools → Board → esp32 → ESP32 Dev Module**. This target works for common ESP32 DevKit V1 and ESP32-WROOM-32 boards.
7. Select the board’s serial port and upload. If upload waits at “Connecting…”, hold **BOOT**, start the upload, and release **BOOT** when writing begins.
8. Open Serial Monitor at **115200 baud**. Confirm the profile, UUID, major/minor, manufacturer data, `SoDBeacon` scan-response name, GATT UUIDs, and “Advertising continuously” message.
9. Repeat for the other boards with `BEACON_PROFILE` values `2`, `3`, and `4`.

No third-party Arduino library is required; `BLEBeacon`, the GATT server classes, and the advertising classes are bundled with Espressif’s Arduino core.

### Verify with nRF Connect

1. Start a BLE scan in nRF Connect and look for `SoDBeacon`.
2. The raw advertisement should contain manufacturer company ID `0x004C` and iBeacon bytes beginning `02 15`.
3. Connecting is optional. If you connect, open service `8E7A0001…B4A5`.
4. Read characteristic `8E7A0002…B4A5`, then enable notifications to receive the compact status value every two seconds.
5. Disconnect when finished; the sketch restarts advertising automatically.

### Serial-port notes

- **Windows:** if no COM port appears, install the driver used by the board’s USB bridge (commonly CP210x or CH340), then reconnect the board.
- **macOS:** approve a newly installed USB driver in Privacy & Security if macOS asks, then reconnect the board. Many recent boards work without a separate driver.

## Run the web page locally

The web project requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open the exact local address printed in the terminal, normally [http://localhost:3000](http://localhost:3000). `localhost` is treated as a secure context for development. Any remotely hosted build must use HTTPS.

To make a production build:

```bash
npm run build
```

### macOS: enable direct advertisement scanning

1. Install current Google Chrome.
2. Open `chrome://flags/#enable-experimental-web-platform-features`.
3. Set **Experimental Web Platform features** to **Enabled**, then relaunch Chrome.
4. In **System Settings → Privacy & Security → Bluetooth**, allow Chrome if it is listed.
5. Open the page on `localhost` or HTTPS and click **Choose SoDBeacon**.
6. Accept Chrome’s Bluetooth scan prompt.
7. Bring one flashed ESP32 close. At RSSI `-86 dBm` or stronger, the mapped offer dialog appears.

Use the site in the normal Google Chrome application, not an embedded preview or in-app browser. Embedded browsers can display the page and may even show a permission prompt, but they do not provide a reliable BLE advertisement-scanning session. The direct scan now requests only advertisements named `SoDBeacon`, rather than every nearby BLE advertisement.

Use **Choose SoDBeacon** as the recommended route. Chrome opens its standard Bluetooth chooser and intentionally shows all connectable BLE peripherals because macOS Chrome may not match a name located only in a scan-response packet. Select the entry named `SoDBeacon`; the page watches that device's advertisements without connecting to its GATT server. Repeat **Add another** once for each remaining board. **Stop** cancels both chooser-authorized watchers and direct scans.

**Direct scan** retains the experimental name-filtered `requestLEScan()` route for comparison. Its permission dialog is not a general device browser and it may deliver no events even when Bluetooth Internals sees the ESP32.

Chrome flags are experimental and may change or disappear. If the page says advertisement scanning is unavailable, use the four preview cards and check the current implementation-status link above.

### Windows: run and preview

1. Install Node.js 22.13+ and current Chrome or Edge.
2. Run `npm install` and `npm run dev` in PowerShell, Command Prompt, or a terminal.
3. Open the local URL.
4. Click any of the four campaign cards to test its pop-up.

Direct iBeacon advertisement scanning is not currently available to a Windows web page. Enabling a Chromium flag does not add the missing platform implementation. For hardware verification on Windows, use a native BLE scanner such as nRF Connect, or add a native/local bridge in front of the included parser.

## Runtime behavior

1. **Choose SoDBeacon** opens Chrome's standard unfiltered BLE chooser, grants one selected device at a time, and starts `watchAdvertisements()`. **Direct scan** retains the experimental name-filtered foreground scanner for comparison.
2. Neither route establishes a GATT connection. Received advertisements are processed locally and uploaded nowhere.
3. `lib/beacons.ts` selects manufacturer data for company ID `0x004C`, then validates the iBeacon `02 15` prefix, UUID, and major value.
4. Minor `1–4` selects the matching offer.
5. The page records RSSI and opens the offer only at `-86 dBm` or stronger.
6. The same offer has a 20-second pop-up cooldown to avoid rapid repetition.
7. Stopping the scan or leaving the page stops listening.

RSSI-based distance is only an estimate. Walls, shelving, people, antenna orientation, power supply quality, and radio interference can move readings substantially. Calibrate `kCalibratedTxPowerAtOneMetre` in the sketch and `MINIMUM_RSSI` in `app/page.tsx` for the actual installation.

## Troubleshooting

### The Serial Monitor prints the right frame, but the page sees nothing

- One startup block ending in “Advertising continuously” is the expected serial output. The BLE stack advertises in the background; the sketch does not print once per packet.
- Opening Serial Monitor can reset some ESP32 boards and print the startup block a second time. A continuously repeating block indicates resets and should be investigated as a power or USB-cable issue.
- Verify the page is on HTTPS or `localhost`.
- Open it in the normal Google Chrome application, not an embedded preview or in-app browser.
- Confirm Bluetooth is on and Chrome has OS-level Bluetooth permission.
- Confirm `requestLEScan` support with `"requestLEScan" in navigator.bluetooth` in Chrome DevTools.
- Prefer **Choose SoDBeacon**, select the entry named `SoDBeacon`, and repeat **Add another** for the remaining boards. This permission route still reads advertisements and does not connect to GATT.
- On macOS/Android, enable the experimental web-platform flag and relaunch Chrome.
- Keep the scanner tab visible. Chromium may stop advertisement delivery when its page is hidden; choose the beacon again after returning if needed.
- Watch the scanner counters: **All ads = 0** means Chrome/OS is not delivering advertisements; **SoD name > 0** confirms the scan-response name arrived; **All ads > 0, Apple = 0** means BLE works but no Apple manufacturer frame is arriving; **Apple > 0, iBeacon = 0** means the payload is not parsing as iBeacon; **iBeacon > 0, Matched = 0** means UUID, major, or minor differs from the campaign map.
- Open `chrome://bluetooth-internals` in Chrome to check whether Chromium itself can see nearby BLE devices. If it sees none, the problem is below the web page (Chrome, macOS permission, adapter, or radio state).
- Test the ESP32 packet with a native BLE scanner before debugging the page.
- Move the ESP32 within one or two metres and keep the page in the foreground.
- Disconnect nRF Connect or another GATT client before browser testing. A normal single-connection ESP32 stops advertising while that client is connected and resumes after disconnection.

### The wrong offer appears

Check that each board was uploaded after changing `BEACON_PROFILE`. The Serial Monitor must show a different minor for every board.

### The offer repeats too often or not often enough

Change `POPUP_COOLDOWN_MS` or `MINIMUM_RSSI` in `app/page.tsx`. Higher RSSI values such as `-70` require the beacon to be closer; lower values such as `-90` accept weaker, more distant signals.

### Upload fails

Try a known data-capable cable, select the correct port, disconnect other serial monitors, and use the BOOT-button sequence described above.

## Privacy and production safety

- BLE advertisements are public and unencrypted. Anyone nearby can read or copy these identifiers.
- Do not use UUID/major/minor as authentication, proof of presence, or authorization for payments.
- Obtain explicit user consent before scanning, explain why Bluetooth is needed, and provide a visible stop control.
- The direct scanner requests only advertisements whose scan-response name is `SoDBeacon`; the chooser fallback watches only devices explicitly selected by the user. Do not retain or upload advertisement data.
- Apply frequency caps and avoid surprise dialogs. The included 20-second cap is only for a short demo; real campaigns should be much less intrusive.
- Keep offer rules on a trusted backend if discounts have monetary value, and validate redemption server-side.
- Follow local privacy, advertising, trademark, and electronic-communications requirements before any real deployment.

## License

The code is provided as an educational reference. Replace the sample brand content with assets and offers you are authorized to use before deployment.
