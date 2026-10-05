import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImage, parseTag, compileTagPatterns, releaseToBranch, releaseSortKey, prNumberFromMessage, parseCodeowners, ownersFor, ownerSlug, districtOf, jvmRootDepth } from '../src/model.js';
import { DEFAULTS } from '../src/config.js';

const res = compileTagPatterns(DEFAULTS.images.tagPatterns);
const tpl = DEFAULTS.images.releaseBranchTemplate;
const U = '58b8b7af-5c85-4ba1-b4be-78cf55a86db4';

test('parseImage splits registry, name and tag', () => {
  assert.deepEqual(parseImage(`acmeprod.azurecr.io/team/payments-api:dev-latest${U}`), { registry: 'acmeprod.azurecr.io', repository: 'team/payments-api', name: 'payments-api', tag: `dev-latest${U}`, digest: null });
  assert.equal(parseImage('nginx').tag, null);
  assert.equal(parseImage('localhost:5000/x:1').registry, 'localhost:5000');
  assert.equal(parseImage('r.io/x@sha256:abc').digest, 'sha256:abc');
});

test('master build tag: dev-latest<uuid>', () => {
  assert.deepEqual(parseTag(`dev-latest${U}`, res, tpl), { sha: null, uuid: U, release: null, releaseBranch: null });
  assert.equal(parseTag(`dev-latest-${U}`, res, tpl).uuid, U);
});

test('release build tag maps to its release branch', () => {
  const t = parseTag(`dev-latest${U}-release-26-10-05-REL`, res, tpl);
  assert.equal(t.uuid, U);
  assert.equal(t.release, '26-10-05');
  assert.equal(t.releaseBranch, 'release/26.10.05.REL');
});

test('a 40-char sha tag (future GitHub Actions builds) resolves directly', () => {
  const sha = 'efb5c4a78a529aaa60163cd838e8d3f9fd933f82';
  assert.equal(parseTag(`dev-latest-${sha}`, res, tpl).sha, sha);
  assert.equal(parseTag(sha, res, tpl).sha, sha);
  assert.equal(parseTag('latest', res, tpl), null);
});

test('release branch naming and sorting', () => {
  assert.equal(releaseToBranch('26-10-05', tpl), 'release/26.10.05.REL');
  const re = new RegExp(DEFAULTS.github.releaseBranchPattern);
  assert.ok(re.test('release/26.10.05.REL'));
  assert.ok(!re.test('release/26.10.05'));
  assert.ok(releaseSortKey('release/26.10.05.REL', re) > releaseSortKey('release/26.09.28.REL', re));
  assert.ok(releaseSortKey('release/27.01.02.REL', re) > releaseSortKey('release/26.12.30.REL', re));
});

test('PR numbers from merge and squash messages', () => {
  assert.equal(prNumberFromMessage('Merge pull request #1482 from acme/feature/x'), 1482);
  assert.equal(prNumberFromMessage('Partial refunds (#1482)\n\nbody'), 1482);
  assert.equal(prNumberFromMessage('Fix typo'), null);
});

test('CODEOWNERS: last matching rule wins', () => {
  const rules = parseCodeowners('# comment\n* @acme/payments\n/src/main/resources/db/ @acme/dba\n*.yml @acme/platform\ndocs/** @acme/docs\n');
  assert.deepEqual(ownersFor(rules, 'src/main/java/A.java'), ['@acme/payments']);
  assert.deepEqual(ownersFor(rules, 'src/main/resources/db/migration/V1.sql'), ['@acme/dba']);
  assert.deepEqual(ownersFor(rules, 'src/main/resources/application.yml'), ['@acme/platform']);
  assert.deepEqual(ownersFor(rules, 'docs/a/b.md'), ['@acme/docs']);
  assert.equal(ownerSlug('@acme/payments'), 'payments');
  assert.equal(ownersFor(parseCodeowners(''), 'x'), null);
});

test('districts collapse JVM package roots', () => {
  const files = ['src/main/java/com/acme/payments/Application.java', 'src/main/java/com/acme/payments/service/PaymentService.java', 'src/main/java/com/acme/payments/api/RefundController.java', 'src/test/java/com/acme/payments/PaymentServiceTest.java'];
  const ctx = { jvmRootDepth: jvmRootDepth(files) };
  assert.equal(ctx.jvmRootDepth, 3);
  assert.equal(districtOf(files[0], ctx), 'root');
  assert.equal(districtOf(files[1], ctx), 'service');
  assert.equal(districtOf(files[2], ctx), 'api');
  assert.equal(districtOf(files[3], ctx), 'test');
  assert.equal(districtOf('src/main/resources/application.yml', ctx), 'resources');
  assert.equal(districtOf('internal/stock/reserve.go', {}), 'internal/stock');
  assert.equal(districtOf('pom.xml', {}), 'root');
});
