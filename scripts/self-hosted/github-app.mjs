// GitHub access as the whexy-bot App, from GITHUB_APP_ID,
// GITHUB_APP_INSTALLATION_ID, and GITHUB_APP_PRIVATE_KEY. Run directly, it
// prints a token, which the sync pipeline pushes the rebased branch with.
import * as NodeCrypto from 'node:crypto';
import * as NodeURL from 'node:url';

const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
};

export async function githubRequest(token, path, { method = 'GET', body } = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub ${method} ${path} answered ${response.status}: ${await response.text()}`);
  }
  return response.status === 204 ? null : response.json();
}

export async function githubToken() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  // GitHub rejects an `iat` ahead of its clock, so back-date it for skew.
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: now - 60, exp: now + 540, iss: env('GITHUB_APP_ID') })}`;
  const jwt = `${unsigned}.${NodeCrypto.sign('sha256', Buffer.from(unsigned), env('GITHUB_APP_PRIVATE_KEY')).toString('base64url')}`;
  // The App is installed account-wide, so the token is scoped to this repository.
  const { token } = await githubRequest(
    jwt,
    `/app/installations/${env('GITHUB_APP_INSTALLATION_ID')}/access_tokens`,
    { method: 'POST', body: { repositories: [env('CI_REPO_NAME')] } }
  );
  return token;
}

if (process.argv[1] === NodeURL.fileURLToPath(import.meta.url)) {
  console.log(await githubToken());
}
