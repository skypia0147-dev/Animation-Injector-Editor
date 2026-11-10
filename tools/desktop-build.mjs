// Builds the desktop exe (`tauri build --no-bundle`) with the builder's own directories remapped out of the paths
// rustc embeds. Panic locations in dependencies carry the absolute path of the cargo registry, which sits under the
// home directory, so an unmapped build ships the builder's account name inside the exe.
import {spawnSync} from 'node:child_process';
import {homedir} from 'node:os';

// Longest prefix last: rustc applies the last matching --remap-path-prefix.
const remaps = [
  [homedir(), '~'],
  [process.env.RUSTUP_HOME, '~/.rustup'],
  [process.env.CARGO_HOME, '~/.cargo'],
].filter(([from]) => from);

// CARGO_ENCODED_RUSTFLAGS separates arguments with 0x1f, so a home directory with spaces survives. It replaces
// RUSTFLAGS, so flags already set there are carried over.
const flags = [
  ...(process.env.CARGO_ENCODED_RUSTFLAGS?.split('\x1f') ?? process.env.RUSTFLAGS?.split(/\s+/) ?? []).filter(Boolean),
  ...remaps.map(([from, to]) => `--remap-path-prefix=${from}=${to}`),
];

const result = spawnSync('npx', ['tauri', 'build', '--no-bundle', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env: {...process.env, CARGO_ENCODED_RUSTFLAGS: flags.join('\x1f')},
});
process.exit(result.status ?? 1);
