// Сборка корректно подписанного initData — для тестов и локальной отладки
import { signInitData } from '../src/auth.js';

export const TEST_TOKEN = '123456:TEST-TOKEN';

export async function makeInitData(user, token = TEST_TOKEN, authDate = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams({ auth_date: String(authDate), query_id: 'test', user: JSON.stringify(user) });
  params.set('hash', await signInitData(params, token));
  return params.toString();
}
