import fs from 'node:fs';

const POLA = [
  'publication-number', 'notice-type', 'title-proc', 'buyer-name', 'classification-cpv',
  'publication-date', 'winner-name', 'tender-value', 'tender-value-cur',
  'result-value-notice', 'result-lot-identifier', 'buyer-country-sub',
  'modification-reason-description', 'modification-previous-notice-identifier',
  'change-reason-code', 'contract-identifier',
];

const r = await fetch('https://api.ted.europa.eu/v3/notices/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: '(place-of-performance IN (POL)) AND (publication-date >= 20260901) AND (form-type = cont-modif) SORT BY publication-date DESC',
    fields: POLA,
    page: 1,
    limit: 3,
  }),
});
const tekst = await r.text();
console.log('status', r.status);
if (r.status !== 200) { console.log(tekst.slice(0, 1200)); process.exit(0); }
const j = JSON.parse(tekst);
console.log('total', j.totalNoticeCount);
const wybrane = j.notices.map((x) => {
  const { links, ...reszta } = x;
  return { ...reszta, links: { html: { POL: links?.html?.POL ?? null } } };
});
fs.writeFileSync('test/fixtures/ted-modyfikacje.json', JSON.stringify(wybrane, null, 1));
console.log(JSON.stringify(wybrane, null, 1).slice(0, 2500));
