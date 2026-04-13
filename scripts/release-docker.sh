#!/bin/bash
# Release Docker images to ghcr.io
# Usage: ./scripts/release-docker.sh [version]
# Example: ./scripts/release-docker.sh 2.2.0

set -euo pipefail

REGISTRY="ghcr.io/profclaw/profclaw"
VERSION="${1:-}"

if [ -z "$VERSION" ]; then
  VERSION=$(node -p "require('./package.json').version")
  echo "No version specified, using package.json: $VERSION"
fi

echo "=== Release Docker images v$VERSION ==="
echo ""

# Check Docker login
if ! docker info 2>/dev/null | grep -q "Username"; then
  echo "Not logged into Docker. Logging in..."
  echo "$(gh auth token)" | docker login ghcr.io -u "$(gh api user -q .login)" --password-stdin
fi

# Build main image
echo "Building main image..."
docker build -t "$REGISTRY:latest" -t "$REGISTRY:$VERSION" .
echo "  done."

# Build pico image
echo "Building pico image..."
docker build -f Dockerfile.pico -t "$REGISTRY:pico" -t "$REGISTRY:$VERSION-pico" .
echo "  done."

# Show image sizes
echo ""
echo "Image sizes:"
docker images --format "  {{.Repository}}:{{.Tag}}\t{{.Size}}" | grep profclaw | sort

echo ""
read -p "Push to $REGISTRY? (y/N) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo "Pushing main..."
  docker push "$REGISTRY:latest"
  docker push "$REGISTRY:$VERSION"

  echo "Pushing pico..."
  docker push "$REGISTRY:pico"
  docker push "$REGISTRY:$VERSION-pico"

  echo ""
  echo "Done. Published:"
  echo "  $REGISTRY:latest"
  echo "  $REGISTRY:$VERSION"
  echo "  $REGISTRY:pico"
  echo "  $REGISTRY:$VERSION-pico"
else
  echo "Skipped push. Images are built locally."
fi
