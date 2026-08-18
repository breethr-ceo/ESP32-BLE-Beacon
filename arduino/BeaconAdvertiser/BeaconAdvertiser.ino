/*
  Beacon Shelf: four-profile ESP32 iBeacon advertiser

  Compatible targets:
    - ESP32 DevKit / ESP32 Dev Module
    - ESP32-WROOM-32 based development boards

  Flash this sketch to four boards. Change BEACON_PROFILE to 1, 2, 3, and 4
  before each upload. The web app maps the resulting minor values to offers.

  iBeacon manufacturer payload (25 bytes):
    Apple ID | type | length | UUID (16) | major (2) | minor (2) | Tx power
      4C 00  |  02  |   15   |    ...    |   00 64   |  00 01    |   C5

  This is an educational prototype. iBeacon identifiers are public and can be
  copied, so never use them as proof of identity or for a security decision.
*/

#include <Arduino.h>
#include <BLEAdvertising.h>
#include <BLEDevice.h>
#include <BLEServer.h>

// 1 = Coca-Cola, 2 = Maggi, 3 = Zepto, 4 = Apple
#define BEACON_PROFILE 1

#if BEACON_PROFILE < 1 || BEACON_PROFILE > 4
#error "BEACON_PROFILE must be an integer from 1 through 4"
#endif

namespace {

constexpr uint8_t kCampaignUuid[16] = {
  0xF0, 0xE1, 0xD2, 0xC3,
  0xB4, 0xA5,
  0x96, 0x87,
  0x78, 0x69,
  0x5A, 0x4B, 0x3C, 0x2D, 0x1E, 0x0F
};

constexpr uint16_t kMajor = 100;
constexpr int8_t kCalibratedTxPowerAtOneMetre = -59;  // 0xC5
constexpr uint16_t kMinAdvertisingInterval = 160;      // 100 ms in 0.625 ms units
constexpr uint16_t kMaxAdvertisingInterval = 240;      // 150 ms in 0.625 ms units

struct BeaconProfile {
  const char* brand;
  uint16_t minor;
};

constexpr BeaconProfile kProfiles[] = {
  {"Coca-Cola", 1},
  {"Maggi", 2},
  {"Zepto", 3},
  {"Apple", 4},
};

BLEAdvertising* gAdvertising = nullptr;

String buildManufacturerData(const BeaconProfile& profile) {
  uint8_t frame[25] = {};
  size_t cursor = 0;

  // Bluetooth SIG company identifier 0x004C is little-endian on air.
  frame[cursor++] = 0x4C;
  frame[cursor++] = 0x00;
  frame[cursor++] = 0x02;  // iBeacon type
  frame[cursor++] = 0x15;  // 21 bytes follow

  memcpy(frame + cursor, kCampaignUuid, sizeof(kCampaignUuid));
  cursor += sizeof(kCampaignUuid);

  // iBeacon major and minor fields are network byte order (big-endian).
  frame[cursor++] = static_cast<uint8_t>(kMajor >> 8);
  frame[cursor++] = static_cast<uint8_t>(kMajor & 0xFF);
  frame[cursor++] = static_cast<uint8_t>(profile.minor >> 8);
  frame[cursor++] = static_cast<uint8_t>(profile.minor & 0xFF);
  frame[cursor++] = static_cast<uint8_t>(kCalibratedTxPowerAtOneMetre);

  return String(reinterpret_cast<const char*>(frame), sizeof(frame));
}

void printFrame(const String& manufacturerData) {
  Serial.print("Manufacturer data: ");
  for (size_t index = 0; index < manufacturerData.length(); ++index) {
    const uint8_t value = static_cast<uint8_t>(manufacturerData[index]);
    if (value < 0x10) Serial.print('0');
    Serial.print(value, HEX);
    if (index + 1 < manufacturerData.length()) Serial.print(' ');
  }
  Serial.println();
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(500);

  const BeaconProfile& profile = kProfiles[BEACON_PROFILE - 1];
  Serial.println();
  Serial.println("Beacon Shelf / ESP32 iBeacon");
  Serial.printf("Profile: %d (%s)\n", BEACON_PROFILE, profile.brand);
  Serial.printf("UUID: F0E1D2C3-B4A5-9687-7869-5A4B3C2D1E0F\n");
  Serial.printf("Major: %u  Minor: %u  Calibrated Tx: %d dBm\n",
                kMajor, profile.minor, kCalibratedTxPowerAtOneMetre);

  BLEDevice::init("");
  BLEServer* server = BLEDevice::createServer();
  gAdvertising = server->getAdvertising();
  gAdvertising->stop();
  gAdvertising->setScanResponse(false);
  gAdvertising->setMinInterval(kMinAdvertisingInterval);
  gAdvertising->setMaxInterval(kMaxAdvertisingInterval);

  BLEAdvertisementData advertisementData;
  advertisementData.setFlags(0x06);  // General discoverable; BR/EDR not supported.
  const String manufacturerData = buildManufacturerData(profile);
  advertisementData.setManufacturerData(manufacturerData);

  if (!gAdvertising->setAdvertisementData(advertisementData)) {
    Serial.println("ERROR: Could not set the BLE advertising payload.");
    return;
  }

  if (!gAdvertising->start()) {
    Serial.println("ERROR: BLE advertising did not start.");
    return;
  }

  printFrame(manufacturerData);
  Serial.println("Advertising continuously. No BLE connection is required.");
}

void loop() {
  // Advertising is handled by the ESP32 BLE stack in the background.
  delay(1000);
}
