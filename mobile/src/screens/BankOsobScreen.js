import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable } from 'react-native';
import Screen from '../components/Screen';
import Button from '../components/Button';
import TextField from '../components/TextField';
import PrzyciskWord from '../components/PrzyciskWord';
import * as storage from '../lib/storage';
import { udostepnijTekst } from '../lib/udostepnianie';
import { KLUCZ_DANYCH_WYKONAWCY } from '../lib/dokumentyOferty';
import { useTheme, useStyle, tworzStyle } from '../context/ThemeContext';
import { useJezyk } from '../context/JezykContext';
import { spacing, radius } from '../theme';
import {
  KLUCZ_BANKU_OSOB, FUNKCJE, PODSTAWY, odczytajBank, walidujOsobe, walidujRealizacje, sortujOsoby, podsumowanieOsoby, generujWykazOsob, odmianaLat,
} from '../lib/bankOsob';

/**
 * „Bank osób” (2026-10-31): kadra z uprawnieniami i doświadczeniem wpisana raz, a z niej
 * „Wykaz osób” do oferty albo na wezwanie (§ 9 ust. 1 pkt 3 rozporządzenia). Ekran nic nie
 * liczy — lata od uprawnień, kolejność i treść wykazu daje testowany `lib/bankOsob.js`.
 * Dane osobowe pracowników zostają na telefonie (magazyn konta, czyszczony przy wylogowaniu).
 */

const FUNKCJE_LISTA = Object.keys(FUNKCJE);
const PODSTAWY_LISTA = Object.keys(PODSTAWY);
const PUSTA_OSOBA = { imie: '', funkcja: 'kierownik_budowy', funkcjaOpis: '', uprawnienia: '', uprawnieniaData: '', izba: '', wyksztalcenie: '', podstawa: 'umowa_o_prace' };
const PUSTA_REALIZACJA = { nazwa: '', rola: '', zamawiajacy: '', wartosc: '', dataZakonczenia: '' };
const noweId = (p) => `${p}${Date.now()}${Math.round(Math.random() * 1e4)}`;

