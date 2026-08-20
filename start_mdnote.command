#!/bin/bash
# MDノート - macOS起動用ランチャー
# Google Chrome を「アプリモード」で起動し、アドレスバーやタブのない
# 独立したウィンドウとして開きます。

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INDEX_URL="file://$DIR/index.html"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
EDGE="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"

if [ -x "$CHROME" ]; then
  "$CHROME" --app="$INDEX_URL" --window-size=1280,860 &
elif [ -x "$EDGE" ]; then
  "$EDGE" --app="$INDEX_URL" --window-size=1280,860 &
else
  echo "Google ChromeまたはMicrosoft Edgeが見つかりませんでした。index.htmlを直接ブラウザで開いてください。"
  open "$INDEX_URL"
fi
