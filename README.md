# Beacon Shelf — ESP32 iBeacon offer demo

This repository is a small, end-to-end reference for proximity-triggered web content:

- one Arduino sketch, flashed with four profiles, continuously advertises valid iBeacon manufacturer frames;
- one browser page listens for those frames and maps each beacon to a Coca-Cola, Maggi, Zepto, or Apple sample offer;
- the page includes manual preview buttons so the interface can be demonstrated without BLE hardware.

The offers and brand names are illustrative only. This project is not affiliated with or endorsed by any of the brands shown.

## Important browser reality

This is a foreground prototype, not a background advertising system. A normal web page cannot silently scan around a person, open itself, or show a pop-up after the tab is closed. The user must open the page, click **Start scanner**, grant permission, and keep the page active. The “pop-up” in this project is an accessible in-page dialog, not a new browser window.

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

The sketch also adds the three-byte BLE flags field, producing a 30-byte legacy advertisement. It intentionally omits a local device name because legacy advertising data is limited to 31 bytes.

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
8. Open Serial Monitor at **115200 baud**. Confirm the profile, UUID, major/minor, hex manufacturer data, and “Advertising continuously” message.
9. Repeat for the other boards with `BEACON_PROFILE` values `2`, `3`, and `4`.

No third-party Arduino library is required; the sketch uses the BLE library bundled with Espressif’s Arduino core.

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
5. Open the page on `localhost` or HTTPS and click **Start scanner**.
6. Accept Chrome’s Bluetooth scan prompt.
7. Bring one flashed ESP32 close. At RSSI `-86 dBm` or stronger, the mapped offer dialog appears.

Chrome flags are experimental and may change or disappear. If the page says advertisement scanning is unavailable, use the four preview cards and check the current implementation-status link above.

### Windows: run and preview

1. Install Node.js 22.13+ and current Chrome or Edge.
2. Run `npm install` and `npm run dev` in PowerShell, Command Prompt, or a terminal.
3. Open the local URL.
4. Click any of the four campaign cards to test its pop-up.

Direct iBeacon advertisement scanning is not currently available to a Windows web page. Enabling a Chromium flag does not add the missing platform implementation. For hardware verification on Windows, use a native BLE scanner such as nRF Connect, or add a native/local bridge in front of the included parser.

## Runtime behavior

1. The page requests a filtered BLE scan after a click.
2. The browser exposes manufacturer data for company ID `0x004C`.
3. `lib/beacons.ts` validates the iBeacon `02 15` prefix, UUID, and major value.
4. Minor `1–4` selects the matching offer.
5. The page records RSSI and opens the offer only at `-86 dBm` or stronger.
6. The same offer has a 20-second pop-up cooldown to avoid rapid repetition.
7. Stopping the scan or leaving the page stops listening.

RSSI-based distance is only an estimate. Walls, shelving, people, antenna orientation, power supply quality, and radio interference can move readings substantially. Calibrate `kCalibratedTxPowerAtOneMetre` in the sketch and `MINIMUM_RSSI` in `app/page.tsx` for the actual installation.

## Troubleshooting

### The Serial Monitor prints the right frame, but the page sees nothing

- Verify the page is on HTTPS or `localhost`.
- Confirm Bluetooth is on and Chrome has OS-level Bluetooth permission.
- Confirm `requestLEScan` support with `"requestLEScan" in navigator.bluetooth` in Chrome DevTools.
- On macOS/Android, enable the experimental web-platform flag and relaunch Chrome.
- Test the ESP32 packet with a native BLE scanner before debugging the page.
- Move the ESP32 within one or two metres and keep the page in the foreground.

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
- Apply frequency caps and avoid surprise dialogs. The included 20-second cap is only for a short demo; real campaigns should be much less intrusive.
- Keep offer rules on a trusted backend if discounts have monetary value, and validate redemption server-side.
- Follow local privacy, advertising, trademark, and electronic-communications requirements before any real deployment.

## License

The code is provided as an educational reference. Replace the sample brand content with assets and offers you are authorized to use before deployment.
