-- mpv script: write the current track's display title to NOWPLAYING_FILE on
-- every track change, so serve.js can surface it to the banner widget.
-- Loaded by deploy/stream.sh via `mpv --script=.../nowplaying.lua`.
--
-- Prefers the ID3 title tag (mpv's media-title); for untagged Pixabay files
-- it falls back to a cleaned-up filename: drops the extension and the trailing
-- "-123456" id, turns separators into spaces, and title-cases the words.

local out = os.getenv("NOWPLAYING_FILE")

local function titlecase(s)
  return (s:gsub("(%a)([%w']*)", function(a, b) return a:upper() .. b:lower() end))
end

local function clean(name)
  name = name:gsub("%.%w+$", "")      -- drop extension
  name = name:gsub("%-%d+$", "")      -- drop trailing -123456 id
  name = name:gsub("[_%-]+", " ")     -- separators -> spaces
  name = name:gsub("%s+", " ")        -- collapse whitespace
  name = name:gsub("^%s*(.-)%s*$", "%1")
  return titlecase(name)
end

local function write(text)
  if not out then return end
  local f = io.open(out, "w")
  if f then
    f:write(text or "")
    f:close()
  end
end

mp.register_event("file-loaded", function()
  local title = mp.get_property("media-title")
  local fname = mp.get_property("filename")
  -- media-title falls back to the bare filename when there's no title tag;
  -- detect that and clean it instead of showing the raw filename.
  if not title or title == "" or title == fname then
    title = clean(fname or "")
  end
  write(title)
end)

-- Blank the file when playback stops so the widget doesn't show a stale track.
mp.register_event("end-file", function() write("") end)
