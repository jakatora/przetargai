import { test } from 'node:test';
import assert from 'node:assert/strict';
import { czyMoznaWypelnic, daneDoWypelnienia, opisWypelnienia } from '../src/lib/wypelnianieZalacznika.js';

const t = (pl) => pl;

test('wypełniamy tylko .docx z e-Zamówień i platformazakupowa.pl', () => {
  const url = 'https://ezamowienia.gov.pl/mp-readmodels/api/Tender/DownloadDocument/a/a_1';
  assert.equal(czyMoznaWypelnic({ url, rozszerzenie: 'docx' }), true);
  assert.equal(czyMoznaWypelnic({ url, plik: 'Formularz ofertowy.DOCX' }), true);
  assert.equal(czyMoznaWypelnic({ url, rozszerzenie: 'doc' }), false);
  assert.equal(czyMoznaWypelnic({ url, rozszerzenie: 'pdf' }), false);
  assert.equal(czyMoznaWypelnic({ url: 'https://evil.example/f.docx', rozszerzenie: 'docx' }), false);
});

test('dane firmy z magazynu: tylko znane pola, bez nazwy → null', () => {
  assert.deepEqual(daneDoWypelnienia(JSON.stringify({ nazwa: ' Budmax ', nip: '813', wielkosc: 'male', obce: 'x', email: '' })), { nazwa: 'Budmax', nip: '813' });
  assert.equal(daneDoWypelnienia(JSON.stringify({ nip: '813' })), null);
  assert.equal(daneDoWypelnienia('{zły json'), null);
  assert.equal(daneDoWypelnienia(null), null);
});

test('komunikat po wypełnieniu', async () => {
  assert.equal(opisWypelnienia({ wypelnione: [{}, {}], do_uzupelnienia: [{ etykieta: 'Cena brutto:' }], do: 'a@b.pl' }, t), 'Wpisaliśmy 2 pola z danymi firmy. Wysłaliśmy na a@b.pl. Uzupełnij sam: Cena brutto:.');
  const { liczbaPol } = await import('../src/lib/wypelnianieZalacznika.js');
  assert.deepEqual([1, 2, 5, 12, 22, 25].map(liczbaPol), ['1 pole', '2 pola', '5 pól', '12 pól', '22 pola', '25 pól']);
  assert.match(opisWypelnienia({ wypelnione: [], do_uzupelnienia: [] }, t), /Nie znaleźliśmy/);
});
