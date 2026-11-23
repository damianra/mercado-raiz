import 'dotenv/config';
import { createApp } from './app.js';
import { openDb } from './db.js';

const PORT = process.env.PORT ?? 4000;
// DB antes de listen: schema + seed quedan aplicados y un Postgres
// caído falla rápido al boot, no en el primer request.
await openDb();
const app = await createApp();
app.listen(PORT, () => console.log(`api en http://localhost:${PORT}`));
