// Prints the tag of upstream's latest published release, the base the sync
// pipeline keeps `self-hosted` on.
const response = await fetch(
  'https://api.github.com/repos/router-for-me/Cli-Proxy-API-Management-Center/releases/latest',
  {
    headers: { accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(30_000),
  }
);
if (!response.ok) {
  throw new Error(`Cannot resolve the upstream release: GitHub answered ${response.status}.`);
}
// The latest endpoint already excludes drafts and prereleases.
const { tag_name: tag } = await response.json();
if (typeof tag !== 'string' || !/^v\d+\.\d+\.\d+$/.test(tag)) {
  throw new Error(`Upstream's latest release has an unexpected tag: ${tag}`);
}
console.log(tag);
