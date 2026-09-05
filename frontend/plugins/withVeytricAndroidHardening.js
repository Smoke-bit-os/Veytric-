// VEYTRIC — Android release manifest hardening (Expo config plugin).
// Runs at prebuild so it survives regeneration (no manual /android edits).
// This is the stable fix for merged-manifest items that come from transitive
// dependencies (Compose tooling, RevenueCat Amazon IAP).
//
// It:
//   1) Removes (or, fallback, marks non-exported) androidx.compose.ui.tooling.PreviewActivity.
//   2) Removes RevenueCat/Amazon IAP components (this release targets Google Play).
//   3) Belt-and-suspenders: allowBackup=false, usesCleartextTraffic=false.
const { withAndroidManifest, AndroidConfig } = require("@expo/config-plugins");

const PREVIEW_ACTIVITY = "androidx.compose.ui.tooling.PreviewActivity";
const AMAZON_COMPONENTS = [
  "com.amazon.device.iap.ResponseReceiver",
  "com.revenuecat.purchases.amazon.purchasing.ProxyAmazonBillingActivity",
];

function nameOf(node) {
  return node?.$?.["android:name"];
}

module.exports = function withVeytricAndroidHardening(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);

    // 1) Compose tooling PreviewActivity — remove; if a dep re-adds it, force non-exported.
    if (Array.isArray(app.activity)) {
      app.activity = app.activity.filter((a) => nameOf(a) !== PREVIEW_ACTIVITY);
    }
    const forceNotExported = (arr) => {
      (arr || []).forEach((n) => {
        if (nameOf(n) === PREVIEW_ACTIVITY) n.$["android:exported"] = "false";
      });
    };
    forceNotExported(app.activity);

    // 2) Remove Amazon billing components (Google Play build).
    const strip = (arr) => (Array.isArray(arr) ? arr.filter((n) => !AMAZON_COMPONENTS.includes(nameOf(n))) : arr);
    app.activity = strip(app.activity);
    app.receiver = strip(app.receiver);
    app.service = strip(app.service);

    // 3) Security posture (also set in app.json; enforced here against merges).
    app.$["android:allowBackup"] = "false";
    app.$["android:usesCleartextTraffic"] = "false";

    return cfg;
  });
};
