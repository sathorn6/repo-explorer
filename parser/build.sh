#!/usr/bin/env bash

set -e

wasm-pack build --target web
# Remove this line because we don't need it and it doesn't work our my environment
sed -i "/import\.meta/d" pkg/rsgit.js
cp pkg/rsgit_bg.wasm ../dist/
rm -rf ../src/pkg
cp -r pkg ../src/pkg
