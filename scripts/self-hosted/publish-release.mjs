// Publishes .sync/management.html as the latest GitHub release of CI_REPO,
// tagged with .sync/version at CI_COMMIT_SHA. CPA's panel updater installs
// the `management.html` asset of a repository's latest release whenever its
// digest differs from the local file.
import * as NodeCrypto from 'node:crypto';
import * as NodeFS from 'node:fs';
import { githubRequest, githubToken } from './github-app.mjs';

const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
};

const tag = NodeFS.readFileSync('.sync/version', 'utf8').trim();
const notes = NodeFS.readFileSync('.sync/release-notes.md', 'utf8');
const html = NodeFS.readFileSync('.sync/management.html');
const digest = `sha256:${NodeCrypto.createHash('sha256').update(html).digest('hex')}`;

const token = await githubToken();
const root = `/repos/${env('CI_REPO')}`;

// The releases-by-tag endpoint omits drafts, which a failed earlier attempt leaves.
const releases = await githubRequest(token, `${root}/releases?per_page=100`);
let release = releases.find((candidate) => candidate.tag_name === tag);
if (release && !release.draft) {
  if (release.assets.some((asset) => asset.name === 'management.html' && asset.digest === digest)) {
    console.log(`${tag} is already published with this build.`);
    process.exit(0);
  }
  throw new Error(`${tag} is already published with a different management.html.`);
}

// The release stays a draft until it holds the build: a published release's
// assets may be immutable, and CPA must never see it without one.
release ??= await githubRequest(token, `${root}/releases`, {
  method: 'POST',
  body: { tag_name: tag, target_commitish: env('CI_COMMIT_SHA'), name: tag, body: notes, draft: true },
});
for (const stale of release.assets.filter((asset) => asset.name === 'management.html')) {
  await githubRequest(token, `${root}/releases/assets/${stale.id}`, { method: 'DELETE' });
}

const upload = await fetch(
  `https://uploads.github.com${root}/releases/${release.id}/assets?name=management.html`,
  {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'text/html',
      'x-github-api-version': '2022-11-28',
    },
    body: html,
    signal: AbortSignal.timeout(120_000),
  }
);
if (!upload.ok) {
  throw new Error(`Uploading management.html answered ${upload.status}: ${await upload.text()}`);
}
const asset = await upload.json();
if (asset.digest !== digest) {
  throw new Error(`GitHub stored management.html as ${asset.digest}, not ${digest}.`);
}

const published = await githubRequest(token, `${root}/releases/${release.id}`, {
  method: 'PATCH',
  body: { draft: false, make_latest: 'true' },
});
console.log(`Published ${published.html_url} (${digest})`);
