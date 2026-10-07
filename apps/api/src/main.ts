import { createApp } from './bootstrap';
import { loadConfig } from './config';

async function main() {
  const app = await createApp();
  const { API_PORT } = loadConfig();
  await app.listen(API_PORT, '0.0.0.0');
}

void main();
