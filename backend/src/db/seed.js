import bcrypt from 'bcryptjs';
import { migrate } from './migrate.js';
import { users } from './repos.js';
import { logger } from '../lib/logger.js';
import { isMainModule } from '../lib/ids.js';

/** Tworzy konto demonstracyjne do testów lokalnych. */
async function seed() {
  migrate();

  const email = 'demo@przetargai.pl';
  if (users.findByEmail(email)) {
    logger.info('Użytkownik demo już istnieje — pomijam seed');
    return;
  }

  const passwordHash = await bcrypt.hash('demo1234', 12);
  users.create({
    companyNip: '5252248481', // poprawny NIP (suma kontrolna OK)
    companyName: 'Demo Budownictwo Sp. z o.o.',
    email,
    passwordHash,
    keywords: ['roboty budowlane', 'remont', 'budowa', 'instalacje', 'modernizacja'],
    cpvCodes: ['45000000', '45300000'],
  });
  logger.info('Utworzono konto demo — login: demo@przetargai.pl  hasło: demo1234');
}

if (isMainModule(import.meta.url)) {
  seed().then(() => process.exit(0)).catch((err) => {
    logger.error({ err }, 'Seed nie powiódł się');
    process.exit(1);
  });
}

export { seed };
