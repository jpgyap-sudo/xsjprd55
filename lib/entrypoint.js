import { fileURLToPath } from 'url';
import path from 'path';

export function isMainModule(importMetaUrl, argv = process.argv) {
  const entry = argv?.[1];
  if (!entry) return false;

  return path.resolve(fileURLToPath(importMetaUrl)) === path.resolve(entry);
}
