import { createServer as createViteServer } from 'vite';
import { createApiServer } from './api.mjs';

const api = createApiServer();
const vite = await createViteServer({ configFile: './vite.config.ts', server: { host: '127.0.0.1' } });
api.listen(Number(process.env.API_PORT || 8788), '127.0.0.1', () => console.log('Official data API ready at http://127.0.0.1:8788'));
await vite.listen();
vite.printUrls();

async function stop() {
  await vite.close();
  api.close(() => process.exit(0));
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
