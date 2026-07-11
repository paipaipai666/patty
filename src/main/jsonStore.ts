import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, copyFileSync } from 'fs'
import { join } from 'path'

export function loadJsonSync<T>(filePath: string, defaults: T, merge?: (parsed: Record<string, unknown>, defaults: T) => T): T {
  if (!existsSync(filePath)) return { ...defaults } as T
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    return merge ? merge(parsed, defaults) : ({ ...defaults, ...parsed } as T)
  } catch {
    return { ...defaults } as T
  }
}

export function saveAtomicSync(filePath: string, data: unknown): void {
  const dir = join(filePath, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = filePath + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  renameSync(tmp, filePath)
}

export function migrateOldDataSync(userDataPath: string, fileName: string, oldAppName: string): void {
  const currentFile = join(userDataPath, fileName)
  if (existsSync(currentFile)) return
  const oldDir = userDataPath.replace(/[/\\]patty$/, `/${oldAppName}`)
  const oldFile = join(oldDir, fileName)
  if (existsSync(oldFile)) {
    try {
      if (!existsSync(userDataPath)) mkdirSync(userDataPath, { recursive: true })
      copyFileSync(oldFile, currentFile)
      console.log('Migrated', fileName, 'from', oldFile, 'to', currentFile)
    } catch (err) {
      console.error('Failed to migrate', fileName, err)
    }
  }
}
