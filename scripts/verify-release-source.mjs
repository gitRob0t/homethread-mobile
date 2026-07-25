import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const expectedBranch = process.env.COHO_RELEASE_BRANCH || 'agent/chat-keyboard-homebot';
const expectedRef = process.env.COHO_RELEASE_REF || `origin/${expectedBranch}`;

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function fail(message) {
  console.error(`\nRelease source check failed: ${message}\n`);
  process.exit(1);
}

let branch;
try {
  branch = git('branch', '--show-current');
} catch {
  fail('this directory is not a readable Git checkout.');
}

if (branch !== expectedBranch) {
  fail(`expected branch "${expectedBranch}", but this folder is on "${branch || 'detached HEAD'}".`);
}

const status = git('status', '--porcelain');
if (status) {
  fail(`the working tree is not clean:\n${status}`);
}

let localTree;
let remoteTree;
try {
  localTree = git('rev-parse', 'HEAD^{tree}');
  remoteTree = git('rev-parse', `${expectedRef}^{tree}`);
} catch {
  fail(`the verified remote ref "${expectedRef}" is unavailable. Run the build script so it can fetch first.`);
}

if (localTree !== remoteTree) {
  fail(`this folder does not match ${expectedRef}. Pull the latest source before building.`);
}

const trackedRuntimeFiles = git('ls-files')
  .split('\n')
  .filter((file) => file === 'App.tsx' || /^src\/.*\.(?:ts|tsx|js|jsx|json)$/.test(file));
const runtimeSource = trackedRuntimeFiles
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

const forbiddenDemoContent = [
  'Leave for Pennsylvania',
  "Arrive at Harvey's Lake",
  'Knoebels family day',
  'Three events, two open chores',
  'Can someone grab Oliver',
  'Your morning recap is ready',
];

const foundDemoContent = forbiddenDemoContent.filter((value) => runtimeSource.includes(value));
if (foundDemoContent.length) {
  fail(`known prototype data is still present in runtime source:\n- ${foundDemoContent.join('\n- ')}`);
}

const appSource = readFileSync('App.tsx', 'utf8');
const requiredProductionContracts = [
  ['Command Center', 'the production Command Center'],
  ['Family chat', 'the separate Family chat workspace'],
  ['Ask Coh', 'the separate Coh workspace'],
  ['integrationCategoryGrid', 'the categorized integrations hub'],
  ['moreGrid', 'the consolidated More grid'],
];

const missingContracts = requiredProductionContracts
  .filter(([marker]) => !appSource.includes(marker))
  .map(([, description]) => description);
if (missingContracts.length) {
  fail(`required production UI contracts are missing:\n- ${missingContracts.join('\n- ')}`);
}

console.log(`Release source verified: ${branch} (${git('rev-parse', '--short=12', 'HEAD')})`);
