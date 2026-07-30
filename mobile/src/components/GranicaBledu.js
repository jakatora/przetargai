import { Component } from 'react';
import { View, Text, Pressable } from 'react-native';
import { zglosBlad } from '../services/telemetria';
import { ZDARZENIA } from '../lib/zdarzenia';

/**
 * Granica błędu renderu (React Error Boundary). Bez niej wyjątek w dowolnym ekranie
 * wywraca CAŁĄ aplikację do białego ekranu. Tu zamiast tego pokazujemy komunikat i
 * przycisk „Spróbuj ponownie", a błąd raportujemy przez telemetrię (punkt zaczepu Sentry).
 *
 * To MUSI być komponent klasowy — `componentDidCatch`/`getDerivedStateFromError` nie
 * mają odpowiedników w hookach. Fallback celowo używa stałych kolorów (nie motywu),
 * bo błąd mógł wyjść właśnie z warstwy motywu — fallback ma działać niezależnie.
 */
export default class GranicaBledu extends Component {
  constructor(props) {
    super(props);
    this.state = { blad: false };
    this.sprobujPonownie = this.sprobujPonownie.bind(this);
  }

  static getDerivedStateFromError() {
    return { blad: true };
  }

  componentDidCatch(blad, info) {
    zglosBlad(blad, {
      zdarzenie: ZDARZENIA.BLAD_RENDEROWANIA,
      komponenty: info?.componentStack ? String(info.componentStack).slice(0, 1000) : null,
    });
  }

  sprobujPonownie() {
    this.setState({ blad: false });
  }

  render() {
    if (!this.state.blad) return this.props.children;

    return (
      <View style={style.tlo}>
        <Text style={style.tytul}>Coś poszło nie tak</Text>
        <Text style={style.tresc}>
          Ten ekran napotkał błąd. Możesz spróbować ponownie — jeśli problem wróci,
          zamknij i otwórz aplikację.
        </Text>
        <Pressable
          onPress={this.sprobujPonownie}
          style={({ pressed }) => [style.przycisk, pressed && style.przyciskWcisniety]}
          accessibilityRole="button"
        >
          <Text style={style.przyciskTekst}>Spróbuj ponownie</Text>
        </Pressable>
      </View>
    );
  }
}

// Kolory na sztywno — fallback musi działać nawet gdy zawiodła warstwa motywu.
const style = {
  tlo: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#0f172a' },
  tytul: { fontSize: 20, fontWeight: '800', color: '#f8fafc', textAlign: 'center' },
  tresc: { fontSize: 14, color: '#cbd5e1', textAlign: 'center', marginTop: 10, lineHeight: 21 },
  przycisk: {
    marginTop: 24,
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  przyciskWcisniety: { opacity: 0.85 },
  przyciskTekst: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
};
