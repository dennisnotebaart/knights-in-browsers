#!/bin/bash
# usage: fetch-assets.sh outdir name=id [name=id ...]
out=$1; shift; mkdir -p "$out"
for p in "$@"; do n=${p%%=*}; id=${p#*=}; curl -sSL --retry 4 --retry-delay 2 -o "$out/$n.png" "https://asset.imagine.art/processed/$id" && echo "$n ok $(stat -c%s "$out/$n.png")" || echo "$n FAILED"; done
