import { useRef, useState } from 'react';

// Odpowiedź serwera dotyczy wysłanej wersji, nie późniejszych zmian w polu.
export function useNoteDraft(initial, persist) {
  const [text, setText] = useState(initial);
  const [status, setStatus] = useState('idle');
  const [busy, setBusy] = useState(false);
  const draft = useRef({ text: initial, revision: 0 });
  const saving = useRef(false);
  function change(value) {
    draft.current = { text: value, revision: draft.current.revision + 1 };
    setText(value); setStatus('dirty');
  }
  async function save() {
    if (saving.current) return;
    saving.current = true; setBusy(true); setStatus('saving');
    const sent = draft.current;
    try {
      const result = await persist(sent.text);
      if (typeof result?.notatka !== 'string') throw new Error('Nie udało się potwierdzić zapisu notatki.');
      if (draft.current.revision === sent.revision) {
        draft.current = { text: result.notatka, revision: sent.revision };
        setText(result.notatka); setStatus('saved');
      } else {
        setStatus('dirty');
      }
    } catch (error) {
      setStatus('error');
      throw error;
    } finally {
      saving.current = false; setBusy(false);
    }
  }
  return { text, status, busy, change, save };
}
