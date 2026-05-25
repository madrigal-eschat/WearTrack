#!/bin/bash
set -euo pipefail

# Create/update image pull secret for the GitLab container registry.
# Uses the CI job token (valid for the duration of this pipeline run),
# so the secret is always fresh and requires no manual credential management.
kubectl create secret docker-registry ${K8S_IMAGE_PULL_SECRET_NAME} \
  --docker-server="${CI_REGISTRY}" \
  --docker-username="${CI_REGISTRY_USER}" \
  --docker-password="${CI_REGISTRY_PASSWORD}" \
  --namespace="${k8s_namespace}" \
  --dry-run=client -o yaml | kubectl apply -f -
