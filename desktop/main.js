const { app, BrowserWindow, protocol, net, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { plikDlaZadania, adresWewnetrzny } = require('./sciezki');

/*
 * PrzetargAI na Windows = ta sama aplikacja co na telefonie (eksport webowy Expo)
 * w oknie Electrona. Backend jest wspólny (Cloud Functions), więc konto, feed
 * i zapisane przetargi są te same na telefonie i na komputerze.
 *
 * Czego tu świadomie NIE ma: powiadomień push (Expo push działa tylko na telefonie)
 * i dostępu Node w oknie (contextIsolation + sandbox — strona nie dostaje `require`).
 */

const KATALOG_WEB = path.join(__dirname, 'web');
const START = 'app://przetargai/';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let okno = null;

function otworzZewnetrznie(adres) {
  if (/^(https?:|mailto:)/i.test(adres)) shell.openExternal(adres);
}

function utworzOkno() {
  okno = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    title: 'PrzetargAI',
    backgroundColor: '#0B3D91',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });

  // Stripe, regulamin, polityka, mailto — do przeglądarki systemowej, nie do okna aplikacji.
  okno.webContents.setWindowOpenHandler(({ url }) => {
    otworzZewnetrznie(url);
    return { action: 'deny' };
  });
  okno.webContents.on('will-navigate', (zdarzenie, url) => {
    if (!adresWewnetrzny(url)) {
      zdarzenie.preventDefault();
      otworzZewnetrznie(url);
    }
  });

  // Ekrany są projektowane pod telefon — na szerokim oknie pola i karty rozlewały się
  // na 1100+ px. Czytelna kolumna na środku, tło wokół w obu motywach.
  okno.webContents.on('dom-ready', () => {
    okno.webContents.insertCSS(`
      html, body { background: #E6EBF2; }
      #root { max-width: 860px; margin: 0 auto; box-shadow: 0 0 0 1px rgba(15,23,42,.06), 0 12px 40px rgba(15,23,42,.10); }
      @media (prefers-color-scheme: dark) { html, body { background: #04070D; } }
    `);
  });

  if (process.env.PRZETARGAI_SMOKE) wlaczTrybSmoke(okno, process.env.PRZETARGAI_SMOKE);

  okno.loadURL(START);
}

/*
 * Tryb kontrolny dla `npm run smoke`: po załadowaniu zapisuje zrzut okna i błędy
 * konsoli, a potem zamyka aplikację. Pozwala sprawdzić build bez klikania.
 */
function wlaczTrybSmoke(win, plikPng) {
  const bledy = [];
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') bledy.push(e.message);
  });
  win.webContents.on('did-fail-load', (_e, kod, opis, adres) => bledy.push(`did-fail-load ${kod} ${opis} ${adres}`));
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      const obraz = await win.webContents.capturePage();
      fs.writeFileSync(plikPng, obraz.toPNG());
      const tekst = await win.webContents.executeJavaScript('document.body.innerText.slice(0, 400)');
      fs.writeFileSync(plikPng + '.json', JSON.stringify({ bledy, tekst }, null, 2));
      app.quit();
    }, 9000);
  });
}

app.on('second-instance', () => {
  if (okno) {
    if (okno.isMinimized()) okno.restore();
    okno.focus();
  }
});

app.whenReady().then(() => {
  protocol.handle('app', (zadanie) => {
    const { pathname } = new URL(zadanie.url);
    return net.fetch(pathToFileURL(plikDlaZadania(KATALOG_WEB, pathname)).toString());
  });
  utworzOkno();
});

app.on('window-all-closed', () => app.quit());
