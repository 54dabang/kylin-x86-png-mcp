#!/usr/bin/env bash
set -euo pipefail

TAG="${TAG:-v0.1.0-page64k}"
KYLIN_BASE_IMAGE="${KYLIN_BASE_IMAGE:-macrosan/kylin:v10-sp3-2403}"
IMAGE="kylin-offline-mcp-echarts:${TAG}-arm64-page64k"
OUT_DIR="${OUT_DIR:-dist}"
TAR_FILE="${OUT_DIR}/kylin-offline-mcp-echarts-${TAG}-linux-arm64-page64k.tar.gz"

mkdir -p "${OUT_DIR}"

if [[ "$(uname -m)" == "aarch64" ]]; then
  page_size="$(getconf PAGE_SIZE)"
  if [[ "${REQUIRE_PAGE64K:-1}" == "1" && "${page_size}" != "65536" ]]; then
    echo "ERROR: this host PAGE_SIZE is ${page_size}, expected 65536." >&2
    echo "Set REQUIRE_PAGE64K=0 only for non-final ARM64 smoke builds." >&2
    exit 1
  fi
fi

docker build \
  --platform linux/arm64 \
  --build-arg KYLIN_BASE_IMAGE="${KYLIN_BASE_IMAGE}" \
  -f Dockerfile.kylin \
  -t "${IMAGE}" .

test "$(docker image inspect "${IMAGE}" --format '{{.Os}}/{{.Architecture}}')" = "linux/arm64"
docker run --rm "${IMAGE}" node -e "const p=require('/app/package-lock.json'); const s=JSON.stringify(p); if (s.includes('@napi-rs/canvas') || s.includes('node_modules/canvas')) process.exit(1); console.log('no canvas native dependency')"
docker run --rm "${IMAGE}" rsvg-convert --version

docker save "${IMAGE}" | gzip -9 > "${TAR_FILE}"
sha256sum "${TAR_FILE}" > "${TAR_FILE}.sha256"

echo "Wrote ${TAR_FILE}"
echo "Wrote ${TAR_FILE}.sha256"
