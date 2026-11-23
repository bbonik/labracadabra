#!/usr/bin/env bash
# Build the extractor Lambda bundle (linux/arm64 wheels) without Docker.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
out="$here/build/lambda"
rm -rf "$out" && mkdir -p "$out"
uv pip install --quiet --target "$out" --python-version 3.12 --python-platform aarch64-manylinux2014 \
  --only-binary=:all: "anthropic>=1.0" "pydantic>=2.7" "pyyaml>=6.0" "pypdf>=5.0" "cryptography>=42"
cp -R "$here/../extractor/pmt" "$out/pmt"
rm -rf "$out/pmt/__pycache__"
cp -R "$here/../catalog" "$out/pmt/catalog"   # catalog travels with the code
echo "lambda bundle: $(du -sh "$out" | cut -f1)"
