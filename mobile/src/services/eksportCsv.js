import { Alert } from 'react-native';
import { api } from '../api/client';
import { tr } from '../lib/jezyk';
import { potwierdzenieEksportu, komunikatWyniku, komunikatBledu } from '../lib/eksport';

/**
 * Eksport CSV na e-mail właściciela konta (P2-3): potwierdzenie → wysyłka → wynik.
 * Wspólne dla „Zapisanych" i katalogu, żeby oba miejsca mówiły to samo.
 *
 * @param {{rodzaj: 'zapisane'|'katalog'|'kalendarz', filtry?: object, email?: string, jezyk?: string}} opcje
 *   `filtry` = parametry zapytania katalogu (lib/katalogPrzetargow.parametryZapytania)
 */
export function eksportujNaEmail({ rodzaj, filtry, email, jezyk = 'pl' }) {
  const t = (pl, en) => tr({ pl, en }, jezyk);
  Alert.alert(
    rodzaj === 'kalendarz' ? t('Terminy do kalendarza', 'Deadlines to calendar') : t('Eksport do Excela', 'Export to Excel'),
    potwierdzenieEksportu(rodzaj, email, jezyk),
    [
      { text: t('Anuluj', 'Cancel'), style: 'cancel' },
      {
        text: t('Wyślij', 'Send'),
        onPress: async () => {
          try {
            const odp = await api.eksportWyslij({ rodzaj, filtry });
            Alert.alert(t('Wysłano', 'Sent'), komunikatWyniku({ ...odp, rodzaj }, jezyk));
          } catch (err) {
            Alert.alert(t('Nie udało się', 'Failed'), komunikatBledu(err, jezyk));
          }
        },
      },
    ],
  );
}
