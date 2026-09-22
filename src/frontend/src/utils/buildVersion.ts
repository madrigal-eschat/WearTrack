export type BuildVersion = { version: string; commit: string }

function normalizeValue(value: string | undefined): string {
  const normalized = value?.trim()
  return normalized || 'unknown'
}

export function normalizeBuildVersion(input: Partial<BuildVersion>): BuildVersion {
  return {
    version: normalizeValue(input.version),
    commit: normalizeValue(input.commit),
  }
}

export const frontendBuildVersion: BuildVersion = normalizeBuildVersion({
  version: import.meta.env.VITE_APP_VERSION,
  commit: import.meta.env.VITE_COMMIT_HASH,
})
