// Sample decoded VIN profiles for demo / Simulation mode. Lets the demo mirror
// the real BLE identification workflow without hardware. Standalone data — not
// wired into any transport (BLE/Simulation transports are left untouched).

import { VehicleIdentity } from "../types";

export const SIM_VIN_PROFILES: Record<string, Partial<VehicleIdentity>> = {
  "1C4HJXEG9JW174532": {
    vin: "1C4HJXEG9JW174532",
    year: 2018,
    make: "Jeep",
    model: "Wrangler",
    trim: "Unlimited Sahara",
    engine: "3.6L V6",
    transmission: "8-Speed Automatic",
    driveType: "4WD",
    plant: "Toledo, OH",
    country: "USA",
    confidence: 0.95,
    decodeSource: "simulation",
  },
  "1FTFW1E80MFA12345": {
    vin: "1FTFW1E80MFA12345",
    year: 2021,
    make: "Ford",
    model: "F-150",
    trim: "Lariat",
    engine: "3.5L EcoBoost V6",
    transmission: "10-Speed Automatic",
    driveType: "4WD",
    plant: "Dearborn, MI",
    country: "USA",
    confidence: 0.95,
    decodeSource: "simulation",
  },
  "5YJ3E1EA7KF317000": {
    vin: "5YJ3E1EA7KF317000",
    year: 2019,
    make: "Tesla",
    model: "Model 3",
    trim: "Standard Range Plus",
    engine: "Electric RWD",
    transmission: "Single-Speed",
    driveType: "RWD",
    plant: "Fremont, CA",
    country: "USA",
    confidence: 0.95,
    decodeSource: "simulation",
  },
};
