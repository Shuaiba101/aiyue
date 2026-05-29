#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=18765

lsof -ti:$PORT | xargs kill -9 2>/dev/null
cd "$DIR" || exit 1

python3 -m http.server $PORT --bind 127.0.0.1 &
SERVER_PID=$!

sleep 1
ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('i阅-选择版本.html'))")

/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --app="http://127.0.0.1:$PORT/$ENCODED" \
  --start-fullscreen \
  --disable-features=TranslateUI \
  2>/dev/null &

echo "i阅 已启动"
wait $SERVER_PID 2>/dev/null
