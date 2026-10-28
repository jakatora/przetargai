import { View, Text } from 'react-native';

/**
 * Kilka prostych ikon rysowanych z widoków — zamiast emoji (różne na każdej platformie,
 * nie dają się barwić tokenami) i bez dokładania paczki fontów z ikonami do aplikacji.
 * Kreska 2 pt jak w ikonach strony (styl Lucide). Ikona jest dekoracją: etykietę dostępności
 * ma element, w którym stoi (przycisk, wiersz), więc tu wszystko jest ukryte przed czytnikiem.
 *
 * @param {'szukaj'|'zamknij'|'dalej'|'dokument'|'filtr'|'ok'|'uwaga'} nazwa
 * @param {number} rozmiar bok kwadratu w pt (domyślnie 18)
 * @param {string} kolor kolor kreski — zawsze z palety motywu
 */
export default function Ikona({ nazwa, rozmiar = 18, kolor }) {
  const s = rozmiar;
  const kreska = Math.max(1.5, Math.round(s / 9));
  const pudlo = { width: s, height: s };
  const wspolne = { accessible: false, importantForAccessibility: 'no-hide-descendants', pointerEvents: 'none' };

  if (nazwa === 'szukaj') {
    const r = s * 0.62;
    return (
      <View {...wspolne} style={pudlo}>
        <View style={{ position: 'absolute', left: s * 0.06, top: s * 0.06, width: r, height: r, borderRadius: r / 2, borderWidth: kreska, borderColor: kolor }} />
        <View style={{ position: 'absolute', left: s * 0.6, top: s * 0.7, width: s * 0.36, height: kreska, borderRadius: kreska, backgroundColor: kolor, transform: [{ rotate: '45deg' }] }} />
      </View>
    );
  }
  if (nazwa === 'zamknij') {
    const bar = { position: 'absolute', left: s * 0.12, top: s / 2 - kreska / 2, width: s * 0.76, height: kreska, borderRadius: kreska, backgroundColor: kolor };
    return (
      <View {...wspolne} style={pudlo}>
        <View style={[bar, { transform: [{ rotate: '45deg' }] }]} />
        <View style={[bar, { transform: [{ rotate: '-45deg' }] }]} />
      </View>
    );
  }
  if (nazwa === 'dalej') {
    const b = s * 0.42;
    return (
      <View {...wspolne} style={[pudlo, { alignItems: 'center', justifyContent: 'center' }]}>
        <View style={{ width: b, height: b, borderTopWidth: kreska, borderRightWidth: kreska, borderColor: kolor, transform: [{ translateX: -b * 0.2 }, { rotate: '45deg' }] }} />
      </View>
    );
  }
  if (nazwa === 'ok') {
    return (
      <View {...wspolne} style={[pudlo, { alignItems: 'center', justifyContent: 'center' }]}>
        <View style={{ width: s * 0.32, height: s * 0.6, borderBottomWidth: kreska, borderRightWidth: kreska, borderColor: kolor, transform: [{ translateY: -s * 0.06 }, { rotate: '45deg' }] }} />
      </View>
    );
  }
  if (nazwa === 'uwaga') {
    return (
      <View {...wspolne} style={[pudlo, { borderRadius: s / 2, borderWidth: kreska, borderColor: kolor, alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ color: kolor, fontSize: s * 0.62, lineHeight: s * 0.72, fontWeight: '800' }}>!</Text>
      </View>
    );
  }
  if (nazwa === 'filtr') {
    const bar = (szer, gora) => (
      <View style={{ position: 'absolute', left: (s - szer) / 2, top: gora, width: szer, height: kreska, borderRadius: kreska, backgroundColor: kolor }} />
    );
    return (
      <View {...wspolne} style={pudlo}>
        {bar(s * 0.86, s * 0.2)}
        {bar(s * 0.58, s * 0.47)}
        {bar(s * 0.3, s * 0.74)}
      </View>
    );
  }
  // 'dokument' (domyślna): kartka z trzema wierszami tekstu.
  const linia = (szer, gora) => (
    <View style={{ position: 'absolute', left: s * 0.2, top: gora, width: szer, height: kreska, borderRadius: kreska, backgroundColor: kolor }} />
  );
  return (
    <View {...wspolne} style={pudlo}>
      <View style={{ position: 'absolute', left: s * 0.08, top: 0, width: s * 0.84, height: s, borderRadius: s * 0.12, borderWidth: kreska, borderColor: kolor }} />
      {linia(s * 0.6, s * 0.28)}
      {linia(s * 0.6, s * 0.48)}
      {linia(s * 0.38, s * 0.68)}
    </View>
  );
}