function Chipy({ lista, etykiety, wybrany, onWybierz, styles, kolory, t }) {
  return (
    <View style={styles.chipy}>
      {lista.map((k) => {
        const aktywny = wybrany === k;
        return (
          <Pressable
            key={k}
            accessibilityRole="radio"
            accessibilityState={{ checked: aktywny }}
            onPress={() => onWybierz(k)}
            style={[styles.chip, aktywny && { backgroundColor: kolory.blue, borderColor: kolory.blue }]}
          >
            <Text style={[styles.chipText, aktywny && { color: kolory.naAkcencie }]}>{t(etykiety[k].pl, etykiety[k].en)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function BankOsobScreen() {
  const { kolory } = useTheme();
  const styles = useStyle(tworzStyleBankuOsob);
  const { t } = useJezyk();
  const [osoby, setOsoby] = useState([]);
  const [forma, setForma] = useState(PUSTA_OSOBA);
  const [probaZapisu, setProbaZapisu] = useState(false);
  const [realizacjaDla, setRealizacjaDla] = useState(null);
  const [realizacja, setRealizacja] = useState(PUSTA_REALIZACJA);
  const [wybrane, setWybrane] = useState(null); // null = wszyscy do wykazu
  const [wykonawca, setWykonawca] = useState({});
  const dzisiaj = new Date().toISOString();

  useEffect(() => {
    storage.getItem(KLUCZ_BANKU_OSOB).then((s) => setOsoby(odczytajBank(s))).catch(() => {});
    storage.getItem(KLUCZ_DANYCH_WYKONAWCY).then((s) => { if (s) setWykonawca(JSON.parse(s)); }).catch(() => {});
  }, []);

  const zapisz = useCallback((lista) => {
    setOsoby(lista);
    storage.setItem(KLUCZ_BANKU_OSOB, JSON.stringify(lista)).catch(() => {});
  }, []);

  const { bledy, maBledy } = walidujOsobe({ imie: forma.imie, dataUprawnien: forma.uprawnieniaData });
  const walidacjaRealizacji = walidujRealizacje(realizacja);
  const pole = (k) => (v) => setForma((f) => ({ ...f, [k]: v }));
  const poleR = (k) => (v) => setRealizacja((r) => ({ ...r, [k]: v }));
  const blad = (b) => (b ? t(b.pl, b.en) : undefined);

  function dodajOsobe() {
    setProbaZapisu(true);
    if (maBledy) return;
    const o = Object.fromEntries(Object.entries(forma).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
    zapisz([...osoby, { ...o, id: noweId('o'), realizacje: [] }]);
    setForma(PUSTA_OSOBA);
    setProbaZapisu(false);
  }

  function dodajRealizacje(id) {
    if (walidacjaRealizacji.maBledy) return;
    const r = Object.fromEntries(Object.entries(realizacja).map(([k, v]) => [k, String(v).trim()]));
    zapisz(osoby.map((o) => (o.id === id ? { ...o, realizacje: [...o.realizacje, { ...r, id: noweId('r') }] } : o)));
    setRealizacja(PUSTA_REALIZACJA);
    setRealizacjaDla(null);
  }

  const usunOsobe = (id) => zapisz(osoby.filter((o) => o.id !== id));
  const usunRealizacje = (id, rid) => zapisz(osoby.map((o) => (o.id === id ? { ...o, realizacje: o.realizacje.filter((r) => r.id !== rid) } : o)));
  const czyWybrana = (id) => wybrane === null || wybrane.includes(id);
  function przelacz(id) {
    const teraz = wybrane ?? osoby.map((o) => o.id);
    setWybrane(teraz.includes(id) ? teraz.filter((x) => x !== id) : [...teraz, id]);
  }

  const posortowane = sortujOsoby(osoby);
  const wykaz = generujWykazOsob({ wykonawca, osoby: osoby.filter((o) => czyWybrana(o.id)), dzisiaj });

  return (
    <Screen scroll>
      <Text style={styles.wstep}>
        {t(
          'Wpisz raz kierownika budowy, kierowników robót i inną kadrę: uprawnienia, doświadczenie, wykształcenie. Wykaz osób do oferty albo na wezwanie złożymy z tego jednym kliknięciem.',
          'Enter your site manager, works managers and other staff once: licences, experience, education. We build the staff list for your offer in one click.',
        )}
      </Text>

      <View style={styles.card}>
        <Text style={styles.kartaTytul}>{t('Dodaj osobę', 'Add a person')}</Text>
        <TextField label={t('Imię i nazwisko', 'Full name')} value={forma.imie} onChangeText={pole('imie')} placeholder="Jan Kowalski" error={probaZapisu ? blad(bledy.imie) : undefined} />
        <Text style={styles.polLabel}>{t('Funkcja w zamówieniu', 'Role on the contract')}</Text>
        <Chipy lista={FUNKCJE_LISTA} etykiety={FUNKCJE} wybrany={forma.funkcja} onWybierz={pole('funkcja')} styles={styles} kolory={kolory} t={t} />
        {forma.funkcja === 'inna' ? <TextField label={t('Jaka funkcja?', 'Which role?')} value={forma.funkcjaOpis} onChangeText={pole('funkcjaOpis')} placeholder={t('np. kierownik robót elektrycznych', 'e.g. electrical works manager')} /> : null}
        <TextField
          label={t('Uprawnienia (numer, specjalność, zakres)', 'Licence (number, specialty, scope)')}
          value={forma.uprawnienia}
          onChangeText={pole('uprawnienia')}
          multiline
          placeholder={t('np. nr PDK/0123/POOK/12, konstrukcyjno-budowlana bez ograniczeń', 'e.g. no. PDK/0123/POOK/12, structural, unrestricted')}
        />
        <TextField
          label={t('Data uzyskania uprawnień (RRRR-MM-DD)', 'Licence date (YYYY-MM-DD)')}
          value={forma.uprawnieniaData}
          onChangeText={pole('uprawnieniaData')}
          placeholder="2012-06-15"
          autoCapitalize="none"
          hint={t('Policzymy lata doświadczenia od uprawnień — o to pytają kryteria i warunki.', 'We count years since the licence — criteria and conditions ask for it.')}
          error={blad(bledy.dataUprawnien)}
        />
        <TextField label={t('Izba samorządu zawodowego (nr członkowski)', 'Professional chamber (membership no.)')} value={forma.izba} onChangeText={pole('izba')} placeholder="PDK/BO/1234/12" />
        <TextField label={t('Wykształcenie', 'Education')} value={forma.wyksztalcenie} onChangeText={pole('wyksztalcenie')} placeholder={t('np. wyższe techniczne, budownictwo', 'e.g. MSc civil engineering')} />
        <Text style={styles.polLabel}>{t('Podstawa dysponowania', 'Basis of availability')}</Text>
        <Chipy lista={PODSTAWY_LISTA} etykiety={PODSTAWY} wybrany={forma.podstawa} onWybierz={pole('podstawa')} styles={styles} kolory={kolory} t={t} />
        <Button title={t('Dodaj do banku', 'Add to bank')} onPress={dodajOsobe} disabled={probaZapisu && maBledy} style={styles.gap} />
      </View>

      <Text style={styles.sekcjaTytul}>{t('Twoja kadra', 'Your staff')}{osoby.length ? ` (${osoby.length})` : ''}</Text>
      {posortowane.length === 0 ? (
        <Text style={styles.pusto}>{t('Nikogo jeszcze nie ma. Zacznij od kierownika budowy — jest w prawie każdym przetargu na roboty.', 'Nobody yet. Start with your site manager — almost every works tender asks for one.')}</Text>
      ) : posortowane.map((o) => {
        const s = podsumowanieOsoby(o, dzisiaj);
        const funkcja = o.funkcja === 'inna' && o.funkcjaOpis ? o.funkcjaOpis : t(FUNKCJE[o.funkcja]?.pl ?? '', FUNKCJE[o.funkcja]?.en ?? '');
        return (
          <View key={o.id} style={styles.osoba}>
            <View style={styles.glowa}>
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: czyWybrana(o.id) }} onPress={() => przelacz(o.id)} hitSlop={8} style={styles.wyborWrap}>
                <Text style={styles.wybor}>{czyWybrana(o.id) ? '☑' : '☐'}</Text>
              </Pressable>
              <View style={styles.flex}>
                <Text style={styles.imie}>{o.imie}</Text>
                <Text style={styles.meta}>{funkcja}{o.podstawa ? ` · ${t(PODSTAWY[o.podstawa]?.pl ?? '', PODSTAWY[o.podstawa]?.en ?? '')}` : ''}</Text>
              </View>
            </View>
            <Text style={styles.meta}>
              {s.lat !== null ? t(`${odmianaLat(s.lat)} od uprawnień`, `${s.lat} years since licence`) : t('bez daty uprawnień', 'no licence date')}
              {' · '}
              {t(s.realizacji === 1 ? '1 realizacja' : `${s.realizacji} realizacji`, s.realizacji === 1 ? '1 project' : `${s.realizacji} projects`)}
            </Text>
            {s.posredni ? <Text style={styles.ostrzezenie}>{t('Osoba z innej firmy: do oferty dołącz zobowiązanie podmiotu udostępniającego (art. 118 Pzp).', 'Person from another company: attach the lending entity commitment (Art. 118).')}</Text> : null}
            {o.realizacje.map((r) => (
              <View key={r.id} style={styles.realizacja}>
                <Text style={styles.realizacjaTekst}>– {r.nazwa}{r.rola ? ` (${r.rola})` : ''}{r.dataZakonczenia ? `, ${r.dataZakonczenia}` : ''}</Text>
                <Pressable accessibilityRole="button" onPress={() => usunRealizacje(o.id, r.id)} hitSlop={8}><Text style={styles.usunMaly}>{t('Usuń', 'Remove')}</Text></Pressable>
              </View>
            ))}
            {realizacjaDla === o.id ? (
              <View style={styles.formaRealizacji}>
                <TextField label={t('Inwestycja lub usługa', 'Project or service')} value={realizacja.nazwa} onChangeText={poleR('nazwa')} placeholder={t('np. Przebudowa szkoły w Jarosławiu', 'e.g. School refurbishment')} />
                <TextField label={t('Pełniona funkcja', 'Role held')} value={realizacja.rola} onChangeText={poleR('rola')} placeholder={t('np. kierownik budowy', 'e.g. site manager')} />
                <TextField label={t('Zamawiający', 'Buyer')} value={realizacja.zamawiajacy} onChangeText={poleR('zamawiajacy')} />
                <TextField label={t('Wartość brutto (zł)', 'Gross value (PLN)')} value={realizacja.wartosc} onChangeText={poleR('wartosc')} keyboardType="numeric" error={blad(walidacjaRealizacji.bledy.wartosc)} />
                <TextField label={t('Data zakończenia (RRRR-MM-DD)', 'End date (YYYY-MM-DD)')} value={realizacja.dataZakonczenia} onChangeText={poleR('dataZakonczenia')} autoCapitalize="none" error={blad(walidacjaRealizacji.bledy.dataZakonczenia)} />
                <Button title={t('Zapisz realizację', 'Save project')} onPress={() => dodajRealizacje(o.id)} disabled={walidacjaRealizacji.maBledy} style={styles.gap} />
              </View>
            ) : null}
            <View style={styles.akcje}>
              <Pressable accessibilityRole="button" onPress={() => { setRealizacjaDla(realizacjaDla === o.id ? null : o.id); setRealizacja(PUSTA_REALIZACJA); }} hitSlop={8}>
                <Text style={styles.link}>{realizacjaDla === o.id ? t('Anuluj', 'Cancel') : t('+ Dodaj realizację', '+ Add project')}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => usunOsobe(o.id)} hitSlop={8}>
                <Text style={styles.usun}>{t('Usuń osobę', 'Remove person')}</Text>
              </Pressable>
            </View>
          </View>
        );
      })}

      {osoby.length ? (
        <View style={styles.wykazBlok}>
          <Text style={styles.wykazTytul}>{t('Wykaz osób w 1 klik', 'Staff list in one click')}</Text>
          <Text style={styles.wykazOpis}>
            {t(
              `Zaznaczone osoby (${wykaz.liczba}) w układzie z rozporządzenia: funkcja, uprawnienia, doświadczenie, wykształcenie, podstawa dysponowania. Dane firmy bierzemy z „Dokumentów do oferty”.`,
              `Selected people (${wykaz.liczba}) in the statutory layout: role, licence, experience, education, basis. Company details come from "Offer documents".`,
            )}
          </Text>
          <Button title={t('Udostępnij / skopiuj', 'Share / copy')} variant="ghost" onPress={() => udostepnijTekst({ message: wykaz.tresc, title: wykaz.nazwa }).catch(() => {})} disabled={!wykaz.liczba} style={styles.gap} />
          {wykaz.liczba ? <PrzyciskWord nazwa={wykaz.nazwa} tresc={wykaz.tresc} /> : null}
        </View>
      ) : null}

      <Text style={styles.stopka}>
        {t(
          'To dane osobowe Twoich pracowników — zostają tylko na tym telefonie i znikają po wylogowaniu. Do wykazu dopisz to, czego wymaga SWZ danego przetargu.',
          'This is personal data of your staff — it stays on this phone only and is removed on sign-out. Add whatever the tender documents require.',
        )}
      </Text>
    </Screen>
  );
}

const tworzStyleBankuOsob = tworzStyle((k) => ({
  wstep: { fontSize: 14, color: k.textMuted, lineHeight: 21, marginBottom: spacing.md },
  sekcjaTytul: { fontSize: 16, fontWeight: '800', color: k.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  pusto: { fontSize: 14, color: k.textMuted, lineHeight: 20 },
  gap: { marginTop: spacing.sm },
  flex: { flex: 1 },
  polLabel: { fontSize: 13, fontWeight: '700', color: k.text, marginBottom: spacing.xs, marginTop: spacing.sm },
  card: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginTop: spacing.sm },
  kartaTytul: { fontSize: 15, fontWeight: '700', color: k.text, marginBottom: spacing.sm },
  chipy: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: k.border, backgroundColor: k.bg },
  chipText: { fontSize: 13, fontWeight: '700', color: k.text },
  osoba: { backgroundColor: k.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginTop: spacing.sm },
  glowa: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  wyborWrap: { paddingTop: 1 },
  wybor: { fontSize: 18, color: k.blue },
  imie: { fontSize: 15, fontWeight: '700', color: k.text, lineHeight: 20 },
  meta: { fontSize: 13, color: k.textMuted, marginTop: 2, lineHeight: 18 },
  ostrzezenie: { fontSize: 13, color: k.ostrzezenieTekst, lineHeight: 18, marginTop: spacing.xs },
  realizacja: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.xs },
  realizacjaTekst: { flex: 1, fontSize: 13, color: k.text, lineHeight: 18 },
  formaRealizacji: { borderTopWidth: 1, borderTopColor: k.border, marginTop: spacing.sm, paddingTop: spacing.sm },
  akcje: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  link: { fontSize: 13, fontWeight: '700', color: k.blue },
  usun: { fontSize: 13, fontWeight: '700', color: k.danger },
  usunMaly: { fontSize: 12, fontWeight: '700', color: k.danger },
  wykazBlok: { backgroundColor: k.surface, borderRadius: radius.md, borderWidth: 1, borderColor: k.border, padding: spacing.md, marginTop: spacing.md },
  wykazTytul: { fontSize: 15, fontWeight: '700', color: k.text },
  wykazOpis: { fontSize: 13, color: k.textMuted, lineHeight: 19, marginTop: 4, marginBottom: spacing.sm },
  stopka: { fontSize: 12, color: k.textMuted, lineHeight: 17, marginTop: spacing.lg, fontStyle: 'italic' },
}));
