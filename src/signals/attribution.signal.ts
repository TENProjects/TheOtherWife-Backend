/** @format */

import { appSignalDispatcher } from "../dispatcher/app-signal.dispatcher.js";
import { attributionService } from "../services/attribution.service.js";

// Listens to the EXISTING vendor.approved signal (emitted by
// VendorService.approveVendor for both admin approval routes) and stamps the
// first approval on the vendor's attribution, if it has one. Read-only with
// respect to the vendor lifecycle: nothing here changes approval behaviour,
// and SignalDispatcher swallows handler errors, so a failure here can never
// fail an approval.
appSignalDispatcher.on("vendor.approved", async (payload) => {
  await attributionService.recordVendorApproval(payload.vendorId);
});
