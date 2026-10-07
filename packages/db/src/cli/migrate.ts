import { requireEnv } from './env';
import { migrate } from '../migrator';

migrate(requireEnv('DATABASE_MIGRATOR_URL'))
  .then((r) => console.log(`migrations: ${r.applied.length} applied, ${r.skipped} already applied`))
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
