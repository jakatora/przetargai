// Lokalny relay ATLAS Pilota do prób (bez schedulera PrzetargAI i bez zewnętrznych usług).
// Użycie: JWT_SECRET=... DATABASE_PATH=<tymczasowa.db> PORT=3917 node scripts/atlas-pilot-local.mjs
const { migrate } = await import('../src/db/migrate.js');
const { createApp } = await import('../src/app.js');

migrate();
const port = Number(process.env.PORT) || 3917;
createApp().listen(port, '0.0.0.0', () => {
  console.log(`atlas-pilot local relay → http://127.0.0.1:${port}/api/atlas-pilot`);
});
