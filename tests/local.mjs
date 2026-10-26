// What some tests need from outside this repository: the runtime's XML checker and its sources (the Animation
// Injector repository, https://github.com/skypia0147-dev/Animation-Injector). They default to a checkout beside this
// one (../AnimationInjector, built in build/Release); AIE_XMLCHECK and AIE_RUNTIME_SRC point elsewhere. A test that
// needs one is skipped, with the reason, when it is missing.
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';

const slashes = path => path.replaceAll('\\', '/');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const runtimeSource = slashes(process.env.AIE_RUNTIME_SRC || join(root, '..', 'AnimationInjector'));
export const checker = slashes(
  process.env.AIE_XMLCHECK || join(runtimeSource, 'build', 'Release', 'AnimationInjectorXmlCheck.exe')
);
export const needsChecker = {
  skip: existsSync(checker) ? false : `runtime checker not found (${checker}); set AIE_XMLCHECK`,
};
export const needsRuntimeSource = {
  skip: existsSync(join(runtimeSource, 'src'))
    ? false
    : `runtime sources not found (${runtimeSource}); set AIE_RUNTIME_SRC`,
};
// An installed Grapple mod's XML (.../mods/Grapple/SKSE/Plugins/AnimationInjector/Grapple/Grapple.xml) for the
// tests that read a real project and its HKX; unset, they are skipped.
export const grappleXml = slashes(process.env.AIE_GRAPPLE_XML || '');
export const grappleMod = grappleXml && slashes(join(dirname(grappleXml), '..', '..', '..', '..'));
export const needsGrapple = {
  skip: grappleXml && existsSync(grappleXml) ? false : 'set AIE_GRAPPLE_XML to an installed Grapple.xml',
};
