#!/bin/bash
# Regenerate the pre-recorded pronunciation pack (audio/<word>.m4a).
#
# macOS only — uses the built-in `say` engine with the Samantha voice
# (the highest-quality en-US voice and #1 in the app's preferred-voice list),
# then converts to AAC/m4a with `afconvert`. Idempotent: existing clips are skipped.
#
# Usage:  ./scripts/gen-audio.sh        (run from repo root)
set -e
cd "$(dirname "$0")/.."
mkdir -p audio _tmp_aiff

# Extract the unique lowercase English words straight out of words.js
node -e '
const fs=require("fs");
const t=fs.readFileSync("words.js","utf8");
const ens=[...t.matchAll(/\ben:\s*"([^"]+)"/g)].map(m=>m[1].toLowerCase().trim());
fs.writeFileSync("_words.txt",[...new Set(ens)].join("\n"));
'

cat _words.txt | xargs -P 8 -I {} bash -c '
  w="$1"; out="audio/$w.m4a"
  [ -s "$out" ] && exit 0
  say -v Samantha -r 150 -o "_tmp_aiff/$w.aiff" "$w" 2>/dev/null && \
  afconvert -f m4af -d aac -b 64000 "_tmp_aiff/$w.aiff" "$out" 2>/dev/null && \
  rm -f "_tmp_aiff/$w.aiff"
' _ {}

rm -rf _tmp_aiff _words.txt
echo "generated $(ls audio/*.m4a | wc -l | tr -d ' ') clips, total $(du -sh audio | cut -f1)"
