import type { Vendor } from "../db/repositories/devices.js";
import type { VendorAdapter } from "./types.js";
import { err } from "../core/errors.js";
import { OnvifAdapter } from "./onvif.js";
import { HikvisionIsapiAdapter } from "./hikvision-isapi.js";
import { DahuaCgiAdapter } from "./dahua-cgi.js";
import { UniviewTvtAdapter } from "./uniview-tvt.js";
import { HanwhaSunapiAdapter } from "./hanwha-sunapi.js";
import { AxisVapixAdapter } from "./axis-vapix.js";

/**
 * Adapter registry — single source of truth for "which vendor => which
 * implementation". Vendors not registered yet throw at lookup time
 * (better than silently returning an unknown stub).
 *
 * The map is mutable (not frozen) so tests can swap implementations.
 * In production nothing else writes to it.
 */

let factories: Record<Vendor, () => VendorAdapter> = {
  onvif: () => new OnvifAdapter(),
  hikvision: () => new HikvisionIsapiAdapter(),
  dahua: () => new DahuaCgiAdapter(),
  uniview: () => new UniviewTvtAdapter(),
  hanwha: () => new HanwhaSunapiAdapter(),
  axis: () => new AxisVapixAdapter(),
  tvt: () => new UniviewTvtAdapter(),
};

/** Resolve a vendor to its adapter. Throws if unregistered. */
export function adapterFor(vendor: Vendor): VendorAdapter {
  const factory = factories[vendor];
  if (!factory) throw err.internal(new Error(`No adapter registered for vendor: ${vendor}`));
  return factory();
}

/** Test seam: replace the registry (used by tests to inject fakes). */
export function _setAdapters(map: Partial<Record<Vendor, () => VendorAdapter>>): void {
  factories = { ...factories, ...map };
}
