# RevenueCat — integrated (2026-09)
Memory for interacting with the user's RevenueCat account via integration proxy later.

## Identifiers (from /setup response — verbatim)
- rc_project_id: proj8cbdbf37
- apple_app_id: app709410d4b1
- play_app_id: appace533624e
- entitlement_lookup_key: pro
- offering_lookup_key: default
- Packages (package -> product_id, current price):
  - $rc_monthly -> prod4af79d54bf   ($9.99 / P1M, trial: none)
  - $rc_annual  -> prod42b0e7bd65   ($79.99 / P1Y, trial: none)
- Dashboard: https://app.revenuecat.com/projects/proj8cbdbf37

## Status check
AUTH='Authorization: Bearer <emergent key, from prompt — never store>'
curl -sS -H "$AUTH" "$INTEGRATION_PROXY_URL/internal/revenuecat/projects/f5581161-08ed-4709-b23f-ced7c8800ffc/status"
→ connection_state=connected, project_state=connected. If project_state < project_created, re-fetch the playbook via integration expert.

## Updates (integration proxy ONLY — NEVER call RevenueCat REST API)
- Change price/duration/trial OR add package (upsert):
  POST $INTEGRATION_PROXY_URL/internal/revenuecat/projects/f5581161-08ed-4709-b23f-ced7c8800ffc/products
  body: {"products":[{"package":"$rc_monthly","price":14.99,"currency":"USD","period":"P1M","trial":"P1W","prices":[{"amount_micros":14990000,"currency":"USD"}]}]}
- Remove package: DELETE .../products/%24rc_monthly  ($ -> %24)
- Recover identifiers / repopulate .env: re-run idempotent /setup.

## Go LIVE (user manual, store-side — agent cannot do)
Test Store (Expo Go/web/dev build) needs none of this. For real purchases in store builds:
1. Upload App Store Connect API key (.p8) + Google Play service-account JSON to RevenueCat dashboard.
2. Set up payment profiles in App Store Connect + Play Console.
3. Create matching IAP products using the SAME product IDs shown in the RevenueCat dashboard.
4. Release build → test via TestFlight / Play internal testing → submit for review.
All steps also in the payments panel FAQ.

## App code
- src/revenuecat.tsx: SubscriptionProvider + useSubscription (entitlement source of truth = customerInfo.entitlements.active["pro"]). rcEnabled = native || __DEV__.
- app/_layout.tsx: initializeRevenueCat() at module scope + QueryClientProvider + SubscriptionProvider + Purchases.logIn/logOut bound to auth user id.
- .env: EXPO_PUBLIC_REVENUECAT_{TEST,IOS,ANDROID}_API_KEY (real keys).
- Pro gating is CLIENT-SIDE ONLY. No backend is_pro / webhooks / server limits.
