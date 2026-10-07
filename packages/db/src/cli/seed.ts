import { requireEnv } from './env';
import { seed } from '../seed';

seed(requireEnv('DATABASE_MIGRATOR_URL'))
  .then(() => console.log('seed done'))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
