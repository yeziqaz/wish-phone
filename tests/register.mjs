import { register } from 'node:module';

// npm test 通过 `node --import ./tests/register.mjs --test tests/*.test.ts` 加载它
register('./resolve-ts.mjs', import.meta.url);
