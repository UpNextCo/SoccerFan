import { bootstrapDatabase } from './seed.js';

bootstrapDatabase()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
