// Android runtime Bluetooth permissions for react-native-ble-plx.
//   • Android 12+ (API 31+): BLUETOOTH_SCAN + BLUETOOTH_CONNECT
//   • Android <12: ACCESS_FINE_LOCATION (BLE scan requires location)
// iOS grants are driven by NSBluetoothAlwaysUsageDescription (Info.plist) and
// prompted by the system on first BLE use, so we report "n/a" here.
// Web has no native BLE.
import { Platform } from "react-native";

export type BlePermissionState = "granted" | "denied" | "n/a";

function androidPerms() {
  const { PermissionsAndroid } = require("react-native");
  const sdk = typeof Platform.Version === "number" ? Platform.Version : parseInt(String(Platform.Version), 10);
  const perms: string[] =
    sdk >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  return { PermissionsAndroid, perms };
}

export async function requestBlePermissions(): Promise<BlePermissionState> {
  if (Platform.OS === "web") return "n/a";
  if (Platform.OS !== "android") return "n/a"; // iOS: system-prompted on first use
  try {
    const { PermissionsAndroid, perms } = androidPerms();
    const res = await PermissionsAndroid.requestMultiple(perms);
    const granted = perms.every((p) => res[p] === PermissionsAndroid.RESULTS.GRANTED);
    return granted ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

export async function checkBlePermissions(): Promise<BlePermissionState> {
  if (Platform.OS === "web") return "n/a";
  if (Platform.OS !== "android") return "n/a";
  try {
    const { PermissionsAndroid, perms } = androidPerms();
    for (const p of perms) {
      // Location is required only on <12; on 12+ only SCAN/CONNECT are gating.
      const ok = await PermissionsAndroid.check(p);
      if (!ok && p !== PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION) return "denied";
    }
    return "granted";
  } catch {
    return "denied";
  }
}
