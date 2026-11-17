import type { NextConfig } from 'next'
import { currentDeploymentId } from './lib/deployment'

const nextConfig: NextConfig = {
  // Version skew: a client from an older deployment gets a full reload on its
  // next navigation instead of calling Server Functions that no longer exist.
  // (Screens left open are told by the reload banner, see VersionWatcher.)
  deploymentId: currentDeploymentId(),
}

export default nextConfig
