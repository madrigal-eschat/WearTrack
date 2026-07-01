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

# The k8s component's ${VAR}/%{VAR} manifest substitution doesn't reach
# these files reliably, so substitute the CI variables ourselves before
# kustomize builds the manifests.
sed -i \
  -e "s|\${CI_REGISTRY_IMAGE}|${CI_REGISTRY_IMAGE}|g" \
  -e "s|\${CI_COMMIT_REF_NAME}|${CI_COMMIT_REF_NAME}|g" \
  -e "s|\${K8S_NODE_HOSTNAME}|${K8S_NODE_HOSTNAME}|g" \
  -e "s|\${K8S_IMAGE_PULL_SECRET_NAME}|${K8S_IMAGE_PULL_SECRET_NAME}|g" \
  -e "s|\${K8S_INGRESS_HOST}|${K8S_INGRESS_HOST}|g" \
  -e "s|\${K8S_INGRESS_AUTH_MIDDLEWARE}|${K8S_INGRESS_AUTH_MIDDLEWARE}|g" \
  "${CI_PROJECT_DIR}/k8s/production/deployment.yaml" "${CI_PROJECT_DIR}/k8s/production/ingress.yaml"
