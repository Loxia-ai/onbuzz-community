#!/bin/bash
# =============================================================================
# Setup Azure Container Registry + Resource Group for Remote Sessions
# Run once to create the infrastructure.
# =============================================================================

set -e

# Configuration
REGISTRY_NAME="loxiaregistry"
RESOURCE_GROUP="loxia-remote-sessions"
LOCATION="northeurope"
SKU="Basic"  # Basic tier is cheapest (~$5/month, 10GB storage)

echo "============================================"
echo " Loxia Remote Sessions — Azure Infrastructure Setup"
echo "============================================"
echo ""

# 1. Create resource group for remote sessions
echo "Creating resource group: $RESOURCE_GROUP..."
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --output table

# 2. Create Azure Container Registry
echo ""
echo "Creating Azure Container Registry: $REGISTRY_NAME..."
az acr create \
  --name "$REGISTRY_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku "$SKU" \
  --admin-enabled true \
  --output table

# 3. Get registry credentials (for ACI to pull images)
echo ""
echo "Registry credentials:"
az acr credential show \
  --name "$REGISTRY_NAME" \
  --output table

echo ""
echo "Registry login server:"
az acr show --name "$REGISTRY_NAME" --query loginServer --output tsv

echo ""
echo "============================================"
echo " Setup complete!"
echo ""
echo " Next steps:"
echo "   1. Build & push the Docker image:"
echo "      ./scripts/push-image.sh"
echo ""
echo "   2. Set these env vars on the autopilot-backend:"
echo "      ACI_SUBSCRIPTION_ID=<your-subscription-id>"
echo "      ACI_RESOURCE_GROUP=$RESOURCE_GROUP"
echo "      ACI_REGION=$LOCATION"
echo "      ACI_IMAGE=${REGISTRY_NAME}.azurecr.io/loxia-autopilot:latest"
echo "      ACI_REGISTRY_SERVER=${REGISTRY_NAME}.azurecr.io"
echo "      ACI_REGISTRY_USERNAME=<from credentials above>"
echo "      ACI_REGISTRY_PASSWORD=<from credentials above>"
echo "============================================"
