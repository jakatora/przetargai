import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffSwz } from '../src/services/roznicaSwz.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const file = path.join(root, 'landing/data/przyklad-swz-eventy.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const escape = (s) => String(s ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
for (const point of data.punkty) point.diff = diffSwz(point.przed.tekst, point.po.tekst);
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
const quote = (q) => `<blockquote>${escape(q.tekst)}</blockquote><p>${escape(q.zrodlo.nazwa)}, strona ${q.strona}. <a href="${escape(q.zrodlo.url)}#page=${q.strona}" target="_blank" rel="noopener noreferrer">Otwórz dokument źródłowy</a></p>`;
const html = `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Przykład porównania SWZ — branża eventowa | PrzetargAI</title><link rel="stylesheet" href="/styles.css"><style>main{max-width:900px;margin:auto;padding:28px 20px 64px}h1{font-size:28px}h2{margin-top:32px}h3{font-size:16px}p,blockquote,pre{line-height:1.6}blockquote{margin:10px 0;padding:14px;background:var(--paper);color:var(--ink);border-left:3px solid var(--blue)}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:14px;background:var(--paper);color:var(--ink);font-size:13px}.columns{display:grid;grid-template-columns:1fr 1fr;gap:20px}a{color:var(--blue)}a:hover{color:var(--blue-hover)}.note{padding:16px;border:1px solid var(--line-strong);border-radius:8px}@media(max-width:600px){.columns{grid-template-columns:1fr}h1{font-size:23px}}</style></head>
<body><main><a href="/">← PrzetargAI</a><h1>Porównanie SWZ — rzeczywisty przykład z branży eventowej</h1><p>${escape(data.nazwa)}</p><p>${escape(data.zamawiajacy)} · ${escape(data.numer)} · CPV ${escape(data.cpv.kod)} (${escape(data.cpv.rodzaj)}, SWZ str. ${data.cpv.strona_swz})</p><p class="note">${escape(data.uwaga)}</p>
<p><a href="${escape(data.platforma)}" target="_blank" rel="noopener noreferrer">Publiczna strona postępowania</a></p>
${data.punkty.map((p) => `<section><h2>${escape(p.nazwa)}</h2><div class="columns"><div><h3>Przed zmianą</h3>${quote(p.przed)}</div><div><h3>Po zmianie</h3>${quote(p.po)}</div></div><h3>Wynik porównania</h3><p>${escape(p.opis)}</p><details><summary>Pokaż różnicę tekstu obliczoną przez PrzetargAI</summary><pre>${escape(p.diff)}</pre></details></section>`).join('\n')}
<h2>Oryginalne dokumenty</h2><ul>${data.zrodla.map((d) => `<li><a href="${escape(d.url)}" target="_blank" rel="noopener noreferrer">${escape(d.nazwa)}</a> (${d.liczba_stron} str.)</li>`).join('')}</ul><p><a href="/data/przyklad-swz-eventy.json" download>Pobierz przykład ze źródłami i różnicami (JSON)</a></p><p>Przykład nie wymaga zakupu planu ani uruchomienia płatnej analizy. Nie zapisuje niczego na Twoim koncie.</p></main></body></html>`;
fs.writeFileSync(path.join(root, 'landing/przyklad-swz-eventy.html'), html);
console.log('Built public SWZ example from four verified PDF excerpts. No AI calls.');
