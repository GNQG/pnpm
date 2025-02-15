import util from 'util'
import fs, { type Stats } from 'fs'
import path from 'path'
import {
  type AddToStoreResult,
  type FilesIndex,
  type FileWriteResult,
} from '@pnpm/cafs-types'
import gfs from '@pnpm/graceful-fs'
import { type DependencyManifest } from '@pnpm/types'
import { parseJsonBufferSync } from './parseJson'

export function addFilesFromDir (
  addBuffer: (buffer: Buffer, mode: number) => FileWriteResult,
  dirname: string,
  opts: {
    files?: string[]
    readManifest?: boolean
  } = {}
): AddToStoreResult {
  const filesIndex: FilesIndex = {}
  let manifest: DependencyManifest | undefined
  let files: File[]
  if (opts.files) {
    files = []
    for (const file of opts.files) {
      const absolutePath = path.join(dirname, file)
      let stat: Stats
      try {
        stat = fs.statSync(absolutePath)
      } catch (err: unknown) {
        if (!(util.types.isNativeError(err) && 'code' in err && err.code === 'ENOENT')) {
          throw err
        }
        continue
      }
      files.push({
        absolutePath,
        relativePath: file,
        stat,
      })
    }
  } else {
    files = findFilesInDir(dirname)
  }
  for (const { absolutePath, relativePath, stat } of files) {
    const buffer = gfs.readFileSync(absolutePath)
    if (opts.readManifest && relativePath === 'package.json') {
      manifest = parseJsonBufferSync(buffer) as DependencyManifest
    }
    // Remove the file type information (regular file, directory, etc.) and leave just the permission bits (rwx for owner, group, and others)
    const mode = stat.mode & 0o777
    filesIndex[relativePath] = {
      mode,
      size: stat.size,
      ...addBuffer(buffer, mode),
    }
  }
  return { manifest, filesIndex }
}

interface File {
  relativePath: string
  absolutePath: string
  stat: Stats
}

function findFilesInDir (dir: string): File[] {
  const files: File[] = []
  findFiles(files, dir)
  return files
}

function findFiles (
  filesList: File[],
  dir: string,
  relativeDir = ''
): void {
  const files = fs.readdirSync(dir, { withFileTypes: true })
  for (const file of files) {
    const relativeSubdir = `${relativeDir}${relativeDir ? '/' : ''}${file.name}`
    if (file.isDirectory()) {
      if (relativeDir !== '' || file.name !== 'node_modules') {
        findFiles(filesList, path.join(dir, file.name), relativeSubdir)
      }
      continue
    }
    const absolutePath = path.join(dir, file.name)
    let stat: Stats
    try {
      stat = fs.statSync(absolutePath)
    } catch (err: any) { // eslint-disable-line
      if (err.code !== 'ENOENT') {
        throw err
      }
      continue
    }
    if (stat.isDirectory()) {
      findFiles(filesList, path.join(dir, file.name), relativeSubdir)
      continue
    }
    filesList.push({
      relativePath: relativeSubdir,
      absolutePath,
      stat,
    })
  }
}
