'use strict';
/* ================================================================
   Utilities
   ================================================================ */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const seeded = mulberry32(20261004);
const rnd = (a, b, r = Math.random) => a + (b - a) * r();
const rint = (a, b, r = Math.random) => Math.floor(rnd(a, b + 1, r));
const pick = (arr, r = Math.random) => arr[Math.floor(r() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sum = arr => arr.reduce((s, v) => s + v, 0);
const shuffle = (arr, r = Math.random) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const usedShas = new Set();
function newSha(r = Math.random) { let s; do { s = ''; for (let i = 0; i < 7; i++) s += '0123456789abcdef'[Math.floor(r() * 16)]; } while (usedShas.has(s)); usedShas.add(s); return s; }
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DAY = 1440;

/* ================================================================
   People & teams (all fictional)
   ================================================================ */
const PEOPLE = {
  pr: 'Priya Raman', ml: 'Marcus Lee', sa: 'Sofia Alvarez', dp: 'Dev Patel', hk: 'Hannah Kim', to: 'Tomás Ortega',
  jb: 'Jordan Blake', ab: 'Aisha Bello', wz: 'Wei Zhang', lf: 'Lena Fischer', oh: 'Omar Haddad', gl: 'Grace Liu',
  nb: 'Noah Brooks', mt: 'Mei Tanaka', rk: 'Ravi Kumar', ej: 'Elena Jovanović'
};
const PERSON_HUE = {};
Object.keys(PEOPLE).forEach((k, i) => { PERSON_HUE[k] = Math.round((i * 137.5 + 200) % 360); });
let LIVE = false;                                   // true when fed by the collector (live.js)
let ENV_ORDER = ['staging', 'prod'], ENV_PRE = 'staging', ENV_PROD = 'prod';
const personName = id => PEOPLE[id] || String(id || 'unknown').replace(/^team:/, 'team ');
const firstName = id => PEOPLE[id] ? PEOPLE[id].split(' ')[0] : personName(id);
function personHue(id) { if (PERSON_HUE[id] != null) return PERSON_HUE[id]; let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
function initials(id) {
  if (PEOPLE[id] && id.length <= 3) return id.toUpperCase();
  const parts = personName(id).replace(/^team /, '').split(/[\s._-]+/).filter(Boolean);
  return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : (parts[0] || '')[1] || '')).toUpperCase();
}
const avatar = (id, lg) => `<span class="av${lg ? ' lg' : ''}" style="--h:${personHue(id)}" title="${esc(personName(id))}">${esc(initials(id))}</span>`;
const teamName = t => TEAMS[t] ? TEAMS[t].name : (t || 'Unassigned');
const ciName = r => r.ci === 'jenkins' ? 'Jenkins' : LIVE ? 'GitHub Actions' : 'New CI';
const verLabel = v => LIVE ? v : 'v' + v;

const TEAMS = {
  payments: { name: 'Payments', c: ['#5877e0', '#7f99f2'] },
  storefront: { name: 'Storefront', c: ['#d46f98', '#ec8fb5'] },
  fulfillment: { name: 'Fulfillment', c: ['#3f9c70', '#5cc792'] },
  identity: { name: 'Identity', c: ['#9566d4', '#b58cee'] },
  platform: { name: 'Platform', c: ['#cf9233', '#ecb357'] },
  data: { name: 'Data', c: ['#3797b8', '#55bfe0'] },
  mobile: { name: 'Mobile', c: ['#c45f45', '#e58468'] }
};

/* ================================================================
   Repository definitions
   districts: [path, ownerTeam|null, files[]]
   branches:  seeds with real-looking work in flight
   ================================================================ */
const REPO_DEFS = [
  {
    id: 'payments-api', lang: 'Java · Spring Boot', team: 'payments', ci: 'jenkins', version: '1.42.0', prefix: 'PAY', pos: [0, -32],
    people: ['pr', 'ml', 'sa', 'nb', 'rk'], nextPr: 1490, nextBuild: 4513, deps: { 'shared-lib-java': '2.14.1' },
    districts: [
      ['api', 'payments', ['PaymentController.java', 'RefundController.java', 'WebhookController.java', 'PayoutController.java', 'ApiExceptionHandler.java']],
      ['service', 'payments', ['PaymentService.java', 'RefundService.java', 'LedgerService.java', 'FraudCheckService.java', 'IdempotencyService.java', 'PayoutScheduler.java']],
      ['gateway', 'payments', ['StripeGatewayClient.java', 'AdyenGatewayClient.java', 'GatewayRouter.java', 'ThreeDSecureHandler.java', 'RetryPolicy.java']],
      ['repository', 'payments', ['PaymentRepository.java', 'RefundRepository.java', 'LedgerEntryRepository.java', 'PayoutRepository.java']],
      ['model', 'payments', ['Payment.java', 'Refund.java', 'LedgerEntry.java', 'Money.java', 'PaymentStatus.java']],
      ['events', 'payments', ['PaymentEventPublisher.java', 'PaymentCapturedEvent.java', 'RefundIssuedEvent.java', 'OutboxRelay.java']],
      ['config', 'platform', ['SecurityConfig.java', 'KafkaConfig.java', 'application.yml', 'FeatureFlags.java', 'pom.xml']],
      ['db/migration', null, ['V38__ledger_index.sql', 'V39__payout_batches.sql', 'V40__idempotency_keys.sql', 'V41__refund_reason.sql']],
      ['test', 'payments', ['PaymentServiceTest.java', 'RefundFlowIT.java', 'GatewayContractTest.java', 'LedgerReconciliationIT.java', 'WebhookReplayIT.java']]
    ],
    hot: { 'service/PaymentService.java': [1180, 41, .93], 'service/RefundService.java': [760, 33, .82], 'gateway/GatewayRouter.java': [540, 24, .74], 'api/WebhookController.java': [480, 19, .66], 'service/LedgerService.java': [690, 17, .7] },
    branches: [
      { name: 'feature/PAY-1421-partial-refunds', author: 'pr', ahead: 7, behind: 3, last: 6, add: 412, del: 58,
        files: ['service/RefundService.java', 'api/RefundController.java', 'model/Refund.java', 'repository/RefundRepository.java', 'service/PaymentService.java', 'db/migration/V41__refund_reason.sql', 'test/RefundFlowIT.java'],
        msgs: ['Allow refunds below captured amount', 'Persist refund reason', 'Add partial refund flow test'],
        pr: { n: 1482, title: 'Partial refunds for captured payments', state: 'in_review', reviewers: [['ml', 'approved'], ['sa', 'pending']], waited: 300, opened: 1500, ci: 'passing' } },
      { name: 'fix/PAY-1433-idempotency-keys', author: 'sa', ahead: 3, behind: 1, last: 22, add: 96, del: 21,
        files: ['service/IdempotencyService.java', 'service/PaymentService.java', 'service/RefundService.java', 'db/migration/V40__idempotency_keys.sql', 'test/PaymentServiceTest.java'],
        msgs: ['Reject replayed idempotency keys', 'Scope keys per merchant'],
        pr: { n: 1486, title: 'Enforce idempotency keys on capture and refund', state: 'review_requested', reviewers: [['pr', 'pending'], ['nb', 'pending']], waited: 1560, opened: 1600, ci: 'running' } },
      { name: 'fix/PAY-1447-webhook-retry', author: 'pr', ahead: 4, behind: 6, last: 95, add: 140, del: 62,
        files: ['api/WebhookController.java', 'gateway/RetryPolicy.java', 'events/OutboxRelay.java', 'events/PaymentEventPublisher.java'],
        msgs: ['Retry webhook delivery with backoff', 'Move retry config to RetryPolicy'],
        pr: { n: 1484, title: 'Retry failed webhook deliveries from the outbox', state: 'changes_requested', reviewers: [['sa', 'changes'], ['ml', 'pending']], waited: 2900, opened: 3100, ci: 'passing' } },
      { name: 'chore/bump-spring-boot-3.3.4', author: 'nb', ahead: 1, behind: 0, last: 50, add: 6, del: 6,
        files: ['config/pom.xml', 'config/SecurityConfig.java'], msgs: ['Bump Spring Boot to 3.3.4'],
        pr: { n: 1488, title: 'Bump Spring Boot to 3.3.4', state: 'approved', reviewers: [['ml', 'approved'], ['pr', 'approved']], waited: 140, opened: 180, ci: 'passing' } },
      { name: 'feature/PAY-1452-payout-batching', author: 'nb', ahead: 4, behind: 2, last: 64, add: 233, del: 12,
        files: ['service/PayoutScheduler.java', 'repository/PayoutRepository.java', 'api/PayoutController.java', 'db/migration/V39__payout_batches.sql'],
        msgs: ['Group payouts into daily batches'],
        pr: { n: 1489, title: 'Batch merchant payouts daily', state: 'draft', reviewers: [], waited: 0, opened: 70, ci: 'passing' } },
      { name: 'spike/PAY-1440-adyen-3ds2', author: 'ml', ahead: 11, behind: 64, last: 190, add: 690, del: 140,
        files: ['gateway/AdyenGatewayClient.java', 'gateway/ThreeDSecureHandler.java', 'gateway/GatewayRouter.java', 'test/GatewayContractTest.java'],
        msgs: ['Try Adyen native 3DS2 flow'] },
      { name: 'feature/PAY-1290-multi-currency', author: 'ml', ahead: 23, behind: 212, last: 41 * DAY, add: 1840, del: 420,
        files: ['model/Money.java', 'service/LedgerService.java', 'model/Payment.java', 'service/PaymentService.java', 'model/LedgerEntry.java'] },
      { name: 'release/2026.10', author: 'rk', ahead: 0, behind: 5, last: 2 * DAY, add: 0, del: 0, kind: 'release', files: [] }
    ],
    staged: [
      { pr: 1471, title: 'Add ledger reconciliation report', author: 'pr', files: ['service/LedgerService.java', 'repository/LedgerEntryRepository.java', 'test/LedgerReconciliationIT.java'], ago: 265 },
      { pr: 1475, title: 'Expose refund status in webhook payload', author: 'sa', files: ['api/WebhookController.java', 'events/RefundIssuedEvent.java'], ago: 140 },
      { pr: 1479, title: 'Route EUR cards through Adyen by default', author: 'ml', files: ['gateway/GatewayRouter.java', 'config/FeatureFlags.java', 'test/GatewayContractTest.java'], ago: 18, select: true }
    ],
    msgs: ['Handle partially captured payments', 'Guard against duplicate webhook delivery', 'Extract refund validation', 'Tighten ledger rounding to HALF_EVEN', 'Log gateway latency per route', 'Add missing index on ledger_entry', 'Retry outbox publish with backoff'],
    topics: [['fix', 'ledger-rounding', 'service'], ['feature', 'refund-webhooks', 'events'], ['fix', 'gateway-timeouts', 'gateway'], ['feature', 'payout-holds', 'service'], ['chore', 'flyway-cleanup', 'db/migration'], ['fix', 'chargeback-status', 'model']]
  },
  {
    id: 'checkout-web', lang: 'TypeScript · Next.js', team: 'storefront', ci: 'newci', version: '3.18.2', prefix: 'SHOP', pos: [32, 32],
    people: ['dp', 'hk', 'mt', 'ej'], nextPr: 617, nextBuild: 8813, deps: { 'ui-kit': '4.1.3' },
    districts: [
      ['app/checkout', 'storefront', ['page.tsx', 'CheckoutForm.tsx', 'ShippingStep.tsx', 'PaymentStep.tsx', 'ReviewStep.tsx', 'layout.tsx']],
      ['app/cart', 'storefront', ['page.tsx', 'CartDrawer.tsx', 'CartLineItem.tsx', 'useCart.ts']],
      ['components', 'storefront', ['PriceTag.tsx', 'AddressAutocomplete.tsx', 'PromoCodeInput.tsx', 'Stepper.tsx', 'ErrorBanner.tsx']],
      ['lib/api', 'storefront', ['paymentsClient.ts', 'inventoryClient.ts', 'authSession.ts', 'fetcher.ts']],
      ['lib/analytics', 'data', ['track.ts', 'events.ts', 'consent.ts']],
      ['styles', 'storefront', ['tokens.css', 'checkout.module.css', 'package.json']],
      ['e2e', 'storefront', ['checkout.spec.ts', 'promo.spec.ts', 'guestCheckout.spec.ts']],
      ['i18n', null, ['en.json', 'de.json', 'fr.json', 'es.json']]
    ],
    hot: { 'app/checkout/CheckoutForm.tsx': [820, 36, .86], 'app/checkout/PaymentStep.tsx': [560, 24, .72], 'components/PromoCodeInput.tsx': [300, 18, .6] },
    branches: [
      { name: 'feature/SHOP-881-apple-pay', author: 'dp', ahead: 6, behind: 2, last: 12, add: 320, del: 44,
        files: ['app/checkout/PaymentStep.tsx', 'lib/api/paymentsClient.ts', 'app/checkout/CheckoutForm.tsx', 'e2e/checkout.spec.ts'],
        pr: { n: 612, title: 'Apple Pay on the payment step', state: 'in_review', reviewers: [['hk', 'approved'], ['ej', 'pending']], waited: 400, opened: 900, ci: 'passing' } },
      { name: 'fix/SHOP-902-promo-rounding', author: 'hk', ahead: 2, behind: 0, last: 30, add: 38, del: 12,
        files: ['components/PromoCodeInput.tsx', 'components/PriceTag.tsx', 'e2e/promo.spec.ts', 'app/checkout/CheckoutForm.tsx'],
        pr: { n: 615, title: 'Fix promo rounding for 3-decimal currencies', state: 'review_requested', reviewers: [['dp', 'pending'], ['mt', 'pending']], waited: 90, opened: 95, ci: 'running' } },
      { name: 'feature/SHOP-874-guest-checkout', author: 'mt', ahead: 9, behind: 14, last: 75, add: 510, del: 90,
        files: ['app/checkout/ShippingStep.tsx', 'lib/api/authSession.ts', 'e2e/guestCheckout.spec.ts', 'app/checkout/CheckoutForm.tsx'] },
      { name: 'chore/upgrade-ui-kit-4.2', author: 'ej', ahead: 1, behind: 1, last: 120, add: 14, del: 14, bump: ['ui-kit', '4.2.0'],
        files: ['styles/package.json', 'styles/tokens.css'],
        pr: { n: 616, title: 'Upgrade ui-kit to 4.2.0', state: 'approved', reviewers: [['dp', 'approved'], ['hk', 'approved']], waited: 100, opened: 125, ci: 'passing' } },
      { name: 'feature/SHOP-760-saved-carts', author: 'dp', ahead: 15, behind: 180, last: 33 * DAY, add: 900, del: 120,
        files: ['app/cart/useCart.ts', 'app/cart/CartDrawer.tsx', 'lib/api/fetcher.ts'] }
    ],
    staged: [
      { pr: 604, title: 'Lazy-load the payment step', author: 'hk', files: ['app/checkout/PaymentStep.tsx', 'app/checkout/page.tsx'], ago: 210 },
      { pr: 609, title: 'Track checkout step timing', author: 'mt', files: ['lib/analytics/events.ts', 'lib/analytics/track.ts'], ago: 80 }
    ],
    msgs: ['Show Apple Pay button on supported devices', 'Persist guest email between steps', 'Add e2e coverage for promo codes', 'Fix focus order in address form', 'Memoize cart totals', 'Handle 409 from inventory'],
    topics: [['fix', 'address-validation', 'components'], ['feature', 'order-notes', 'app/checkout'], ['fix', 'cart-badge', 'app/cart'], ['chore', 'translations', 'i18n'], ['feature', 'consent-banner', 'lib/analytics']]
  },
  {
    id: 'inventory-svc', lang: 'Go', team: 'fulfillment', ci: 'jenkins', version: '2.7.1', prefix: 'INV', pos: [-32, 0],
    people: ['to', 'jb', 'gl'], nextPr: 341, nextBuild: 2291, deps: {},
    districts: [
      ['cmd/server', 'fulfillment', ['main.go', 'flags.go']],
      ['internal/stock', 'fulfillment', ['reserve.go', 'release.go', 'ledger.go', 'reserve_test.go']],
      ['internal/warehouse', 'fulfillment', ['allocator.go', 'zones.go', 'picklist.go', 'allocator_test.go']],
      ['internal/api', 'fulfillment', ['handlers.go', 'middleware.go', 'routes.go']],
      ['internal/store', 'fulfillment', ['postgres.go', 'migrations.go', 'cache.go']],
      ['proto', 'platform', ['inventory.proto', 'inventory.pb.go']],
      ['deploy', null, ['Dockerfile', 'skaffold.yaml']]
    ],
    hot: { 'internal/stock/reserve.go': [610, 29, .81], 'internal/warehouse/allocator.go': [700, 21, .77] },
    branches: [
      { name: 'feature/INV-310-split-shipments', author: 'to', ahead: 5, behind: 1, last: 18, add: 280, del: 40,
        files: ['internal/warehouse/allocator.go', 'internal/warehouse/picklist.go', 'internal/stock/reserve.go', 'internal/warehouse/allocator_test.go'],
        pr: { n: 336, title: 'Split shipments across warehouse zones', state: 'in_review', reviewers: [['jb', 'pending'], ['gl', 'approved']], waited: 220, opened: 600, ci: 'passing' } },
      { name: 'fix/INV-322-reservation-ttl', author: 'jb', ahead: 2, behind: 0, last: 40, add: 64, del: 18,
        files: ['internal/stock/reserve.go', 'internal/stock/release.go', 'internal/store/cache.go'],
        pr: { n: 339, title: 'Expire stale reservations after 15 minutes', state: 'review_requested', reviewers: [['to', 'pending'], ['gl', 'pending']], waited: 35, opened: 40, ci: 'passing' } },
      { name: 'chore/go-1.23', author: 'gl', ahead: 1, behind: 3, last: 260, add: 8, del: 8, files: ['deploy/Dockerfile', 'cmd/server/main.go'] }
    ],
    staged: [{ pr: 333, title: 'Add pick latency metrics', author: 'gl', files: ['internal/api/middleware.go'], ago: 150 }],
    msgs: ['Split allocation across zones', 'Expire reservations after TTL', 'Cache zone lookups', 'Fix race in release()', 'Add metrics for pick latency'],
    topics: [['fix', 'negative-stock', 'internal/stock'], ['feature', 'cycle-counts', 'internal/warehouse'], ['fix', 'grpc-deadlines', 'internal/api']]
  },
  {
    id: 'auth-service', lang: 'Kotlin · Ktor', team: 'identity', ci: 'newci', version: '5.3.0', prefix: 'IAM', pos: [32, -32],
    people: ['ab', 'wz', 'oh'], nextPr: 244, nextBuild: 6120, deps: { 'shared-lib-java': '2.14.1' },
    districts: [
      ['api', 'identity', ['TokenController.kt', 'LoginController.kt', 'MfaController.kt']],
      ['oauth', 'identity', ['AuthorizationServer.kt', 'PkceVerifier.kt', 'ScopePolicy.kt', 'ClientRegistry.kt']],
      ['session', 'identity', ['SessionStore.kt', 'RefreshTokenRotation.kt', 'DeviceBinding.kt']],
      ['crypto', 'identity', ['KeyRotation.kt', 'JwtSigner.kt', 'Jwks.kt']],
      ['config', 'platform', ['SecurityConfig.kt', 'application.yml', 'build.gradle.kts']],
      ['test', 'identity', ['TokenFlowTest.kt', 'PkceVerifierTest.kt', 'MfaIT.kt']]
    ],
    hot: { 'oauth/AuthorizationServer.kt': [880, 26, .88], 'session/RefreshTokenRotation.kt': [420, 19, .7] },
    branches: [
      { name: 'feature/IAM-219-passkeys', author: 'ab', ahead: 8, behind: 4, last: 25, add: 640, del: 70,
        files: ['api/MfaController.kt', 'session/DeviceBinding.kt', 'api/LoginController.kt', 'test/MfaIT.kt'],
        pr: { n: 238, title: 'Passkey registration and sign-in', state: 'in_review', reviewers: [['wz', 'approved'], ['oh', 'pending']], waited: 700, opened: 1300, ci: 'passing' } },
      { name: 'fix/IAM-231-refresh-reuse', author: 'wz', ahead: 2, behind: 0, last: 55, add: 88, del: 20,
        files: ['session/RefreshTokenRotation.kt', 'session/SessionStore.kt', 'test/TokenFlowTest.kt'],
        pr: { n: 241, title: 'Revoke token family on refresh reuse', state: 'approved', reviewers: [['ab', 'approved'], ['oh', 'approved']], waited: 60, opened: 90, ci: 'passing' } },
      { name: 'chore/bump-shared-lib-2.15', author: 'oh', ahead: 1, behind: 0, last: 15, add: 2, del: 2, bump: ['shared-lib-java', '2.15.0'],
        files: ['config/build.gradle.kts'] }
    ],
    staged: [],
    msgs: ['Add WebAuthn registration flow', 'Detect refresh token reuse', 'Rotate JWKS keys daily', 'Bind sessions to device id', 'Add MFA integration test'],
    topics: [['fix', 'pkce-plain', 'oauth'], ['feature', 'session-list', 'session'], ['chore', 'key-rotation-alerts', 'crypto']]
  },
  {
    id: 'shared-lib-java', lang: 'Java library', team: 'platform', ci: 'jenkins', version: '2.15.0', prefix: 'LIB', pos: [0, 0], lib: true,
    people: ['lf', 'oh', 'rk'], nextPr: 95, nextBuild: 1874, deps: {},
    districts: [
      ['logging', 'platform', ['StructuredLogger.java', 'MdcFilter.java']],
      ['http', 'platform', ['RestClientFactory.java', 'RetryInterceptor.java', 'CircuitBreakerConfig.java']],
      ['kafka', 'platform', ['OutboxPublisher.java', 'ConsumerErrorHandler.java']],
      ['security', 'identity', ['JwtAuthFilter.java', 'ServiceAuth.java']],
      ['test-support', 'platform', ['Testcontainers.java', 'FixtureLoader.java']]
    ],
    hot: { 'http/RestClientFactory.java': [520, 15, .7] },
    branches: [
      { name: 'feature/LIB-88-otel-tracing', author: 'lf', ahead: 5, behind: 0, last: 35, add: 260, del: 30,
        files: ['logging/StructuredLogger.java', 'logging/MdcFilter.java', 'http/RestClientFactory.java'],
        pr: { n: 93, title: 'Propagate OpenTelemetry context', state: 'in_review', reviewers: [['oh', 'pending'], ['rk', 'approved']], waited: 400, opened: 500, ci: 'passing' } },
      { name: 'fix/LIB-91-retry-jitter', author: 'rk', ahead: 1, behind: 0, last: 80, add: 20, del: 6, files: ['http/RetryInterceptor.java', 'http/RestClientFactory.java'] }
    ],
    staged: [],
    msgs: ['Propagate trace context through RestClient', 'Add jitter to retry backoff', 'Expose MDC keys as constants'],
    topics: [['fix', 'dlq-headers', 'kafka'], ['feature', 'service-tokens', 'security']]
  },
  {
    id: 'ui-kit', lang: 'TypeScript · React', team: 'storefront', ci: 'newci', version: '4.2.0', prefix: 'UI', pos: [0, 32], lib: true,
    people: ['mt', 'hk', 'ej'], nextPr: 147, nextBuild: 8814, deps: {},
    districts: [
      ['components', 'storefront', ['Button.tsx', 'Input.tsx', 'Modal.tsx', 'Toast.tsx', 'Select.tsx']],
      ['tokens', 'storefront', ['colors.ts', 'spacing.ts', 'typography.ts']],
      ['hooks', 'storefront', ['useFocusTrap.ts', 'useMediaQuery.ts']],
      ['stories', null, ['Button.stories.tsx', 'Modal.stories.tsx']]
    ],
    hot: { 'components/Modal.tsx': [380, 14, .66] },
    branches: [
      { name: 'feature/UI-140-combobox', author: 'mt', ahead: 4, behind: 0, last: 45, add: 410, del: 0,
        files: ['components/Select.tsx', 'hooks/useFocusTrap.ts', 'stories/Button.stories.tsx'],
        pr: { n: 145, title: 'Combobox component', state: 'review_requested', reviewers: [['hk', 'pending'], ['ej', 'pending']], waited: 1700, opened: 1750, ci: 'passing' } },
      { name: 'fix/UI-144-modal-focus', author: 'hk', ahead: 2, behind: 0, last: 20, add: 30, del: 9, files: ['components/Modal.tsx', 'hooks/useFocusTrap.ts'] }
    ],
    staged: [],
    msgs: ['Add Combobox component', 'Trap focus inside Modal', 'Add dark tokens for Toast'],
    topics: [['fix', 'toast-stacking', 'components'], ['feature', 'motion-tokens', 'tokens']]
  },
  {
    id: 'mobile-app', lang: 'React Native', team: 'mobile', ci: 'jenkins', version: '7.9.0', prefix: 'MOB', pos: [-32, 32],
    people: ['ej', 'nb', 'hk'], nextPr: 528, nextBuild: 3302, deps: { 'ui-kit': '4.2.0' },
    districts: [
      ['screens', 'mobile', ['HomeScreen.tsx', 'ProductScreen.tsx', 'CartScreen.tsx', 'CheckoutScreen.tsx', 'OrdersScreen.tsx']],
      ['navigation', 'mobile', ['RootNavigator.tsx', 'linking.ts']],
      ['native/ios', null, ['AppDelegate.mm', 'Podfile']],
      ['native/android', null, ['MainActivity.kt', 'build.gradle']],
      ['state', 'mobile', ['cartSlice.ts', 'sessionSlice.ts', 'store.ts']],
      ['api', 'mobile', ['client.ts', 'endpoints.ts']]
    ],
    hot: { 'screens/CheckoutScreen.tsx': [760, 22, .8] },
    branches: [
      { name: 'feature/MOB-512-push-deeplinks', author: 'ej', ahead: 6, behind: 9, last: 28, add: 300, del: 60,
        files: ['navigation/linking.ts', 'navigation/RootNavigator.tsx', 'native/ios/AppDelegate.mm', 'native/android/MainActivity.kt'],
        pr: { n: 524, title: 'Open push notifications as deep links', state: 'in_review', reviewers: [['nb', 'pending'], ['hk', 'pending']], waited: 2500, opened: 2600, ci: 'failing' } },
      { name: 'chore/MOB-520-rn-0.76', author: 'nb', ahead: 3, behind: 2, last: 140, add: 220, del: 190,
        files: ['native/android/build.gradle', 'native/ios/Podfile', 'native/ios/AppDelegate.mm'] }
    ],
    staged: [
      { pr: 517, title: 'Fix cart badge count', author: 'hk', files: ['state/cartSlice.ts'], ago: 400 },
      { pr: 519, title: 'Edge-to-edge insets on Android 15', author: 'nb', files: ['native/android/MainActivity.kt'], ago: 300 },
      { pr: 521, title: 'Retry order fetch on resume', author: 'ej', files: ['api/client.ts', 'screens/OrdersScreen.tsx'], ago: 100 }
    ],
    msgs: ['Handle push deep links on cold start', 'Fix cart badge count', 'Add Android 15 edge-to-edge insets'],
    topics: [['fix', 'orders-refresh', 'screens'], ['feature', 'biometric-login', 'state']]
  },
  {
    id: 'data-pipeline', lang: 'Python · Airflow', team: 'data', ci: 'jenkins', version: '0.31.4', prefix: 'DATA', pos: [-32, -32],
    people: ['gl', 'rk'], nextPr: 82, nextBuild: 990, deps: {},
    districts: [
      ['dags', 'data', ['orders_daily.py', 'payments_recon.py', 'inventory_snapshot.py']],
      ['transforms', 'data', ['orders.py', 'refunds.py', 'fx_rates.py']],
      ['connectors', 'data', ['kafka_source.py', 's3_sink.py', 'warehouse.py']],
      ['quality', 'data', ['expectations.py', 'freshness.py']],
      ['tests', null, ['test_refunds.py', 'test_fx_rates.py']]
    ],
    hot: { 'transforms/refunds.py': [420, 16, .7] },
    branches: [
      { name: 'feature/DATA-77-refund-reason-dim', author: 'gl', ahead: 3, behind: 1, last: 70, add: 120, del: 8,
        files: ['transforms/refunds.py', 'dags/payments_recon.py', 'tests/test_refunds.py'],
        pr: { n: 80, title: 'Add refund_reason dimension', state: 'draft', reviewers: [], waited: 0, opened: 75, ci: 'passing' } }
    ],
    staged: [{ pr: 78, title: 'Alert on stale orders table', author: 'rk', files: ['quality/freshness.py'], ago: 320 }],
    msgs: ['Add refund_reason dimension', 'Backfill FX rates for Q3', 'Alert on stale orders table'],
    topics: [['fix', 'fx-nulls', 'transforms'], ['feature', 'late-events', 'connectors']]
  },
  {
    id: 'infra-helm', lang: 'Helm · YAML', team: 'platform', ci: 'jenkins', version: '0.58.0', prefix: 'OPS', pos: [32, 0],
    people: ['oh', 'lf'], nextPr: 61, nextBuild: 1411, deps: {},
    districts: [
      ['charts/payments-api', 'payments', ['values.yaml', 'deployment.yaml', 'hpa.yaml']],
      ['charts/checkout-web', 'storefront', ['values.yaml', 'ingress.yaml']],
      ['charts/common', 'platform', ['_helpers.tpl', 'networkpolicy.yaml', 'pdb.yaml']],
      ['environments', 'platform', ['staging.yaml', 'prod.yaml']]
    ],
    hot: { 'environments/prod.yaml': [210, 20, .45] },
    branches: [
      { name: 'chore/OPS-55-pdb-defaults', author: 'oh', ahead: 1, behind: 0, last: 100, add: 12, del: 3, files: ['charts/common/pdb.yaml'],
        pr: { n: 59, title: 'Default PDB minAvailable to 1', state: 'approved', reviewers: [['lf', 'approved'], ['rk', 'approved']], waited: 90, opened: 110, ci: 'passing' } }
    ],
    staged: [
      { pr: 56, title: 'Raise payments-api HPA max to 12', author: 'lf', files: ['charts/payments-api/hpa.yaml'], ago: 500 },
      { pr: 58, title: 'Network policy for auth-service', author: 'oh', files: ['charts/common/networkpolicy.yaml'], ago: 260 }
    ],
    msgs: ['Default PDB minAvailable to 1', 'Raise payments-api HPA max to 12', 'Add network policy for auth-service'],
    topics: [['chore', 'resource-limits', 'charts/common'], ['fix', 'ingress-timeouts', 'charts/checkout-web']]
  }
];
const GENERIC_MSGS = ['Address review comments', 'Add tests for {stem}', 'Refactor {stem}', 'Fix null handling in {stem}', 'Simplify {stem}', 'Rename fields in {stem}', 'Remove dead code from {stem}'];

/* ================================================================
   State
   ================================================================ */
const sim = { now: 9 * 60 + 47, speed: 1, paused: false, nextEventAt: 0 };
const state = {
  repos: [], byId: {}, commits: new Map(), feed: [],
  view: { mode: 'repo', repoId: 'payments-api' },
  layer: 'structure', showConflicts: true, townColor: 'ci', showPipes: true,
  selectedSha: null, focusBranch: null, hoverBranch: null, hoverFile: null,
  k8sLayout: 'deployment', k8sEnv: 'prod', selectedDep: null, hoverPod: null
};
const timers = [];
const after = (min, fn) => timers.push({ at: sim.now + min, fn });

function isStale(b) { return b.kind !== 'release' && sim.now - b.last > 14 * DAY; }
function isActive(b) { return b.kind !== 'release' && !isStale(b); }
function fileStem(id) { const n = id.split('/').pop(); return n.replace(/\.[^.]+$/, ''); }
function fileName(id) { return id.split('/').pop(); }
function ciLabel(repo, id) { if (LIVE && repo.lastBuild && repo.lastBuild.id === id && repo.lastBuild.label) return repo.lastBuild.label; return repo.ci === 'jenkins' ? `Jenkins #${id}` : LIVE ? `Actions run #${id}` : `Pipeline run ${id}`; }
function bumpVersion(v, kind) { const p = v.split('.').map(Number); if (kind === 'major') return `${p[0] + 1}.0.0`; if (kind === 'patch') return `${p[0]}.${p[1]}.${p[2] + 1}`; return `${p[0]}.${p[1] + 1}.0`; }
function cmpVer(a, b) { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; }

function mkCommit(o) {
  const c = Object.assign({ sha: newSha(), t: sim.now, kind: 'push', files: [], build: null, image: null, staging: null, prod: null, prodVersion: null, mergeSha: null }, o);
  state.commits.set(c.sha, c);
  const repo = state.byId[c.repo];
  repo.log.push(c.sha);
  if (repo.log.length > 400) repo.log.shift();
  repo.hourly[repo.hourly.length - 1] += 1;
  return c;
}

function buildRepos() {
  const r = seeded;
  for (const def of REPO_DEFS) {
    const repo = {
      id: def.id, def, lang: def.lang, team: def.team, ci: def.ci, version: def.version, prefix: def.prefix, lib: !!def.lib,
      people: def.people, nextPr: def.nextPr, nextBuild: def.nextBuild, deps: Object.assign({}, def.deps),
      files: [], fileById: {}, districts: [], branches: [], staged: [], log: [], builds: [], lastBuild: null,
      hourly: Array.from({ length: 12 }, (_, i) => Math.max(0, Math.round(rnd(0, 6, r) * (i > 1 && i < 10 ? 1.4 : .6)))),
      seenConflicts: new Set(), lastRelease: sim.now - rint(1, 4, r) * DAY, ticket: 0
    };
    def.districts.forEach(([path, owner, files], di) => {
      const d = { path, owner, files: [], idx: di };
      for (const name of files) {
        const id = `${path}/${name}`;
        const base = def.hot && def.hot[id];
        const loc = base ? base[0] : Math.round(Math.exp(rnd(3.6, 6.2, r)));
        const complexity = base ? base[2] : clamp(Math.log(loc) / 7.5 + rnd(-.18, .12, r), .08, .85);
        const churn = base ? base[1] : Math.round(Math.pow(r(), 2.2) * 14);
        const f = { id, name, district: path, owner, loc, complexity, churn, heat: 0, mesh: null, h: 0 };
        repo.files.push(f); repo.fileById[id] = f; d.files.push(id);
      }
      repo.districts.push(d);
    });
    let maxN = 0;
    for (const b of def.branches) {
      const br = {
        name: b.name, author: b.author, ahead: b.ahead, behind: b.behind, last: sim.now - b.last, add: b.add, del: b.del,
        files: b.files.filter(f => repo.fileById[f]), kind: b.kind || 'branch', bump: b.bump || null, pr: null, created: sim.now - b.last - rint(60, 3000, r)
      };
      const tn = (b.name.match(/-(\d+)-/) || [])[1]; if (tn) maxN = Math.max(maxN, +tn);
      if (b.pr) {
        br.pr = { n: b.pr.n, title: b.pr.title, state: b.pr.state, author: b.author, reviewers: b.pr.reviewers.map(([p, s]) => ({ p, s })),
          requestedAt: sim.now - b.pr.waited, openedAt: sim.now - b.pr.opened, ci: b.pr.ci, branch: b.name };
      }
      // recent commits on this branch, for the feed and traces
      const msgs = b.msgs || [];
      const nCommits = Math.min(br.ahead, 3);
      for (let i = nCommits - 1; i >= 0; i--) {
        const files = br.files.length ? shuffle(br.files, r).slice(0, rint(1, Math.min(3, br.files.length), r)) : [];
        const msg = msgs[i % Math.max(1, msgs.length)] || GENERIC_MSGS[i % GENERIC_MSGS.length].replace('{stem}', files[0] ? fileStem(files[0]) : 'module');
        const c = { sha: newSha(r), repo: repo.id, branch: br.name, msg, author: br.author, files, t: br.last - i * rint(20, 90, r), kind: 'push', pr: br.pr ? br.pr.n : null, build: null, image: null, staging: null, prod: null, mergeSha: null };
        state.commits.set(c.sha, c); repo.log.push(c.sha);
      }
      repo.branches.push(br);
    }
    repo.ticket = maxN;
    let lastBuild = null;
    for (const s of def.staged) {
      const bid = repo.nextBuild - (def.staged.length - def.staged.indexOf(s));
      const sha = newSha(r);
      const c = { sha, repo: repo.id, branch: 'main', msg: s.title, author: s.author, files: s.files, t: sim.now - s.ago, kind: 'merge', pr: s.pr,
        build: { id: bid, status: 'passed', start: sim.now - s.ago + 1, end: sim.now - s.ago + 8 },
        image: `${repo.id}:sha-${sha}`, staging: sim.now - s.ago + 10, prod: null, prodVersion: null, mergeSha: null, approvals: 2 };
      if (s.ago < 10) { c.staging = null; }
      state.commits.set(sha, c); repo.log.push(sha); repo.staged.push(sha);
      lastBuild = { id: bid, status: 'passed', sha, at: c.build.end };
      if (s.select) state.selectedSha = sha;
    }
    // older released history so prod has something
    const relSha = newSha(r);
    state.commits.set(relSha, { sha: relSha, repo: repo.id, branch: 'main', msg: `Release ${repo.version}`, author: repo.people[0], files: [], t: repo.lastRelease, kind: 'merge', pr: null,
      build: { id: repo.nextBuild - 20, status: 'passed', start: repo.lastRelease, end: repo.lastRelease + 6 }, image: `${repo.id}:${repo.version}`, staging: repo.lastRelease + 8, prod: repo.lastRelease + 60, prodVersion: repo.version, mergeSha: null });
    repo.lastBuild = lastBuild || { id: repo.nextBuild - 1, status: 'passed', sha: relSha, at: sim.now - 300 };
    repo.log.sort((a, b) => state.commits.get(a).t - state.commits.get(b).t);
    // seed heat from recent branch work
    for (const b of repo.branches) {
      const age = sim.now - b.last;
      if (age < 240) for (const f of b.files) repo.fileById[f].heat += 1.6 * Math.exp(-age / 70);
    }
    state.repos.push(repo); state.byId[repo.id] = repo;
  }
  // seed conflicts as already seen so boot does not toast
  for (const repo of state.repos) for (const c of collisions(repo)) repo.seenConflicts.add(c.key);
}

/* ================================================================
   Derived values
   ================================================================ */
function collisions(repo) {
  const out = [];
  const bs = repo.branches.filter(b => b.kind !== 'release');
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
    const a = bs[i], b = bs[j];
    const shared = a.files.filter(f => b.files.includes(f));
    if (shared.length) {
      const key = [a.name, b.name].sort().join('|');
      out.push({ a, b, files: shared, stale: isStale(a) || isStale(b), key });
    }
  }
  return out.sort((x, y) => (x.stale - y.stale) || (y.files.length - x.files.length));
}
function openPrs(repo) { return repo.branches.filter(b => b.pr).map(b => b.pr); }
function waitingPrs(repo) { return openPrs(repo).filter(p => p.state === 'review_requested' || p.state === 'in_review'); }
function median(arr) { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function reviewWaits(repos) { const w = []; for (const r of repos) for (const p of waitingPrs(r)) w.push(sim.now - p.requestedAt); return w; }
function commitsSince(repo, min) { let n = 0; for (let i = repo.log.length - 1; i >= 0; i--) { const c = state.commits.get(repo.log[i]); if (sim.now - c.t <= min) n++; else break; } return n; }
function reviewerQueues(repo) {
  const q = {};
  for (const p of waitingPrs(repo)) for (const r of p.reviewers) if (r.s === 'pending') {
    (q[r.p] = q[r.p] || { p: r.p, prs: [], oldest: 0 });
    q[r.p].prs.push(p); q[r.p].oldest = Math.max(q[r.p].oldest, sim.now - p.requestedAt);
  }
  return Object.values(q).sort((a, b) => b.prs.length - a.prs.length || b.oldest - a.oldest);
}
function approvals(pr) { return pr.reviewers.filter(r => r.s === 'approved').length; }
function libConsumers(libId) { return state.repos.filter(r => r.deps[libId]); }
function depAlerts() {
  const out = [];
  for (const lib of state.repos.filter(r => r.lib)) for (const c of libConsumers(lib.id)) {
    const behind = cmpVer(c.deps[lib.id], lib.version) < 0;
    const bumpBranch = c.branches.find(b => b.bump && b.bump[0] === lib.id);
    out.push({ lib, consumer: c, have: c.deps[lib.id], want: lib.version, behind, bumpBranch });
  }
  return out;
}

/* ================================================================
   Formatting
   ================================================================ */
function fmtAge(min) {
  min = Math.max(0, min);
  if (min < 1) return 'just now';
  if (min < 60) return `${Math.round(min)}m`;
  if (min < DAY) return `${Math.floor(min / 60)}h ${Math.round(min % 60) ? Math.round(min % 60) + 'm' : ''}`.trim();
  return `${Math.floor(min / DAY)}d`;
}
function fmtWait(min) { if (min == null) return '—'; if (min < 60) return `${Math.round(min)}m`; if (min < DAY) return `${(min / 60).toFixed(min < 600 ? 1 : 0)}h`; return `${(min / DAY).toFixed(1)}d`; }
function fmtClock(t) { const m = ((Math.floor(t) % DAY) + DAY) % DAY; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
function fmtWhen(t) { const d = sim.now - t; if (d > DAY) return `${Math.floor(d / DAY)}d ago`; return fmtClock(t); }
const PR_STATES = {
  draft: { label: 'Draft', cls: '', lane: 'Arriving' },
  review_requested: { label: 'Review requested', cls: 'accent', lane: 'Docking' },
  in_review: { label: 'In review', cls: 'accent', lane: 'Unloading' },
  changes_requested: { label: 'Changes requested', cls: 'warn', lane: 'Blocked' },
  approved: { label: 'Approved', cls: 'ok', lane: 'Ready to depart' }
};
