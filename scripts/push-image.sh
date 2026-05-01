#!/bin/bash
# =============================================================================
# Build and push the Loxia Autopilot Docker image to ACR
# =============================================================================

set -e

REGISTRY_NAME="${ACR_REGISTRY:-loxiaregistry}"
IMAGE_NAME="loxia-autopilot"
TAG="${1:-latest}"
FULL_IMAGE="${REGISTRY_NAME}.azurecr.io/${IMAGE_NAME}:${TAG}"

echo "============================================"
echo " Building & pushing: ${FULL_IMAGE}"
echo "============================================"
echo ""

# Login to ACR
echo "Logging into ACR..."
az acr login --name "$REGISTRY_NAME"

# Build the image
echo ""
echo "Building Docker image..."
docker build -t "$FULL_IMAGE" .

# Also tag as latest if a specific tag was provided
if [ "$TAG" != "latest" ]; then
  docker tag "$FULL_IMAGE" "${REGISTRY_NAME}.azurecr.io/${IMAGE_NAME}:latest"
fi

# Push to ACR
echo ""
echo "Pushing to ACR..."
docker push "$FULL_IMAGE"
if [ "$TAG" != "latest" ]; then
  docker push "${REGISTRY_NAME}.azurecr.io/${IMAGE_NAME}:latest"
fi

echo ""
echo "============================================"
echo " Image pushed: ${FULL_IMAGE}"
echo "============================================"
