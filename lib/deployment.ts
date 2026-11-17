// The deployment this build belongs to. Used by next.config (deploymentId, so
// that Next.js reloads on navigation when the client is older than the server)
// and by /api/version (so that an open screen can notice a newer deployment).
// Vercel provides both variables at build time and at run time; locally there
// is none and version checks are off.

export const currentDeploymentId = (): string | undefined =>
  process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || undefined
