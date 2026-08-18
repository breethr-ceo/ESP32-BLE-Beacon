export const BLUETOOTH_PERMISSION_TIMEOUT_MS = 20_000;

export class BluetoothPermissionTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Bluetooth permission did not complete within ${Math.round(timeoutMs / 1000)} seconds`);
    this.name = "BluetoothPermissionTimeoutError";
  }
}

export function waitForBluetoothScan<T>(
  scanRequest: Promise<T>,
  timeoutMs = BLUETOOTH_PERMISSION_TIMEOUT_MS,
  onLateResult?: (result: T) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      reject(new BluetoothPermissionTimeoutError(timeoutMs));
    }, timeoutMs);

    scanRequest.then(
      (result) => {
        if (settled) {
          onLateResult?.(result);
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(result);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
