import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generujTrescZobowiazania } from '../src/lib/zobowiazaniePodmiotu.js';

test('składa treść zobowiązania z wypełnionych pól (art. 118)', () => {
  const draft = {
    dane_podmiotu: { nazwa: 'ABC Sp. z o.o.', identyfikator: 'NIP 1234567890', adres: 'ul. X 1, Warszawa', reprezentant: 'Jan Kowalski, prezes' },
    zakres_doswiadczenia: 'budowa oczyszczalni 5000 m³/d',
    sposob_udostepnienia: 'udział w realizacji jako podwykonawca z nadzorem kadry',
    okres_udostepnienia: 'cały okres realizacji',
    zakres_podwykonawstwa: 'roboty sanitarne i technologiczne',
  };
  const { nazwa, tresc } = generujTrescZobowiazania(draft);
  assert.match(nazwa, /Zobowiązanie/);
  assert.match(tresc, /art\. 118/);
  assert.match(tresc, /ABC Sp\. z o\.o\./);
  assert.match(tresc, /NIP 1234567890/);
  assert.match(tresc, /reprezentowany przez: Jan Kowalski/);
  assert.match(tresc, /budowa oczyszczalni/);
  assert.match(tresc, /jako podwykonawca/);
  assert.match(tresc, /roboty sanitarne/);
});

test('braki pól → placeholder „…", nie wywraca', () => {
  const { tresc } = generujTrescZobowiazania({});
  assert.match(tresc, /…/);
  assert.match(tresc, /Zobowiązanie/i);
  assert.doesNotMatch(tresc, /undefined/);
});
