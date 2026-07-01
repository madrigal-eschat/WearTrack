#!/bin/bash
# shellcheck disable=SC2154  # k8s_namespace injected by the k8s CI component
set -euo pipefail

# Create/update image pull secret for the GitLab container registry.
# Uses a long-lived deploy token (K8S_REGISTRY_PULL_USER / K8S_REGISTRY_PULL_TOKEN)
# stored as group-level CI/CD variables, so the secret survives beyond the pipeline run.
kubectl create secret docker-registry "${K8S_IMAGE_PULL_SECRET_NAME}" \
  --docker-server="${CI_REGISTRY}" \
  --docker-username="${K8S_REGISTRY_PULL_USER}" \
  --docker-password="${K8S_REGISTRY_PULL_TOKEN}" \
  --namespace="${k8s_namespace}" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic weartrack-vapid \
  --from-literal=VAPID_PUBLIC_KEY="${VAPID_PUBLIC_KEY}" \
  --from-literal=VAPID_PRIVATE_KEY="${VAPID_PRIVATE_KEY}" \
  --from-literal=VAPID_SUBJECT="${VAPID_SUBJECT}" \
  --namespace="${k8s_namespace}" \
  --dry-run=client -o yaml | kubectl apply -f -
