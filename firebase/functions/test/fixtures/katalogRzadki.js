import { getFirestore } from 'firebase-admin/firestore';

/** Wyłącznie emulator: dwie luki po 1301 rekordów, większe od budżetu skanu1200. */
export async function zasiejRzadkiKatalog(znak) {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Fixture wymaga emulatora');
  const db = getFirestore();
  const ids = [];
  const docs = [];
  const teraz = Date.now();
  const dodaj = (title, dzien, aktywny, numer) => {
    const id = `${znak}-${String(docs.length).padStart(5, '0')}`;
    const data = {
      title: `${znak} ${title}`, organization: 'Gmina Testowa — emulator', source: 'bzp',
      fetched_at: new Date(teraz - dzien * 86_400_000 - numer * 1000).toISOString(),
      published_at: new Date(teraz - dzien * 86_400_000 - numer * 1000).toISOString(),
      deadline: new Date(teraz + (aktywny ? (30 - numer % 20) : -10) * 86_400_000).toISOString(),
      wojewodztwo: 'PL14', cpv_main: '45240000-1', url: 'http://127.0.0.1:47831/oryginal',
    };
    docs.push({ id, data });
    if (aktywny) ids.push(id);
  };
  for (let n = 0; n < 1301; n++) dodaj('archiwalne nowsze', 0, false, n);
  for (let n = 0; n < 20; n++) dodaj(`rumoszu roboty ${n}`, 2, true, n);
  for (let n = 0; n < 1301; n++) dodaj('archiwalne środkowe', 3, false, n);
  for (let n = 20; n < 27; n++) dodaj(`rumoszu roboty ${n}`, 5, true, n);
  for (let start = 0; start < docs.length; start += 400) {
    const batch = db.batch();
    docs.slice(start, start + 400).forEach(({ id, data }) => batch.set(db.collection('tenders').doc(id), data));
    await batch.commit();
  }
  return { ids, docs };
}
