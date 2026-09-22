export type BuildVersion = { version: string; commit: string }
export type FrontendBuildEnv = {
  VITE_APP_VERSION?: string
  VITE_COMMIT_HASH?: string
}

function normalizeValue(value: string | undefined): string {
  const normalized = value?.trim()
  return normalized || 'unknown'
}

export function normalizeBuildVersion(
  input: Partial<BuildVersion>,
): BuildVersion {
  return {
    version: normalizeValue(input.version),
    commit: normalizeValue(input.commit),
  }
}

export function buildFrontendVersion(env: FrontendBuildEnv): BuildVersion {
  return normalizeBuildVersion({
    version: env.VITE_APP_VERSION,
    commit: env.VITE_COMMIT_HASH,
  })
}

export const frontendBuildVersion: BuildVersion = buildFrontendVersion({
  VITE_APP_VERSION: import.meta.env.VITE_APP_VERSION,
  VITE_COMMIT_HASH: import.meta.env.VITE_COMMIT_HASH,
})
