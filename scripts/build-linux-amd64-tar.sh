#!/usr/bin/env bash
set -euo pipefail

TAG="${TAG:-v0.1.0-amd64}"
IMAGE="${IMAGE:-kylin-x86-png-mcp:${TAG}}"
OUT_DIR="${OUT_DIR:-dist}"
TAR_FILE="${OUT_DIR}/kylin-x86-png-mcp-${TAG}-linux-amd64.tar.gz"

mkdir -p "${OUT_DIR}"

docker buildx build \
  --platform linux/amd64 \
  -f Dockerfile \
  -t "${IMAGE}" \
  --load .

test "$(docker image inspect "${IMAGE}" --format '{{.Os}}/{{.Architecture}}')" = "linux/amd64"
docker run --rm --platform linux/amd64 "${IMAGE}" rsvg-convert --version
docker run --rm --platform linux/amd64 "${IMAGE}" node scripts/smoke-render.js

docker save "${IMAGE}" | gzip -9 > "${TAR_FILE}"

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "${TAR_FILE}" > "${TAR_FILE}.sha256"
else
  shasum -a 256 "${TAR_FILE}" > "${TAR_FILE}.sha256"
fi

echo "Wrote ${TAR_FILE}"
echo "Wrote ${TAR_FILE}.sha256"
