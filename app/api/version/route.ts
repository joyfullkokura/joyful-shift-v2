import { currentDeploymentId } from '@/lib/deployment'

// The deployment currently serving requests. Public on purpose: it holds no
// user data, only an identifier also visible in asset URLs (?dpl=...).
export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json(
    { deploymentId: currentDeploymentId() ?? null },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  )
}
