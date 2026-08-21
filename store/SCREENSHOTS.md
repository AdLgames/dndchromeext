# Regenerating the store screenshots

The five PNGs in `screenshots/` are 1280×800, which is what the Chrome Web
Store wants. They are made by framing the real side panel — running against
the real bundled data — beside a stand-in game page.

This is a short manual procedure rather than an `npm run`. Hosting the files
and driving Chrome from one Node process deadlocks (the screenshot wait
blocks the event loop the server needs), and the workaround was more moving
parts than a job done a few times a year deserves.

## Steps

```sh
npm run build

# 1. Assemble a servable copy: the built extension plus the harness.
rm -rf .shots && cp -r dist .shots && cp scripts/store-assets/* .shots/

# 2. The panel expects the extension APIs; stub.js stands in for them,
#    drive.js clicks through to the view each shot wants.
python3 - <<'PY'
s = open(".shots/sidepanel.html").read()
s = s.replace("<script", '<script src="stub.js"></script>\n<script', 1)
s = s.replace("</body>", '<script src="drive.js"></script>\n</body>', 1)
open(".shots/sidepanel.html", "w").write(s)
PY

# 3. Serve it.
(cd .shots && python3 -m http.server 8731 &)

# 4. Shoot. The window is 887 tall because headless Chrome sizes the
#    screenshot to the window, whose viewport is 87px shorter.
CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome   # or your own
shot() {
  "$CHROME" --headless --disable-gpu --no-sandbox --hide-scrollbars \
    --virtual-time-budget=12000 --window-size=1280,887 \
    --screenshot="store/screenshots/$1.png" \
    "http://localhost:8731/shot.html?panel=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$2")"
}
shot 1-search  "q=fireball"
shot 2-spell   "q=fireball&open=0"
shot 3-combat  "click=Combat"
shot 4-monster "q=goblin&open=0"
shot 5-dice    "hdr=2&dice=d20|d6"

# 5. Take the 87px band back off.
node scripts/crop-png.mjs 800 store/screenshots/*.png

# 6. Tidy up.
pkill -f "http.server 8731"; rm -rf .shots
```

`scripts/store-assets/stub.js` also seeds a small party, a couple of homebrew
entries and an encounter, so the combat shot has something in it. Edit that
file to change what the screenshots depict.
