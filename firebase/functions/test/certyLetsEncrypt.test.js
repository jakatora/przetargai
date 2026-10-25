import { test } from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { ROOT_YR_CROSS_PEM } from '../src/lib/certyLetsEncrypt.js';
import { CA_EPP, fetchHttps } from '../src/services/eProPublico.js';

test('Root YR jest cross-podpisany przez ISRG Root X1 z magazynu Node i ważny jeszcze ponad rok', () => {
  const yr = new X509Certificate(ROOT_YR_CROSS_PEM);
  assert.match(yr.subject, /CN=Root YR/);
  assert.match(yr.issuer, /CN=ISRG Root X1/);
  const x1 = tls.rootCertificates.map((p) => new X509Certificate(p)).find((c) => /CN=ISRG Root X1/.test(c.subject));
  assert.ok(x1, 'ISRG Root X1 w magazynie Node');
  assert.equal(yr.checkIssued(x1), true, 'podpis ISRG Root X1 zgadza się');
  assert.ok(new Date(yr.validTo) > new Date(Date.now() + 365 * 86_400_000), 'ważny > 1 rok — inaczej odnowić w lib/certyLetsEncrypt.js');
  assert.equal(CA_EPP.length, tls.rootCertificates.length + 1);
  assert.equal(typeof fetchHttps, 'function');
});
