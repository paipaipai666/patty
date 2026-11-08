import { cp, lstat, readFile, writeFile, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../output/omp-navigation/node_modules/@oh-my-pi/pi-coding-agent')
if ((await lstat(root)).isSymbolicLink()) throw new Error('OMP patch target must be an isolated copy')
const tuiRoot = resolve(here, '../../output/omp-navigation/node_modules/@oh-my-pi/pi-tui')
if ((await lstat(tuiRoot)).isSymbolicLink()) throw new Error('TUI patch target must be an isolated copy')
const project = await realpath(resolve(here, '../..'))
const expectedParent = join(project, 'output/omp-navigation/node_modules/@oh-my-pi').toLowerCase()
for (const target of [root, tuiRoot]) if (!(await realpath(target)).toLowerCase().startsWith(expectedParent + sep)) throw new Error('Patch target escaped project output')
const controller = join(root, 'src/modes/controllers')
async function assertOwned(file) {
  const parent = (await realpath(dirname(file))).toLowerCase()
  if (!parent.startsWith(expectedParent + sep)) throw new Error(`Patch parent escaped workspace: ${file}`)
  try {
    if ((await lstat(file)).isSymbolicLink()) throw new Error(`Patch file must not be a link: ${file}`)
    if (!(await realpath(file)).toLowerCase().startsWith(expectedParent + sep)) throw new Error(`Patch file escaped workspace: ${file}`)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
}
const companionFiles = ['native-navigation.ts', 'navigation-api.ts', 'markdown-range.ts', 'canonical-renderer.ts', 'progressive-highlight.ts', 'highlight-worker.ts', 'markdown-source-map.ts']
for (const name of companionFiles) { await assertOwned(join(controller, name)); await cp(join(here, name), join(controller, name)) }
await assertOwned(join(tuiRoot, 'src/components/markdown-source-map.ts'))
await cp(join(here, 'markdown-source-map.ts'), join(tuiRoot, 'src/components/markdown-source-map.ts'))
const declaration = (await readFile(join(here, 'navigation-api.ts'), 'utf8')).split('export function scalarToCodeUnit')[0]
await assertOwned(join(root, 'dist/types/modes/controllers/navigation-api.d.ts'))
await writeFile(join(root, 'dist/types/modes/controllers/navigation-api.d.ts'), declaration)
const changes = [
  {
    file: '../pi-tui/src/components/markdown.ts',
    before: 'import { LRUCache } from "@oh-my-pi/pi-utils/lru";',
    after: 'import { MarkdownSourceMap } from "./markdown-source-map";\nimport { LRUCache } from "@oh-my-pi/pi-utils/lru";',
  },
  {
    file: '../pi-tui/src/components/markdown.ts',
    before: '\tsetIgnoreTight(ignore: boolean): this {',
    after: '\t#sourceMapping = false;\n\t#sourceMap: MarkdownSourceMap | undefined;\n\tsetSourceMapping(enabled: boolean): void {\n\t\tthis.#sourceMapping = enabled;\n\t\tthis.invalidate();\n\t}\n\tsetRenderTheme(theme: MarkdownTheme): void {\n\t\tthis.#theme = theme;\n\t\tthis.invalidate();\n\t}\n\tsetIgnoreTight(ignore: boolean): this {',
  },
  {
    file: '../pi-tui/dist/types/components/markdown.d.ts',
    before: '    setIgnoreTight(ignore: boolean): this;',
    after: '    setSourceMapping(enabled: boolean): void;\n    setRenderTheme(theme: MarkdownTheme): void;\n    setIgnoreTight(ignore: boolean): this;',
  },
  {
    file: '../pi-tui/src/components/markdown.ts',
    before: '\t\tconst tokens = speculated ? [...lexed.slice(0, -1), speculated] : lexed;',
    after: '\t\tconst tokens = speculated ? [...lexed.slice(0, -1), speculated] : lexed;\n\t\tif (this.#sourceMapping) { this.#sourceMap = new MarkdownSourceMap(this.#text); this.#sourceMap.index(tokens); }',
  },
  {
    file: '../pi-tui/src/components/markdown.ts',
    before: 'return `${normalizedText}\\x00${signature.width}',
    after: 'return `${this.#sourceMapping ? "mapped" : "plain"}\\x00${normalizedText}\\x00${signature.width}',
  },
  {
    file: '../pi-tui/src/components/markdown.ts',
    before: '\t\tfor (const token of collapseInlineHtml(tokens)) {',
    after: '\t\tfor (const token of collapseInlineHtml(tokens)) {\n\t\t\tconst sourceStart = result.length;',
  },
  {
    file: '../pi-tui/src/components/markdown.ts',
    before: '\t\t}\n\n\t\t// Strip dangling re-opened-default SGR prefix',
    after: '\t\t\tif (this.#sourceMap) result = result.slice(0, sourceStart) + this.#sourceMap.mark(token, result.slice(sourceStart));\n\t\t}\n\n\t\t// Strip dangling re-opened-default SGR prefix',
  },
  {
    file: '../pi-tui/src/components/markdown.ts',
    before: '\t\tconst addBodyLine = (line: string): void => {',
    after: '\t\tlet sourceLine = 0;\n\t\tconst addBodyLine = (line: string): void => {',
  },
  {
    file: '../pi-tui/src/components/markdown.ts',
    before: '\t\t\tbodyLines.push(renderedLine(literalCode ? linked : codeIndent + linked, literalCode));',
    after: '\t\t\tconst painted = literalCode ? linked : codeIndent + linked;\n\t\t\tbodyLines.push(renderedLine(this.#sourceMap?.codeLine(token, painted, sourceLine++) ?? painted, literalCode));',
  },
  {
    file: 'src/modes/controllers/extension-ui-controller.ts',
    before: 'const MAX_WIDGET_LINES = 10;',
    after: 'import { TranscriptNavigationController } from "./native-navigation";\nimport { CanonicalBranchIndex } from "./canonical-renderer";\n\nconst MAX_WIDGET_LINES = 10;',
  },
  {
    file: 'src/modes/controllers/extension-ui-controller.ts',
    before: '\t#toolUIContext: ExtensionUIContext | undefined;',
    after: '\t#toolUIContext: ExtensionUIContext | undefined;\n\t#transcriptNavigation: TranscriptNavigationController | undefined;\n\t#transcriptIndex = new CanonicalBranchIndex();',
  },
  {
    file: 'src/modes/controllers/extension-ui-controller.ts',
    before: '\t\tconst uiContext: ExtensionUIContext = {',
    after: '\t\tthis.#transcriptNavigation ??= new TranscriptNavigationController({ ui: this.ctx.ui, entries: () => this.#transcriptIndex.read(this.ctx.sessionManager.getBranchView(), { cwd: this.ctx.sessionManager.getCwd(), getTool: name => this.ctx.session.getToolByName(name), isBuiltInTool: name => this.ctx.session.hasBuiltInTool(name), getMessageRenderer: type => this.ctx.session.extensionRunner?.getMessageRenderer(type), expandThinkingBlocks: () => true }), sessionId: () => this.ctx.sessionManager.getSessionId(), revision: () => this.ctx.sessionManager.getSessionId() + ":" + this.ctx.sessionManager.getLeafId(), branchIdentity: () => this.ctx.sessionManager.getBranchView(), subscribe: listener => this.ctx.session.subscribe(() => listener()), resumeLive: () => { this.ctx.ui.requestRender(true); } });\n\t\tconst navigation = this.#transcriptNavigation;\n\t\tnavigation.refresh();\n\t\tconst uiContext: ExtensionUIContext = {\n\t\t\ttranscript: navigation,',
  },
  {
    file: 'src/extensibility/extensions/types.ts',
    before: 'export interface ExtensionUIContext {',
    after: 'export interface ExtensionUIContext {\n\ttranscript?: import("../../modes/controllers/navigation-api").TranscriptNavigationApi;',
  },
]
changes.push({ ...changes[changes.length - 1], file: 'dist/types/extensibility/extensions/types.d.ts' })
changes.push(
  {
    file: 'src/modes/controllers/extension-ui-controller.ts',
    before: '\tclearExtensionTerminalInputListeners(): void {',
    after: '\tdisposeTranscriptNavigation(): void {\n\t\tthis.#transcriptNavigation?.dispose();\n\t\tthis.#transcriptNavigation = undefined;\n\t}\n\tclearExtensionTerminalInputListeners(): void {',
  },
  {
    file: 'src/modes/interactive-mode.ts',
    before: '\t\tthis.#extensionUiController.clearExtensionTerminalInputListeners();\n\t\tthis.#extensionUiController.clearHookWidgets();\n\t\tthis.#extensionUiController.disposeComposerShapes();',
    after: '\t\tthis.#extensionUiController.disposeTranscriptNavigation();\n\t\tthis.#extensionUiController.clearExtensionTerminalInputListeners();\n\t\tthis.#extensionUiController.clearHookWidgets();\n\t\tthis.#extensionUiController.disposeComposerShapes();',
  },
  {
    file: 'src/modes/controllers/extension-ui-controller.ts',
    before: '\t\tlet hide: (() => void) | undefined;',
    after: '\t\tlet hide: (() => void) | undefined;\n\t\tlet resumeNavigation: (() => void) | undefined;',
  },
  {
    file: 'src/modes/controllers/extension-ui-controller.ts',
    before: '\t\t\t\thide?.();',
    after: '\t\t\t\thide?.();\n\t\t\t\tresumeNavigation?.();',
  },
  {
    file: 'src/modes/controllers/extension-ui-controller.ts',
    before: '\t\t\t\thide = present(settle);',
    after: '\t\t\t\tresumeNavigation = this.#transcriptNavigation?.suspendForModal();\n\t\t\t\thide = present(settle);',
  },
  {
    file: 'src/modes/controllers/extension-ui-controller.ts',
    before: '\t\t\t\treject(error);\n\t\t\t\tthis.#advanceDialogQueue();',
    after: '\t\t\t\tresumeNavigation?.();\n\t\t\t\treject(error);\n\t\t\t\tthis.#advanceDialogQueue();',
  },
  {
    file: 'src/modes/controllers/extension-ui-controller.ts',
    before: '\t\tconst savedText = this.ctx.editor.getText();',
    after: '\t\tconst resumeNavigation = this.#transcriptNavigation?.suspendForModal();\n\t\tconst savedText = this.ctx.editor.getText();',
  },
  {
    file: 'src/modes/controllers/extension-ui-controller.ts',
    before: '\t\t\t\tcleanup();',
    after: '\t\t\t\tcleanup();\n\t\t\t\tresumeNavigation?.();',
  },
)
const manifest = []
for (const change of changes) {
  const file = join(root, change.file)
  await assertOwned(file)
  let source = await readFile(file, 'utf8')
  if (change.file === 'src/modes/controllers/extension-ui-controller.ts') {
    const previous = '\tclearExtensionTerminalInputListeners(): void {\n\t\tthis.#transcriptNavigation?.dispose();\n\t\tthis.#transcriptNavigation = undefined;'
    if (source.includes(previous)) { source = source.replace(previous, '\tclearExtensionTerminalInputListeners(): void {'); await writeFile(file, source) }
  }
  if (source.includes(change.after)) continue
  if (source.split(change.before).length !== 2) throw new Error(`OMP patch anchor mismatch: ${change.file}`)
  const patched = source.replace(change.before, change.after)
  await writeFile(file, patched)
  manifest.push({ file: change.file, before: createHash('sha256').update(source).digest('hex'), after: createHash('sha256').update(patched).digest('hex') })
}
const finalFiles = await Promise.all([...new Set(changes.map(change => change.file))].map(async file => ({ file, sha256: createHash('sha256').update(await readFile(join(root, file))).digest('hex') })))
for (const name of companionFiles) finalFiles.push({ file: `src/modes/controllers/${name}`, sha256: createHash('sha256').update(await readFile(join(controller, name))).digest('hex') })
finalFiles.push({ file: '../pi-tui/src/components/markdown-source-map.ts', sha256: createHash('sha256').update(await readFile(join(tuiRoot, 'src/components/markdown-source-map.ts'))).digest('hex') })
await writeFile(resolve(here, '../../output/omp-navigation/patch-manifest.json'), JSON.stringify({ version: '18.13.3', files: finalFiles, appliedOperations: manifest.length }, null, 2) + '\n')
process.stdout.write(JSON.stringify({ patched: root, changes: manifest.length }) + '\n')
