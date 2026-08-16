// On-device ML Kit OCR engine wrapper. Text recognition runs LOCALLY on the
// device — no image or VIN text is ever uploaded. Availability is gated so the
// web preview / Expo Go NEVER pretend to scan (the native module is absent
// there); those environments fall back to the manual Add Vehicle flow.

import { Platform } from "react-native";
import Constants from "expo-constants";

let TextRecognition: any = null;
try {
  // Native-only module; require is wrapped so web/Expo Go don't crash on import.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  TextRecognition = require("@react-native-ml-kit/text-recognition").default;
} catch {
  TextRecognition = null;
}

/**
 * True only in a real native/dev build (not web, not Expo Go) where the ML Kit
 * native module is embedded. Used to decide whether the camera scanner is real.
 */
export function isNativeScanSupported(): boolean {
  return Platform.OS !== "web" && Constants.appOwnership !== "expo" && !!TextRecognition;
}

/** Run on-device OCR against a local image URI and return the raw recognized text. */
export async function recognizeText(imageUri: string): Promise<string> {
  if (!TextRecognition) throw new Error("OCR_UNAVAILABLE");
  const result = await TextRecognition.recognize(imageUri);
  return result?.text || "";
}
