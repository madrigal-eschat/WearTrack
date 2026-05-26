#!/bin/bash
set -euo pipefail

# After applying manifests, force a rollout restart so pods always pick up the
# latest image even when the manifest itself hasn't changed (image tag is fixed
# to :main and imagePullPolicy is Always).
if [ "${environment_type}" = "production" ]; then
  kubectl rollout restart deployment/weartrack \
    --namespace="${k8s_namespace}"
  kubectl rollout status deployment/weartrack \
    --namespace="${k8s_namespace}" \
    --timeout=120s
fi
