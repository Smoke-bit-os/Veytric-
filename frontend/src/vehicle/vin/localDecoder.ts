// Offline local VIN decoder — used when the online decoder (backend/NHTSA) is
// unavailable, so the app still identifies the vehicle without connectivity.

import { isChecksumValid, isValidVinFormat } from "./validator";

const WMI: Record<string, [string, string]> = {
  "1C4": ["Jeep", "USA"], "1C6": ["Ram", "USA"], "1C3": ["Chrysler", "USA"],
  "3C4": ["Jeep", "Mexico"], "1FA": ["Ford", "USA"], "1FT": ["Ford", "USA"], "1FM": ["Ford", "USA"],
  "1G1": ["Chevrolet", "USA"], "1GC": ["Chevrolet", "USA"], "1GT": ["GMC", "USA"],
  "1HG": ["Honda", "USA"], "2HG": ["Honda", "Canada"], "JHM": ["Honda", "Japan"],
  "4T1": ["Toyota", "USA"], "JTD": ["Toyota", "Japan"],
  "WBA": ["BMW", "Germany"], "WDD": ["Mercedes-Benz", "Germany"], "WVW": ["Volkswagen", "Germany"],
  "WAU": ["Audi", "Germany"], "5YJ": ["Tesla", "USA"], "1N4": ["Nissan", "USA"], "JN1": ["Nissan", "Japan"],
  "KM8": ["Hyundai", "S. Korea"], "KNA": ["Kia", "S. Korea"], "SAL": ["Land Rover", "UK"],
};

const YEAR_CHARS = "ABCDEFGHJKLMNPRSTVWXY123456789";

export interface LocalDecodeResult {
  make: string;
  country: string;
  year: number;
  plant: string;
  validFormat: boolean;
  checksumValid: boolean;
}

export function localDecodeVin(vin: string): LocalDecodeResult {
  vin = (vin || "").toUpperCase();
  const validFormat = isValidVinFormat(vin);
  const [make, country] = WMI[vin.slice(0, 3)] || ["Unknown", "Unknown"];
  const yearIdx = validFormat ? YEAR_CHARS.indexOf(vin[9]) : -1;
  const year = yearIdx >= 0 ? 2010 + yearIdx : 0;
  return {
    make,
    country,
    year,
    plant: validFormat ? `Plant code ${vin[10]}` : "",
    validFormat,
    checksumValid: isChecksumValid(vin),
  };
}
