import { Router } from 'express';
import { readFileSync } from 'node:fs';

// Backend deploy includes the same standalone documents as docs/.
const router = Router();
for (const name of ['regulamin', 'polityka-prywatnosci']) {
  const html = readFileSync(new URL(`../../legal/${name}.html`, import.meta.url), 'utf8');
  router.get(`/${name}`, (_req, res) => res.type('html').send(html));
}
export default router;
