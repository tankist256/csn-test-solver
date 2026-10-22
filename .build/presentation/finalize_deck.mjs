import path from 'node:path';
import { pathToFileURL } from 'node:url';
const SKILL_DIR = '/Users/xkyota/.codex/plugins/cache/openai-primary-runtime/presentations/26.1020.11127/skills/Presentations';
const workspaceDir = '/Users/xkyota/Development/csn-test-solver';
const candidatePath = path.join(workspaceDir, '.build/presentation/draft.pptx');
const FINAL_PPTX = path.join(workspaceDir, 'output/CSDD_teorija_projekta_nedela.pptx');
const { finalizePresentation } = await import(pathToFileURL(path.join(SKILL_DIR, 'container_tools/artifact_tool_utils.mjs')).href);
const result = await finalizePresentation({
  workspaceDir,
  candidatePath,
  finalPath: FINAL_PPTX,
  pythonExecutable: '/Users/xkyota/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3',
  integrityValidatorPath: path.join(SKILL_DIR, 'container_tools/inspect_presentation_package_integrity.py'),
  layoutValidatorPath: path.join(SKILL_DIR, 'container_tools/inspect_presentation_layout_geometry.py'),
  layoutArgs: ['--expected-slide-size-emu', '12192000,6858000', '--validate-bullet-geometry', '--validate-heading-fit'],
  requiredNativeTableOwnerSlides: [],
  fontPolicy: { basis: 'design', families: ['Arial'] },
  verifyArtifactToolImport: true,
  receiptPath: path.join(workspaceDir, '.build/presentation/CSDD_teorija_projekta_nedela.validation.json'),
});
console.log(JSON.stringify(result));
