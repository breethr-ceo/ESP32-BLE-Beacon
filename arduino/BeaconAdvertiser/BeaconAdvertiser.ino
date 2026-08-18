/*
  Beacon Shelf: four-profile ESP32 iBeacon + GATT peripheral

  Compatible targets:
    - ESP32 DevKit / ESP32 Dev Module
    - ESP32-WROOM-32 based development boards

  Flash this sketch to four boards. Change BEACON_PROFILE to 1, 2, 3, and 4
  before each upload. The web app maps the resulting minor values to offers.

  Primary advertisement — iBeacon manufacturer payload (25 bytes):
    Apple ID | type | length | UUID (16) | major (2) | minor (2) | Tx power
      4C 00  |  02  |   15   |    ...    |   00 64   |  00 01    |   C5

  Scan response:
    Complete local name: SoDBeacon
    Complete service UUID: 8E7A0001-4C3B-2D1E-0F10-F0E1D2C3B4A5

  The browser campaign path reads advertisements only and never needs to
  connect. A separate GATT client such as nRF Connect may connect, read the
  status characteristic, and subscribe to notifications.
*/

#include <Arduino.h>
#include <BLEAdvertising.h>
#include <BLE2902.h>
#include <BLEBeacon.h>
#include <BLECharacteristic.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEService.h>

// 1 = Coca-Cola, 2 = Maggi, 3 = Zepto, 4 = Apple
#define BEACON_PROFILE 1

#if BEACON_PROFILE < 1 || BEACON_PROFILE > 4
#error "BEACON_PROFILE must be an integer from 1 through 4"
#endif

namespace {

constexpr char kDeviceName[] = "SoDBeacon";
constexpr char kGattServiceUuid[] = "8E7A0001-4C3B-2D1E-0F10-F0E1D2C3B4A5";
constexpr char kGattStatusCharacteristicUuid[] = "8E7A0002-4C3B-2D1E-0F10-F0E1D2C3B4A5";

// Stored in the exact byte order required inside the iBeacon frame.
uint8_t kCampaignUuid[16] = {
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
constexpr uint32_t kNotificationIntervalMs = 2000;

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
BLECharacteristic* gStatusCharacteristic = nullptr;
const BeaconProfile* gActiveProfile = nullptr;
volatile bool gDeviceConnected = false;
bool gWasConnected = false;
uint16_t gNotificationSequence = 0;
uint32_t gLastNotificationAt = 0;

class ServerCallbacks final : public BLEServerCallbacks {
  void onConnect(BLEServer*) override {
    gDeviceConnected = true;
    Serial.println("GATT client connected.");
  }

  void onDisconnect(BLEServer*) override {
    gDeviceConnected = false;
    Serial.println("GATT client disconnected.");
  }
};

String buildManufacturerData(const BeaconProfile& profile) {
  BLEBeacon beacon;
  // BLEBeacon performs the endian conversions used by Espressif's example.
  beacon.setManufacturerId(0x4C00);
  beacon.setProximityUUID(BLEUUID(kCampaignUuid, sizeof(kCampaignUuid), false));
  beacon.setMajor(kMajor);
  beacon.setMinor(profile.minor);
  beacon.setSignalPower(kCalibratedTxPowerAtOneMetre);
  return beacon.getData();
}

void setGattStatusValue(uint16_t sequence, bool notify) {
  if (!gStatusCharacteristic || !gActiveProfile) return;

  // Kept below the default 20-byte notification payload limit.
  char value[20] = {};
  const int length = snprintf(value, sizeof(value), "P%u|M%u|m%u|N%04u",
                              BEACON_PROFILE, kMajor, gActiveProfile->minor,
                              sequence % 10000);
  gStatusCharacteristic->setValue(reinterpret_cast<uint8_t*>(value), length);
  if (notify) {
    gStatusCharacteristic->notify();
    Serial.printf("GATT notify: %s\n", value);
  }
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
  gActiveProfile = &profile;
  Serial.println();
  Serial.println("Beacon Shelf / ESP32 iBeacon");
  Serial.printf("Profile: %d (%s)\n", BEACON_PROFILE, profile.brand);
  Serial.printf("UUID: F0E1D2C3-B4A5-9687-7869-5A4B3C2D1E0F\n");
  Serial.printf("Major: %u  Minor: %u  Calibrated Tx: %d dBm\n",
                kMajor, profile.minor, kCalibratedTxPowerAtOneMetre);

  BLEDevice::init(kDeviceName);
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService* service = server->createService(kGattServiceUuid);
  gStatusCharacteristic = service->createCharacteristic(
    kGattStatusCharacteristicUuid,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  // CCCD lets GATT clients enable or disable notifications.
  gStatusCharacteristic->addDescriptor(new BLE2902());
  setGattStatusValue(0, false);
  service->start();

  gAdvertising = server->getAdvertising();
  gAdvertising->stop();
  gAdvertising->setScanResponse(true);
  gAdvertising->setMinInterval(kMinAdvertisingInterval);
  gAdvertising->setMaxInterval(kMaxAdvertisingInterval);

  BLEAdvertisementData advertisementData;
  advertisementData.setFlags(0x06);  // General discoverable; BR/EDR not supported.
  const String manufacturerData = buildManufacturerData(profile);
  advertisementData.setManufacturerData(manufacturerData);

  BLEAdvertisementData scanResponseData;
  scanResponseData.setName(kDeviceName);
  scanResponseData.setCompleteServices(BLEUUID(kGattServiceUuid));

  if (!gAdvertising->setAdvertisementData(advertisementData)) {
    Serial.println("ERROR: Could not set the BLE advertising payload.");
    return;
  }

  if (!gAdvertising->setScanResponseData(scanResponseData)) {
    Serial.println("ERROR: Could not set the BLE scan-response payload.");
    return;
  }

  if (!gAdvertising->start()) {
    Serial.println("ERROR: BLE advertising did not start.");
    return;
  }

  printFrame(manufacturerData);
  Serial.printf("Scan-response name: %s\n", kDeviceName);
  Serial.printf("GATT service: %s\n", kGattServiceUuid);
  Serial.printf("Read/notify characteristic: %s\n", kGattStatusCharacteristicUuid);
  Serial.println("Advertising continuously. Campaign detection requires no connection.");
}

void loop() {
  const uint32_t now = millis();

  if (gDeviceConnected && now - gLastNotificationAt >= kNotificationIntervalMs) {
    gLastNotificationAt = now;
    setGattStatusValue(++gNotificationSequence, true);
  }

  if (!gDeviceConnected && gWasConnected) {
    delay(250);  // Allow the BLE stack to finish the disconnect transition.
    if (gAdvertising && gAdvertising->start()) {
      Serial.println("Advertising restarted after GATT disconnect.");
    }
    gWasConnected = false;
  } else if (gDeviceConnected && !gWasConnected) {
    gWasConnected = true;
  }

  delay(20);
}
