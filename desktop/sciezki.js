const fs = require('node:fs');
const path = require('node:path');

/*
 * Tłumaczy ścieżkę z adresu `app://przetargai/...` na plik eksportu webowego.
 *
 * Eksport Expo odwołuje się do zasobów ścieżkami bezwzględnymi (`/_expo/static/...`),
 * więc zwykłe `file://` ich nie znajdzie — stąd własny protokół. Aplikacja ma jedną
 * stronę (React Navigation, nie expo-router), więc każda nieznana ścieżka dostaje
 * `index.html`, a nawigacją zajmuje się już JS.
 *
 * Ścieżka wychodząca poza katalog eksportu (`/../`) NIGDY nie zwraca pliku spoza niego.
 */
function plikDlaZadania(katalogWeb, sciezkaUrl) {
  const korzen = path.resolve(katalogWeb);
  let wzgledna;
  try {
    wzgledna = decodeURIComponent(sciezkaUrl || '/');
  } catch {
    wzgledna = '/';
  }
  const kandydat = path.resolve(korzen, '.' + path.posix.normalize('/' + wzgledna));
  const wewnatrz = kandydat === korzen || kandydat.startsWith(korzen + path.sep);
  if (wewnatrz && fs.existsSync(kandydat) && fs.statSync(kandydat).isFile()) {
    return kandydat;
  }
  return path.join(korzen, 'index.html');
}

/** Czy adres ma zostać w oknie aplikacji (reszta idzie do przeglądarki systemowej). */
function adresWewnetrzny(adres) {
  return typeof adres === 'string' && adres.startsWith('app://');
}

module.exports = { plikDlaZadania, adresWewnetrzny };
