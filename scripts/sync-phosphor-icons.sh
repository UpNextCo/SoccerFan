#!/bin/bash
# Syncs only the Phosphor icons used in Ball Knowledge (fast builds vs full PhosphorSwift package).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS="$ROOT/ios/BallKnowledge/PhIcons.xcassets"
BASE="https://cdn.jsdelivr.net/npm/@phosphor-icons/core@2.1.0/assets"

ICONS=(
  "regular/house.svg"
  "fill/house-fill.svg"
  "regular/soccer-ball.svg"
  "fill/soccer-ball-fill.svg"
  "regular/calendar.svg"
  "fill/calendar-fill.svg"
  "regular/chart-bar.svg"
  "fill/chart-bar-fill.svg"
  "regular/user-circle.svg"
  "fill/user-circle-fill.svg"
  "fill/lightning-fill.svg"
  "fill/trophy-fill.svg"
  "fill/bell-fill.svg"
  "fill/fire-fill.svg"
  "fill/check-circle-fill.svg"
  "bold/arrow-right-bold.svg"
  "fill/users-fill.svg"
  "fill/play-fill.svg"
  "fill/gift-fill.svg"
  "fill/game-controller-fill.svg"
  "bold/x-bold.svg"
  "fill/x-circle-fill.svg"
  "fill/seal-question-fill.svg"
  "bold/caret-right-bold.svg"
)

mkdir -p "$ASSETS"
cat > "$ASSETS/Contents.json" <<'EOF'
{
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
EOF

for rel in "${ICONS[@]}"; do
  filename="$(basename "$rel")"
  name="${filename%.svg}"
  dir="$ASSETS/${name}.imageset"
  mkdir -p "$dir"
  curl -fsSL "$BASE/$rel" -o "$dir/$filename"
  cat > "$dir/Contents.json" <<EOF
{
  "images" : [
    {
      "filename" : "$filename",
      "idiom" : "universal"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  },
  "properties" : {
    "preserves-vector-representation" : true
  }
}
EOF
  echo "Synced $name"
done

echo "Done — $((${#ICONS[@]})) icons in PhIcons.xcassets"
