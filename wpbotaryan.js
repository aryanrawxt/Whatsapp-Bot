// ======= LICENSE CHECK (startup + periodic + local cache) =======
// ===== FINAL LICENSE CHECK (CommonJS-safe; no top-level await) =====
const fetch = global.fetch || require('node-fetch'); // ensure fetch available
const fs = require('fs');
const path = require('path');

const MY_LICENSE_KEY = "FRIEND_KEY_123"; // <-- change to the license you want to use
const LICENSE_URL = "https://raw.githubusercontent.com/aryanrawxt/license-check/main/licenses.json";
const CACHE_FILE = path.join(__dirname, 'license_cache.json'); // local fallback cache

async function fetchLicenses() {
  try {
    const res = await fetch(LICENSE_URL);
    if (!res.ok) throw new Error('bad response ' + res.status);
    const licenses = await res.json();
    // save local cache (best-effort)
    try { fs.writeFileSync(CACHE_FILE, JSON.stringify(licenses, null, 2)); } catch (e) {}
    return licenses;
  } catch (err) {
    console.log('⚠️ Could not fetch remote licenses:', err.message);
    // try local cache
    if (fs.existsSync(CACHE_FILE)) {
      try {
        const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        console.log('ℹ️ Using cached license list.');
        return cached;
      } catch (e) {
        console.log('❌ Cache read failed:', e.message);
        throw e;
      }
    } else {
      throw err; // no cache -> treat as failure
    }
  }
}

async function checkLicense() {
  try {
    const licenses = await fetchLicenses();
    if (!Array.isArray(licenses)) throw new Error('licenses data invalid');
    if (!licenses.includes(MY_LICENSE_KEY)) {
      console.log("❌ License revoked. Exiting...");
      process.exit(0);
    } else {
      console.log("✅ License valid...");
    }
  } catch (e) {
    console.log("⚠️ Could not verify license (and no cache). Exiting...");
    process.exit(0);
  }
}

// Run initial check (no top-level await). If OK we schedule periodic checks and continue startup.
// If checkLicense rejects, the process exits.
checkLicense()
  .then(() => {
    // Initial check passed: re-check every 5 minutes
    setInterval(() => {
      // run check but do not block startup logic
      checkLicense().catch(() => {}); // failures will exit inside checkLicense
    }, 5 * 60 * 1000);

    console.log('Startup: license OK — continuing bot initialization...');
    // From here onward the rest of your file (requires, client init, etc.) will run as usual.
  })
  .catch(() => {
    // checkLicense already logs the reason and exits; this is just a safety fallback
    process.exit(0);
  });
// ==================================================================


const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const WebSocket = require('ws');
const SpotifyWebApi = require('spotify-web-api-node');
const ytdlp = require('yt-dlp-exec');
const { execSync } = require('child_process');
const { createCanvas, loadImage } = require('canvas');
const twemoji = require('twemoji');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = (() => {
  try { return require('ffmpeg-static'); } catch (e) { return null; }
})();
const GraphemeSplitter = require('grapheme-splitter');
const splitter = new GraphemeSplitter();
require('dotenv').config()
const OpenAI = require("openai");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ------------------- CONFIG (edit here) -------------------
const OWNER_NUMBER = '919867232663@c.us';
const SUBADMINS_FILE = './subadmins.json';

// Commands that only owner can run (subadmins must NOT be able to run these)
const ownerOnly = ['/addsubadmin', '/removesubadmin', '/listsubadmins'];
const DEBUG = false;

// Commands that require admin (owner OR subadmins). Non-admin callers are SILENTLY IGNORED.
const adminOnly = [
  '/targetslide','/stoptargetslide',
  '/slidespam','/stopslidespam',
  '/unlockslide','/lockslide',
  '/changegcname','/stopgcnc',
  '/spam','/stopspam',
  '/spamreply','/stopspamreply',
  '/setdelay','/broadcast',
  '/animevoice'
];

// Debug: set to true while testing to print debug logs to console

// ---- State containers ----
let spamDelay = 3000;
const spamIntervals      = new Map();
const spamReplyTextMap   = new Map();
const reactEmojiMap      = new Map();
const nameFileIntervals  = new Map();
const nameEmojiIntervals = new Map();
const nameEmojiState     = new Map();
const pollMap            = new Map();
const slideState         = new Map();
const slideSpamState     = new Map();
const unlockSlideState   = new Map();
const timespamState      = new Map();
const timerspamState     = new Map();
const animevoiceMap      = new Map();

// create a unique session folder per session name
// put this where you create the client (make sure sessionName is defined BEFORE this)
const sessionName = process.argv[2] || 'default';
const sessionPath = path.join(__dirname, 'session', sessionName);
if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: sessionPath }),
  puppeteer: {
    headless: true, // set to false while debugging so you can see the browser window
    executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
    args: [
      `--user-data-dir=${path.join(sessionPath, 'puppeteer_profile')}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  }
});

// ---- QR & Ready ----
client.on('qr', qr => {
  qrcode.generate(qr, { small: true });
  console.log("⚡ Scan QR to authenticate.");
});
client.on('ready', () => {
  console.log("🤖 Bot online.");
});
// ---- Romantic emojis pool for emoji-based cycling ----
const NAME_EMOJIS = [
  '💕','💖','😍','🥰','😘','💘','💞','❣️','💓','💗',
  '🌸','🌺','🌼','🌟','✨','🔥','⚡','💫','🎉','🎊',
  '🍓','🍰','🍩','🍪','🍫','🍬','🍭','☕','🍵','🍶',
  '🐾','🐱','🐶','🦊','🐼','🦄','🐉','🐣','🐥','🐙',
  '🎵','🎶','🎤','🎧','🎮','🕹️','📸','🎬','🏆','🏅',
  '😄','😆','😎','🤩','😉','😇','🤗','😜','🤪','😺',
  '💼','📌','🔔','🔆','🎈','🪩','🌈','☀️','🌙','⭐'
];

// ---- Session setup ----

const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID || '',
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
});
let spotifyTokenExpiresAt = 0;
async function ensureSpotifyToken() {
  try {
    const now = Date.now();
    if (now < spotifyTokenExpiresAt - 60_000) return;
    const data = await spotifyApi.clientCredentialsGrant();
    spotifyApi.setAccessToken(data.body['access_token']);
    spotifyTokenExpiresAt = now + data.body.expires_in * 1000;
  } catch (e) {
    if (DEBUG) console.error('Spotify token error', e);
    // don't throw — we can still fallback to YouTube search
  }
}

function isSpotifyUrl(s) {
  return /open\.spotify\.com\/(track|playlist)/.test(String(arguments[0] || ''));
}

async function resolveSpotifyTrackObject(text) {
  try {
    if (isSpotifyUrl(text) && text.includes('/track/')) {
      const id = text.split('/track/')[1].split('?')[0];
      const { body } = await spotifyApi.getTrack(id);
      return body;
    } else {
      const { body } = await spotifyApi.searchTracks(text, { limit: 1 });
      if (body?.tracks?.items?.length) return body.tracks.items[0];
      return null;
    }
  } catch (e) {
    if (DEBUG) console.error('resolveSpotifyTrackObject error', e);
    return null;
  }
}

async function downloadSpotifyPreviewFile(track) {
  if (!track || !track.preview_url) return null;
  const out = `./spotify_preview_${track.id}.mp3`;
  const writer = fs.createWriteStream(out);
  try {
    const resp = await axios({ url: track.preview_url, method: 'GET', responseType: 'stream' });
    resp.data.pipe(writer);
    await new Promise((res, rej) => {
      writer.on('finish', res);
      writer.on('error', rej);
    });
    return out;
  } catch (e) {
    if (fs.existsSync(out)) try { fs.unlinkSync(out); } catch(_) {}
    if (DEBUG) console.error('downloadSpotifyPreviewFile error', e);
    return null;
  }
}

async function downloadFullFromYouTube(query, format = 'mp3') {
  // format: 'mp3' or 'mp4'
  const outBase = `./spotify_song_${Date.now()}`;
  let opts;
  if (format === 'mp3') {
    opts = {
      x: true,
      audioFormat: 'mp3',
      audioQuality: 0,
      noPlaylist: true,
      output: `${outBase}.%(ext)s`,
      ffmpegLocation: ffmpegPath || undefined,
      quiet: true,
      preferFreeFormats: true,
    };
    await ytdlp(`ytsearch1:${query}`, opts);
    if (fs.existsSync(`${outBase}.mp3`)) return `${outBase}.mp3`;
    // some outputs may be .m4a — try find any file with prefix
    const found = fs.readdirSync(process.cwd()).find(f => f.startsWith(outBase) && (f.endsWith('.mp3') || f.endsWith('.m4a') || f.endsWith('.opus')));
    if (found) return `./${found}`;
    return null;
  } else {
    // mp4/video
    opts = {
      format: 'bestvideo+bestaudio/best',
      mergeOutputFormat: 'mp4',
      output: `${outBase}.%(ext)s`,
      ffmpegLocation: ffmpegPath || undefined,
      quiet: true,
      preferFreeFormats: true,
      noPlaylist: true,
    };
    await ytdlp(`ytsearch1:${query}`, opts);
    // find mp4
    const found = fs.readdirSync(process.cwd()).find(f => f.startsWith(outBase) && f.endsWith('.mp4'));
    if (found) return `./${found}`;
    // fallback: any file with outBase
    const anyFound = fs.readdirSync(process.cwd()).find(f => f.startsWith(outBase));
    if (anyFound) return `./${anyFound}`;
    return null;
  }
}

async function sendFileToChat(chat, filePath, opts = {}) {
  const chatId = typeof chat === 'string' ? chat : chat.id ? chat.id._serialized : (chat._serialized || null);
  if (!chatId) throw new Error('Invalid chat target');
  const media = MessageMedia.fromFilePath(filePath);
  // opts may include sendAudioAsVoice, caption
  try {
    await client.sendMessage(chatId, media, opts);
  } catch (err) {
    // try chat.sendMessage (chat object)
    try {
      if (chat.sendMessage) await chat.sendMessage(media, opts);
      else throw err;
    } catch (e) {
      throw e;
    }
  } finally {
    // cleanup file
    try { fs.unlinkSync(filePath); } catch (_) {}
  }
}

// === ANIME STICKER HELPERS ===
// Output directory for temporary sticker files
const OUT_DIR = path.join(__dirname, 'temp_stickers');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// Anime backgrounds: put local images in ./anime_bgs or add remote URLs here
const animeBgs = [];
const localFolder = path.join(__dirname, 'anime_bgs');
if (fs.existsSync(localFolder)) {
  const localFiles = fs.readdirSync(localFolder)
    .filter(f => /\.(png|jpe?g|webp)$/i.test(f))
    .map(f => path.join(localFolder, f));
  animeBgs.push(...localFiles);
}

// small helpers
function randFrom(arr) { return arr[Math.floor(Math.random()*arr.length)]; }
async function loadImageFlexible(src) {
  if (!src) return null;
  if (/^https?:\/\//i.test(src)) {
    const res = await axios.get(src, { responseType: 'arraybuffer' });
    return await loadImage(Buffer.from(res.data));
  } else {
    return await loadImage(src);
  }
}
function toTwemojiPngUrl(grapheme) {
  const codepoints = Array.from(grapheme).map(ch => ch.codePointAt(0).toString(16)).join('-');
  return `https://twemoji.maxcdn.com/v/latest/72x72/${codepoints}.png`;
}
function isEmojiGrapheme(gr) {
  return /\p{Extended_Pictographic}/u.test(gr);
}

// Draw text and inline emoji images with wrapping
async function drawTextWithEmojis(ctx, text, x, y, maxWidth, lineHeight, font = 'bold 36px Sans') {
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  const words = text.split(' ');
  let cursorX = x;
  let cursorY = y;
  for (let i = 0; i < words.length; i++) {
    const token = words[i];
    const grs = splitter.splitGraphemes(token);
    for (let gi = 0; gi < grs.length; gi++) {
      const gr = grs[gi];
      if (isEmojiGrapheme(gr)) {
        try {
          const url = toTwemojiPngUrl(gr);
          const res = await axios.get(url, { responseType: 'arraybuffer' });
          const img = await loadImage(Buffer.from(res.data));
          const emojiSize = Math.floor(lineHeight * 0.95);
          if (cursorX + emojiSize > x + maxWidth) { cursorX = x; cursorY += lineHeight; }
          ctx.drawImage(img, cursorX, cursorY - emojiSize/2, emojiSize, emojiSize);
          cursorX += emojiSize + 6;
        } catch (e) {
          // fallback: draw a box
          ctx.fillRect(cursorX, cursorY - 12, 18, 18);
          cursorX += 18 + 6;
        }
      } else {
        const ch = gr;
        const w = ctx.measureText(ch).width;
        if (cursorX + w > x + maxWidth) { cursorX = x; cursorY += lineHeight; }
        ctx.fillText(ch, cursorX + w/2, cursorY);
        cursorX += w;
      }
    }
    const spaceW = ctx.measureText(' ').width;
    if (cursorX + spaceW > x + maxWidth) { cursorX = x; cursorY += lineHeight; }
    else cursorX += spaceW;
  }
}

// Create image sticker (512x512 PNG)
async function makeAnimeImageSticker(text, outFilename) {
  const size = 512;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  const bgSrc = animeBgs.length ? randFrom(animeBgs) : null;
  if (bgSrc) {
    const bg = await loadImageFlexible(bgSrc);
    if (bg) ctx.drawImage(bg, 0, 0, size, size);
    else {
      const g = ctx.createLinearGradient(0,0,size,size);
      g.addColorStop(0, '#0f2027'); g.addColorStop(1, '#2c5364');
      ctx.fillStyle = g; ctx.fillRect(0,0,size,size);
    }
  } else {
    const g = ctx.createLinearGradient(0,0,size,size);
    g.addColorStop(0, '#1a2a6c'); g.addColorStop(1, '#b21f1f');
    ctx.fillStyle = g; ctx.fillRect(0,0,size,size);
  }

  // overlay for readability
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, size - 140, size, 140);

  // draw text and emojis
  const padding = 24;
  const lineHeight = 48;
  await drawTextWithEmojis(ctx, text, padding, size - 112, size - padding*2, lineHeight, 'bold 40px Sans');

  const outPath = path.join(OUT_DIR, outFilename);
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
  return outPath;
}

// Create video sticker (short mp4 from frames, default 3s)
async function makeAnimeVideoSticker(text, outFilename, duration = 3, fps = 15) {
  const size = 512;
  const frames = Math.max(1, Math.floor(duration * fps));
  const framePrefix = path.join(OUT_DIR, `frame_${Date.now()}_`);
  const bgSrc = animeBgs.length ? randFrom(animeBgs) : null;
  const bgImg = bgSrc ? await loadImageFlexible(bgSrc) : null;

  // generate frames
  for (let f = 0; f < frames; f++) {
    const t = f / Math.max(1, frames - 1);
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');

    if (bgImg) ctx.drawImage(bgImg, 0, 0, size, size);
    else {
      const g = ctx.createLinearGradient(0,0,size,size);
      g.addColorStop(0, '#0f2027'); g.addColorStop(1, '#2c5364');
      ctx.fillStyle = g; ctx.fillRect(0,0,size,size);
    }

    ctx.fillStyle = `rgba(0,0,0,${0.25 + 0.15*Math.sin(Math.PI*2*t)})`;
    ctx.fillRect(0, size - 140, size, 140);

    const startY = size + 80;
    const endY = size - 80;
    const ease = (x) => 1 - Math.pow(1-x, 3);
    const curY = startY + (endY - startY) * ease(t);

    const padding = 28;
    const lineHeight = 48;
    const scale = 1 + 0.02 * Math.sin(2*Math.PI*t);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    await drawTextWithEmojis(ctx, text, padding/scale, curY/scale - 8, (size - padding*2)/scale, lineHeight, 'bold 40px Sans');
    ctx.setTransform(1,0,0,1,0,0);

    const framePath = `${framePrefix}${String(f).padStart(3,'0')}.png`;
    fs.writeFileSync(framePath, canvas.toBuffer('image/png'));
  }

  const videoPath = path.join(OUT_DIR, outFilename);
  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(`${framePrefix}%03d.png`)
      .inputOptions([`-framerate ${fps}`])
      .outputOptions(['-c:v libx264','-pix_fmt yuv420p',`-r ${fps}`,'-preset veryfast','-y'])
      .size(`${size}x${size}`)
      .save(videoPath)
      .on('end', resolve)
      .on('error', reject);
  });

  // cleanup frames
  for (let f = 0; f < frames; f++) {
    const p = `${framePrefix}${String(f).padStart(3,'0')}.png`;
    if (fs.existsSync(p)) try { fs.unlinkSync(p); } catch(_) {}
  }
  return videoPath;
}

// ------------------- SUBADMINS STORAGE & HELPERS -------------------
let subadmins = [];
if (fs.existsSync(SUBADMINS_FILE)) {
  try { subadmins = JSON.parse(fs.readFileSync(SUBADMINS_FILE, 'utf8')) || []; }
  catch (e) { subadmins = []; }
} else {
  fs.writeFileSync(SUBADMINS_FILE, JSON.stringify([]));
}

// Normalize various jid formats to the canonical '<digits>@c.us'
function normalizeJid(input) {
  if (!input) return null;
  let s = String(input).trim();
  // if already contains domain part, return as-is
  if (s.includes('@')) return s;
  const digits = s.replace(/\D/g, '');
  if (!digits) return null;
  return `${digits}@c.us`;
}

// sanitize + normalize saved subadmins
function sanitizeSubadmins(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map(a => normalizeJid(a))
    .filter(Boolean);
}

// normalize in-memory list right after loading
subadmins = sanitizeSubadmins(subadmins);

// Save normalized list to disk
function saveSubadmins() {
  fs.writeFileSync(SUBADMINS_FILE, JSON.stringify(sanitizeSubadmins(subadmins), null, 2));
}

// sender helpers (use normalized ids)
function getSenderId(msg) {
  if (msg.fromMe) return OWNER_NUMBER;
  return msg.author || msg.from;
}

function isOwner(msg) {
  const sender = normalizeJid(getSenderId(msg));
  return sender && sender === normalizeJid(OWNER_NUMBER);
}

function isAdmin(msg) {
  const sender = normalizeJid(getSenderId(msg));
  if (!sender) return false;
  // Owner is always admin
  if (sender === normalizeJid(OWNER_NUMBER)) return true;
  // Compare normalized saved subadmins
  return sanitizeSubadmins(subadmins).includes(sender);
}

// ----------------- command processor -----------------
async function processCommand(msg) {
  const body = (msg.body || '').trim();
  if (!body || !body.startsWith('/')) return false;

  // sanitize subadmins early
  subadmins = sanitizeSubadmins(subadmins);

  const [raw, ...args] = body.split(/ +/);
  const cmd = raw.toLowerCase();
  const text = args.join(' ');
  const chat = await msg.getChat();
  const chatId = chat.id._serialized;
if (!isAdmin(msg)) {
  if (DEBUG) {
    console.log(`Ignored command ${cmd} from non-admin ${getSenderId(msg)}`);
  }
  return true; // handled (silent ignore)
}

  // Owner-only commands: reply "Talk to Owner." for non-owner
  if (ownerOnly.includes(cmd) && !isOwner(msg)) {
    return msg.reply('💬 Talk to Owner.');
  }

  // Admin-only guard: silently ignore if not admin
  if (adminOnly.includes(cmd) && !isAdmin(msg)) {
    return true; // handled silently
  }

  // Handle commands
  switch (cmd) {
    case '/help':
      return msg.reply(`
✨ ᴀɴɪᴍᴇ ʙᴏᴛ — ᴄᴏᴍᴍᴀɴᴅ ʟɪsᴛ ✨

🎭 General Commands
🎬 /targetslide <text> — Create a banner/slide
🛑 /stoptargetslide — Stop current slide
📽️ /slidespam <text> — Spam slides with text
❌ /stopslidespam — Stop slide spam
🔓 /unlockslide <text> — Auto-unlock with text
🔒 /lockslide — Lock or stop slide automation
✏️ /changegcname [base] — Change group name
⏹️ /stopgcnc — Stop group name changer
👋 /start — Say hello / start bot

💥 Spam & Auto
💣 /spam <m1;m2> — Spam 2 messages alternately
⛔ /stopspam — Stop spamming
📩 /spamreply <text> — Auto-reply spam
🛑 /stopspamreply — Stop auto spamreply
⏳ /setdelay <sec> — Delay between all commands
😂 /react <emoji> — Auto-react to msgs
🙅 /stopreact — Stop auto reactions

🎨 Fun & Media
💬 /reply <text> — Quick text reply
🕒 /timespam <text> — Spam with timestamps
⏹️ /stoptimespam — Stop timespam
⏲️ /timerspam <text> — Timer-based spam
🛑 /stoptimerspam — Stop timerspam
🎨 /s — Convert videos, images, or gifs into stickers
🔥 /roast — Generate a fun AI roast

🎙️ Voices & Music
🎤 /animevoicelist — List anime voices
🗣️ /animevoice <char> <text> — Speak as anime character
🎶 /spotify <song/link> — Play or fetch Spotify song

👑 Owner Only
➕ /addsubadmin — Add subadmin
➖ /removesubadmin — Remove subadmin
📜 /listsubadmins — List all subadmins
`.trim());
case '/start': {
  const waifuGreetings = [
    "💖 *“H-Hello Senpai~ Want to spend some time together?”* — Hinata 🌸",
    "🍰 *“I made something sweet just for you… Don’t waste it, okay?”* — Rem 💙",
    "✨ *“I’ll always be by your side, no matter what happens.”* — Asuna ⚔️",
    "🥺 *“Onii-chan~ play with me instead of your games!”* — Kanna 🐉",
    "🔥 *“If you fight… I’ll fight with you till the end!”* — Mikasa ⚔️",
    "🌙 *“Let’s watch the stars together, just you and me~”* — Zero Two 💕",
    "😳 *“D-Don’t look at me like that baka!”* — Tsundere Waifu 💢",
    "🍓 *“You’re sweeter than strawberries, Senpai~”* — Ichika 🍓",
    "🎶 *“Let me sing for you… only you~”* — Miku 🎤",
    "🐾 *“Nyaa~ Welcome home, Master~”* — Cute Catgirl 🐱"
  ];

  const randomWaifu = waifuGreetings[Math.floor(Math.random() * waifuGreetings.length)];

  try {
    const response = await fetch('https://api.waifu.pics/sfw/waifu');
    const data = await response.json();

    // if in group, tag user
    const isGroup = msg.from.endsWith('@g.us');
    const mention = isGroup
      ? `@${msg.author.split('@')[0]}`
      : `@${msg.from.split('@')[0]}`;

    const caption =
`👋✨ *ᴡᴇʟᴄᴏᴍᴇ ᴛᴏ ᴀɴɪᴍᴇ ʙᴏᴛ* ✨👋  

💡 Your personal bot for 🎭 fun, 🎶 music, 🎙️ anime voices & more!  

📜 *Type* /help to see all commands 🔥  

💞 Random Waifu Greeting for ${mention}:  
${randomWaifu}`;

    const media = await MessageMedia.fromUrl(data.url);

    return client.sendMessage(msg.from, media, {
      caption,
      mentions: [isGroup ? msg.author : msg.from] // make sure mentions work
    });

  } catch (err) {
    console.error("Error fetching waifu image:", err);

    const isGroup = msg.from.endsWith('@g.us');
    const mention = isGroup
      ? `@${msg.author.split('@')[0]}`
      : `@${msg.from.split('@')[0]}`;

    return client.sendMessage(msg.from,
`👋✨ *ᴡᴇʟᴄᴏᴍᴇ ᴛᴏ ᴀɴɪᴍᴇ ʙᴏᴛ* ✨👋  

💡 Your personal bot for 🎭 fun, 🎶 music, 🎙️ anime voices & more!  

📜 *Type* /help to see all commands 🔥  

💞 Random Waifu Greeting for ${mention}:  
${randomWaifu}

⚠️ (Couldn’t load waifu image this time)`, 
      { mentions: [isGroup ? msg.author : msg.from] }
    );
  }
};

case '/s': {
  try {
    // check if it's replying to an image
    if (msg.hasQuotedMsg) {
      const quotedMsg = await msg.getQuotedMessage();

      if (quotedMsg.hasMedia) {
        const media = await quotedMsg.downloadMedia();

        // send as sticker
        return client.sendMessage(msg.from, media, {
          sendMediaAsSticker: true,
          stickerAuthor: "AnimeBot",
          stickerName: "Sticker"
        });
      } else {
        return msg.reply("⚠️ Please reply to an *image* with `/s` to make a sticker!");
      }
    } else {
      return msg.reply("⚠️ You need to *reply* to an image with `/s`!");
    }
  } catch (err) {
    console.error("Sticker creation error:", err);
    return msg.reply("❌ Failed to create sticker. Try again with a clear image!");
  }
};
    // owner-only management
   case '/addsubadmin': {
  if (!text) return msg.reply('Usage: /addsubadmin <number>');
  const id = normalizeJid(text);
  if (!id) return msg.reply('❌ Could not parse number. Use digits like 919xxxxxxxx or 919xxxxxxxx@c.us');
  // reload/normalize current list
  subadmins = sanitizeSubadmins(subadmins);
  if (subadmins.includes(id)) return msg.reply('⚠️ Already a subadmin.');
  subadmins.push(id);
  saveSubadmins();
  // Try mention the newly added contact (best-effort)
  try {
    const contact = await client.getContactById(id);
    await client.sendMessage((await msg.getChat()).id._serialized, `✅ Added ${contact?.pushname || id} as subadmin.`, { mentions: [contact] });
  } catch (_) {
    await msg.reply(`✅ Added ${id} as subadmin.`);
  }
  return true;
}

case '/removesubadmin': {
  if (!text) return msg.reply('Usage: /removesubadmin <number>');
  const id = normalizeJid(text);
  if (!id) return msg.reply('❌ Could not parse number.');
  subadmins = sanitizeSubadmins(subadmins).filter(x => x !== id);
  saveSubadmins();
  return msg.reply('✅ Removed from subadmins.');
}

case '/listsubadmins': {
  subadmins = sanitizeSubadmins(subadmins);
  let message = `👑 Owner:\n${OWNER_NUMBER}\n\n`;
  if (subadmins.length > 0) {
    message += `📋 Subadmins:\n${subadmins.join('\n')}`;
    // try to mention owner + subadmins (best-effort). build contact objects array for mentions
    const mentionsArr = [];
    try {
      mentionsArr.push(await client.getContactById(OWNER_NUMBER));
      for (const s of subadmins) {
        try { mentionsArr.push(await client.getContactById(s)); } catch(e){ /* ignore */ }
      }
    } catch(e){ /* ignore */ }
    await client.sendMessage(chatId, message, mentionsArr.length ? { mentions: mentionsArr } : {});
  } else {
    message += `📋 Subadmins:\n0 subadmin right now`;
    await client.sendMessage(chatId, message, { mentions: [OWNER_NUMBER] });
  }
  return true;
}

    // slide/target/etc (admin commands)
    case '/targetslide': {
      if (!msg.hasQuotedMsg) return msg.reply('❗ Quote + /targetslide');
      const quoted = await msg.getQuotedMessage();
      const tJid = chat.isGroup ? quoted.author : quoted.from;
      slideState.set(chatId, { targetJid: tJid, slideText: text });
      return msg.reply('🔄 Target-slide set.');
    }
    case '/stoptargetslide':
      slideState.delete(chatId);
      return msg.reply('🛑 Target-slide cleared.');
 // ---- SPOTIFY / YT feature ----
    case '/spotify': {
      // Usage:
      // /spotify <query>              -> full mp3 (default)
      // /spotify full <query> [mp4]   -> full mp3 or mp4 if 'mp4' specified
      // /spotify preview <query|link> -> spotify 30s preview if available
      if (!text) return msg.reply('Usage: /spotify <song or spotify link>\n/spotify full <song> [mp4]\n/spotify preview <song or spotify link>');

      // ensure spotify token (non-fatal)
      await ensureSpotifyToken();

      const parts = text.trim().split(/\s+/);
      const sub = parts[0].toLowerCase();

      try {
        // PREVIEW mode
        if (sub === 'preview') {
          const query = parts.slice(1).join(' ');
          if (!query) return msg.reply('Usage: /spotify preview <song or spotify link>');
          const trackObj = await resolveSpotifyTrackObject(query);
          if (!trackObj) return msg.reply('❌ No track found on Spotify.');
          const file = await downloadSpotifyPreviewFile(trackObj);
          if (!file) return msg.reply('ℹ️ No Spotify preview available for this track.');
          const caption = `🎵 ${trackObj.name} — ${trackObj.artists.map(a => a.name).join(', ')}\n(30s preview from Spotify)`;
          await sendFileToChat(chat, file, { caption, sendAudioAsVoice: false });
          return msg.reply('✅ Preview sent.');
        }

        // FULL mode explicit: "/spotify full ..." or "/spotify full ... mp4"
        if (sub === 'full') {
          const tail = parts.slice(1);
          if (!tail.length) return msg.reply('Usage: /spotify full <song> [mp4]');
          const last = tail[tail.length - 1].toLowerCase();
          let wantMp4 = false;
          if (last === 'mp4' || last === 'video') {
            wantMp4 = true;
            tail.pop();
          }
          const query = tail.join(' ');
          if (!query) return msg.reply('Usage: /spotify full <song> [mp4]');

          // if spotify link provided, try resolve to readable query
          let trackObj = null;
          if (isSpotifyUrl(query)) trackObj = await resolveSpotifyTrackObject(query);
          const displayName = trackObj ? `${trackObj.name} — ${trackObj.artists.map(a => a.name).join(', ')}` : query;

          await msg.reply(`⬇️ Downloading full ${wantMp4 ? 'video' : 'audio'} for: ${displayName}`);
          // Check ffmpeg availability (yt-dlp may need it to merge)
          try { execSync('ffmpeg -version', { stdio: 'ignore' }); } catch (e) {
            if (!ffmpegPath) {
              // warn but continue — download may fail without ffmpeg
              await msg.reply('⚠️ ffmpeg not found in PATH. Install ffmpeg if merges fail.');
            }
          }

          // Download: if we have trackObj use "name artist" query or fallback to provided query
          const ytQuery = trackObj ? `${trackObj.name} ${trackObj.artists[0].name}` : query;
          const file = await downloadFullFromYouTube(ytQuery, wantMp4 ? 'mp4' : 'mp3');
          if (!file) return msg.reply('❌ Failed to download from YouTube.');

          // Send: if mp4, send as file (no sendAudioAsVoice)
          try {
            if (wantMp4) {
              await sendFileToChat(chat, file, { caption: `🎬 ${displayName}` });
            } else {
              // For audio: send as audio file (not voice) so user can play as audio
              await sendFileToChat(chat, file, { caption: `🎵 ${displayName}`, sendAudioAsVoice: false });
            }
            return msg.reply('✅ Sent.');
          } catch (e) {
            if (DEBUG) console.error('send file error', e);
            return msg.reply('⚠️ Failed to send the downloaded file. Check console.');
          }
        }

        // Default behavior: /spotify <query> -> FULL mp3 (as you asked "no i want full song")
        {
          const query = text;
          if (!query) return msg.reply('Usage: /spotify <song or spotify link>');
          // try to get track info from spotify to have nicer display and better query
          let trackObj = null;
          if (isSpotifyUrl(query)) trackObj = await resolveSpotifyTrackObject(query);
          const displayName = trackObj ? `${trackObj.name} — ${trackObj.artists.map(a => a.name).join(', ')}` : query;

          await msg.reply(`Wait for few seconds .. Loading audio for: ${displayName}`);
          try { execSync('ffmpeg -version', { stdio: 'ignore' }); } catch (e) {
            if (!ffmpegPath) {
              await msg.reply('⚠️ ffmpeg not found in PATH. Install ffmpeg if merges fail.');
            }
          }
          const ytQuery = trackObj ? `${trackObj.name} ${trackObj.artists[0].name}` : query;
          const file = await downloadFullFromYouTube(ytQuery, 'mp3');
          if (!file) return msg.reply('❌ Failed to download from YouTube.');

          try {
            await sendFileToChat(chat, file, { caption: `🎵 ${displayName}`, sendAudioAsVoice: false });
            return msg.reply('✅ Sent.');
          } catch (e) {
            if (DEBUG) console.error('send default file error', e);
            return msg.reply('⚠️ Failed to send the downloaded file. Check console.');
          }
        }
      } catch (err) {
        console.error('/spotify error', err);
        return msg.reply('❌ Spotify/YouTube fetch failed. See console for details.');
      }
    } // end /spotify
// ---- Roast / Bully (robust, fixed createWid error) ----
// ---- Roast / Bully (owner+subadmin only; subadmins cannot roast owner) ----
case '/roast':{
  // require a mention / tag
  const mentions = await msg.getMentions();
  if (!mentions || mentions.length === 0) {
    return msg.reply("⚠️ Tag someone to roast! Example: /bully @user");
  }

  // check caller permissions: only owner or subadmins allowed
  const callerId = getSenderId(msg);           // existing helper in your file
  const callerIsOwner = isOwner(msg);          // existing helper
  const callerIsAdmin = isAdmin(msg);          // owner OR subadmin

  if (!callerIsAdmin) {
    return msg.reply('❌ Only owner and subadmins can use this command.');
  }

  const rawTarget = mentions[0];

  // Normalize mention -> serialized id like '919xxxxxxxx@c.us'
  function getSerializedId(t) {
    if (!t) return null;
    if (typeof t === 'string') return t;
    if (t.id && typeof t.id._serialized === 'string') return t.id._serialized;
    if (typeof t._serialized === 'string') return t._serialized;
    if (t.id && typeof t.id.user === 'string') return `${t.id.user}@c.us`;
    if (t.number && typeof t.number === 'string') return `${t.number}@c.us`;
    return null;
  }

  const mentionId = getSerializedId(rawTarget);
  if (!mentionId) {
    console.warn('Could not resolve mention id for:', rawTarget);
    return msg.reply('⚠️ Could not resolve tagged user. Please tag someone properly and try again.');
  }

  // If caller is subadmin (not owner) and target is owner -> block
  if (!callerIsOwner && mentionId === OWNER_NUMBER) {
    return msg.reply("Don't Mess with owner");
  }

  const shortUser = mentionId.replace(/@.*$/, '');

  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY missing at runtime. process.cwd=', process.cwd());
    return msg.reply('❌ OPENAI_API_KEY not found at runtime. Make sure .env is loaded and bot restarted.');
  }

  try {
    // generate roast
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a dark, savage roaster. Produce short (1-2 sentence), funny roast lines."
        },
        { role: "user", content: "Roast in 1-2 funny, little dank sentences." }
      ],
      max_tokens: 80,
    });

    const roastText = completion?.choices?.[0]?.message?.content?.trim() || "Couldn't generate a roast right now.";

    // Resolve Contact object to safely mention (avoids the internal .match error)
    let contactObj = null;
    try { contactObj = await client.getContactById(mentionId); } catch (e) { contactObj = null; }

    const finalText = `🔥 Hey @${shortUser}, ${roastText}`;

    // Send using client.sendMessage and mention contact object if available
    const chat = await msg.getChat();
    if (contactObj) {
      await client.sendMessage(chat.id._serialized, finalText, { mentions: [contactObj] });
    } else {
      await client.sendMessage(chat.id._serialized, finalText);
    }

    return true; // handled
  } catch (err) {
    console.error('❌ /roast error:', err);

    let friendly = '❌ Failed to generate roast.';
    if (err?.response?.status) friendly += ` (status ${err.response.status})`;
    if (err?.response?.data?.error?.message) { friendly += ` ${err.response.data.error.message}`; }
    else if (err?.message) { friendly += ` ${err.message}`; }

    try { await msg.reply(friendly); } catch (e) { console.error('Failed to send error reply to chat:', e); }
    return true;
  }
}
    // --- anime sticker/image and video sticker ---
    case '/animesticker': {
      if (!text) return msg.reply('Usage: /animesticker <text>');
      try {
                const out = await makeAnimeVideoSticker(text, `anime_sticker_video_${Date.now()}.mp4`);
        // convert mp4 -> animated webp (WhatsApp-friendly sticker)
        const webpOut = out.replace(/\.mp4$/i, '.webp');

        await new Promise((resolve, reject) => {
          ffmpeg(out)
            .videoFilters('scale=512:512:force_original_aspect_ratio=decrease,fps=15,format=rgba')
            .outputOptions([
              '-vcodec', 'libwebp',
              '-lossless', '0',
              '-q:v', '50',        // quality (lower -> smaller file). tweak 30..70
              '-preset', 'default',
              '-loop', '0',        // 0 = infinite loop (WhatsApp expects loop)
              '-an',
              '-vsync', '0'
            ])
            .duration(3)          // ensure short duration (adjust if you used different duration)
            .on('start', cmd => { if (DEBUG) console.log('ffmpeg webp cmd:', cmd); })
            .on('stderr', l => { if (DEBUG) console.log('ffmpeg:', l); })
            .on('end', resolve)
            .on('error', reject)
            .save(webpOut);
        });

        // optional: check size (WhatsApp prefers < ~1MB, but can work higher depending on device)
        try { const size = fs.statSync(webpOut).size; if (DEBUG) console.log('webp size', size); } catch (e) {}

        // send as sticker
        const stickerMedia = MessageMedia.fromFilePath(webpOut);
        await client.sendMessage(chatId, stickerMedia, { sendMediaAsSticker: true });

        // cleanup: delete mp4 + webp (you already cleanup elsewhere; keep or remove)
        try { fs.unlinkSync(out); } catch(_) {}
        try { fs.unlinkSync(webpOut); } catch(_) {}

        return msg.reply('✅ Anime sticker sent.');
      } catch (e) {
        console.error('animesticker error', e);
        return msg.reply('⚠️ Failed to create anime sticker.');
      }
    }
    case '/animestickerv': {
      if (!text) return msg.reply('Usage: /animestickerv <text>');
      try {
        const out = await makeAnimeVideoSticker(text, `anime_sticker_video_${Date.now()}.mp4`);
        const media = MessageMedia.fromFilePath(out);
        await client.sendMessage(chatId, media, { sendMediaAsSticker: true });
        return msg.reply('✅ Anime video sticker sent.');
      } catch (e) {
        console.error('animevsticker error', e);
        return msg.reply('⚠️ Failed to create anime video sticker.');
      }
    }


    case '/slidespam': {
      if (!msg.hasQuotedMsg) return msg.reply('❗ Quote + /slidespam');
      const quoted = await msg.getQuotedMessage();
      if (slideSpamState.has(chatId)) clearInterval(slideSpamState.get(chatId));
      const iv = setInterval(() => {
        chat.sendMessage(text, { quotedMessageId: quoted.id._serialized }).catch(console.error);
      }, spamDelay);
      slideSpamState.set(chatId, iv);
      return msg.reply(`🔄 SlideSpam every ${spamDelay/1000}s.`);
    }
    case '/stopslidespam': {
      if (slideSpamState.has(chatId)) { clearInterval(slideSpamState.get(chatId)); slideSpamState.delete(chatId); return msg.reply('🛑 SlideSpam stopped.'); }
      return msg.reply('⚠️ No SlideSpam.');
    }

    case '/unlockslide': {
      if (!msg.hasQuotedMsg) return msg.reply('❗ Quote + /unlockslide');
      const quoted = await msg.getQuotedMessage();
      if (unlockSlideState.has(chatId)) clearInterval(unlockSlideState.get(chatId));
      const iv = setInterval(() => {
        chat.sendMessage(text, { quotedMessageId: quoted.id._serialized }).catch(console.error);
      }, spamDelay);
      unlockSlideState.set(chatId, iv);
      return msg.reply(`🔓 UnlockSlide every ${spamDelay/1000}s.`);
    }
    case '/lockslide': {
      if (unlockSlideState.has(chatId)) { clearInterval(unlockSlideState.get(chatId)); unlockSlideState.delete(chatId); return msg.reply('🔒 UnlockSlide stopped.'); }
      return msg.reply('⚠️ No UnlockSlide.');
    }

    case '/changegcname': {
  if (!chat.isGroup) return msg.reply('Use in group');

  // clear any existing intervals for this chat
  if (nameFileIntervals.has(chatId)) { clearInterval(nameFileIntervals.get(chatId)); nameFileIntervals.delete(chatId); }
  if (nameEmojiIntervals.has(chatId)) { clearInterval(nameEmojiIntervals.get(chatId)); nameEmojiIntervals.delete(chatId); nameEmojiState.delete(chatId); }

  // 3x speed: use spamDelay / 3, with safe minimum 500ms
  const intervalMs = Math.max(500, Math.floor(spamDelay / 3));

  // helper to pick a random emoji different from last
  function pickDifferentEmoji(last) {
    if (!last) return NAME_EMOJIS[Math.floor(Math.random() * NAME_EMOJIS.length)];
    let e = last;
    const tries = 6;
    for (let i = 0; i < tries && e === last; i++) {
      e = NAME_EMOJIS[Math.floor(Math.random() * NAME_EMOJIS.length)];
    }
    if (e === last) { // fallback: pick any different by scanning
      for (const cand of NAME_EMOJIS) if (cand !== last) { e = cand; break; }
    }
    return e;
  }

  // FILE MODE: no text -> cycle names from wpnc.txt (append random emoji each tick)
  if (!text) {
    let data;
    try { data = fs.readFileSync('wpnc.txt', 'utf8'); } catch { return msg.reply('❌ Cannot read wpnc.txt'); }
    const names = data.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!names.length) return msg.reply('❌ wpnc.txt empty');

    let idx = 0;
    // keep last emoji to avoid immediate repeats
    let lastEmoji = null;
    const iv = setInterval(() => {
      try {
        const baseName = names[idx];
        const em = pickDifferentEmoji(lastEmoji);
        lastEmoji = em;
        chat.setSubject(`${baseName} ${em}`).catch(err => { if (DEBUG) console.error('setSubject (file mode) failed:', err); });
        idx = (idx + 1) % names.length;
      } catch (e) {
        if (DEBUG) console.error('Error in name cycling interval (file):', e);
      }
    }, intervalMs);

    nameFileIntervals.set(chatId, iv);
    return msg.reply(`🔄 Cycling ${names.length} names from file (every ${intervalMs/1000}s).`);
  } else {
    // EMOJI MODE: use provided base text and append a different emoji each tick
    const base = text;
    nameEmojiState.set(chatId, { base: base, lastEmoji: null });

    const iv2 = setInterval(() => {
      try {
        const st = nameEmojiState.get(chatId);
        const em = pickDifferentEmoji(st.lastEmoji);
        st.lastEmoji = em;
        chat.setSubject(`${st.base} ${em}`).catch(err => { if (DEBUG) console.error('setSubject (emoji mode) failed:', err); });
      } catch (e) {
        if (DEBUG) console.error('Error in name cycling interval (emoji):', e);
      }
    }, intervalMs);

    nameEmojiIntervals.set(chatId, iv2);
    return msg.reply(`🔄 Cycling "${text}" .`);
  }
}
    case '/stopgcnc': {
      let stopped = false;
      if (nameFileIntervals.has(chatId)) { clearInterval(nameFileIntervals.get(chatId)); nameFileIntervals.delete(chatId); stopped = true; }
      if (nameEmojiIntervals.has(chatId)) { clearInterval(nameEmojiIntervals.get(chatId)); nameEmojiIntervals.delete(chatId); nameEmojiState.delete(chatId); stopped = true; }
      return msg.reply(stopped ? '🛑 Name cycling stopped.' : '⚠️ No name cycling.');
    }

    // spam
    case '/spam': {
      if (!text) return msg.reply('Usage: /spam m1;m2');
      if (spamIntervals.has(chatId)) clearInterval(spamIntervals.get(chatId));
      const parts = text.split(';').filter(Boolean);
      let i = 0;
      const iv = setInterval(() => { chat.sendMessage(parts[i]).catch(console.error); i = (i + 1) % parts.length; }, spamDelay);
      spamIntervals.set(chatId, iv);
      return msg.reply('🌀 Spamming started.');
    }
    case '/stopspam': {
      if (spamIntervals.has(chatId)) { clearInterval(spamIntervals.get(chatId)); spamIntervals.delete(chatId); return msg.reply('🛑 Spam stopped.'); }
      return msg.reply('⚠️ No spam.');
    }

    case '/spamreply': { spamReplyTextMap.set(chatId, text || ''); return msg.reply('✅ Auto-reply set.'); }
    case '/stopspamreply': { spamReplyTextMap.delete(chatId); return msg.reply('🛑 Auto-reply cleared.'); }

    case '/setdelay': {
      const v = parseFloat(text);
      if (isNaN(v) || v <= 0) return msg.reply('Usage: /setdelay sec');
      spamDelay = v * 1000; return msg.reply(`⏱ Delay set to ${v}s.`);
    }

    case '/react': { if (!text) return msg.reply('Usage: /react <emoji>'); reactEmojiMap.set(chatId, text); return msg.reply('✅ Auto-react set.'); }
    case '/stopreact': { reactEmojiMap.delete(chatId); return msg.reply('🛑 Auto-react stopped.'); }

    case '/gif': {
      if (!process.env.GIPHY_API_KEY) return msg.reply('❌ Set GIPHY_API_KEY');
      try {
        const res = await fetch(`https://api.giphy.com/v1/gifs/search?api_key=${process.env.GIPHY_API_KEY}&q=${encodeURIComponent(text)}&limit=1`);
        const j = await res.json();
        const url = j.data?.[0]?.images?.original?.url;
        if (url) await chat.sendMessage(url);
      } catch (e) { console.error(e); }
      return msg.reply('✅ GIF sent.');
    }

    case '/reply': return msg.reply(text || '🤔');

    case '/timespam': {
      if (timespamState.has(chatId)) clearInterval(timespamState.get(chatId));
      const iv = setInterval(() => { const now = new Date().toTimeString().split(' ')[0]; chat.sendMessage(`${text} at ${now}`); }, 1000);
      timespamState.set(chatId, iv);
      return msg.reply('⏱ Timespam started.');
    }
    case '/stoptimespam': { if (timespamState.has(chatId)) { clearInterval(timespamState.get(chatId)); timespamState.delete(chatId); return msg.reply('🛑 Timespam stopped.'); } return msg.reply('⚠️ No timespam.'); }

    case '/timerspam': {
      if (timerspamState.has(chatId)) clearInterval(timerspamState.get(chatId));
      const iv = setInterval(() => { const now = new Date().toTimeString().split(' ')[0]; chat.sendMessage(`${text} at ${now}`); }, spamDelay);
      timerspamState.set(chatId, iv);
      return msg.reply(`⏱ Timerspam every ${spamDelay/1000}s.`);
    }
    case '/stoptimerspam': { if (timerspamState.has(chatId)) { clearInterval(timerspamState.get(chatId)); timerspamState.delete(chatId); return msg.reply('🛑 Timerspam stopped.'); } return msg.reply('⚠️ No timerspam.'); }

    // animevoice
    case '/animevoice': {
      // allow only admin (global guard already ensured caller is admin)
      if (!text) return msg.reply('Usage: /animevoice <voice> <text> OR /animevoice <text> OR /animevoice list');
      const voices = { meitan:1, meitan_amaama:2, meitan_genki:3, zundamon:10, yukari:11 };
      const parts = text.trim().split(/ +/);
      let voiceCandidate = parts[0];
      let speechText = parts.slice(1).join(' ');

      if (text.toLowerCase() === 'list') {
        const voiceList = Object.keys(voices).map(v => `• ${v}`).join('\n');
        return msg.reply(`🎤 Available voices:\n${voiceList}`);
      }

      if (!speechText) { speechText = voiceCandidate; voiceCandidate = null; }
      if (!speechText) return msg.reply('⚠️ Please provide text to speak.');

      const theChat = chat;
      let wavBuffer = null;

      // Try HF Space generator if available
      try {
        if (typeof generateFromSpaceAndDownload === 'function') {
          wavBuffer = await generateFromSpaceAndDownload(speechText, voiceCandidate);
        } else throw new Error('generateFromSpaceAndDownload not found');
      } catch (errSpace) {
        console.error('animevoice: HF Space failed:', errSpace?.message || errSpace);
        // fallback to local VOICEVOX
        try {
          const axiosLocal = require('axios');
          const speakerId = voices[(voiceCandidate || '').toLowerCase()] || 1;
          const qres = await axiosLocal.post(`http://127.0.0.1:50021/audio_query?text=${encodeURIComponent(speechText)}&speaker=${speakerId}`);
          const sres = await axiosLocal.post(`http://127.0.0.1:50021/synthesis?speaker=${speakerId}`, qres.data, { responseType: 'arraybuffer' });
          wavBuffer = Buffer.from(sres.data);
        } catch (errLocal) {
          console.error('animevoice: Local VOICEVOX failed:', errLocal?.message || errLocal);
          return msg.reply('Talk to Aryan.');
        }
      }

      if (!wavBuffer || !Buffer.isBuffer(wavBuffer)) return msg.reply('⚠️ No audio generated.');

      const audioPath = `./animevoice-${Date.now()}.wav`;
      try { fs.writeFileSync(audioPath, wavBuffer); } catch (e) { console.error(e); return msg.reply('⚠️ Failed to save audio file.'); }

      try { execSync('ffmpeg -version', { stdio: 'ignore' }); } catch (e) { try { fs.unlinkSync(audioPath); } catch(_){}; return msg.reply('TAlk to Aryan'); }

      const oggPath = audioPath.replace('.wav', '.ogg');
      try { execSync(`ffmpeg -y -i "${audioPath}" -c:a libopus "${oggPath}"`, { stdio: 'ignore' }); }
      catch (e) { console.error(e); try { fs.unlinkSync(audioPath); } catch(_){}; return msg.reply('⚠️ failed to convert audio.'); }

      try {
        const media = MessageMedia.fromFilePath(oggPath);
        await client.sendMessage(theChat.id._serialized, media, { sendAudioAsVoice: true });
      } catch (sendErr) {
        console.error('animevoice: send failed, trying fallback', sendErr);
        try { const media = MessageMedia.fromFilePath(oggPath); await theChat.sendMessage(media, { sendAudioAsVoice: true }); }
        catch (sendErr2) { console.error(sendErr2); try { fs.unlinkSync(audioPath); } catch(_){}; try { fs.unlinkSync(oggPath); } catch(_){}; return msg.reply('⚠️ Failed to send voice note.'); }
      }

      // cleanup
      try { fs.unlinkSync(audioPath); } catch(_) {}
      try { fs.unlinkSync(oggPath); } catch(_) {}
      return true;
    }

    default:
      return msg.reply('❓ Unknown command. Try /help');
  } // switch
} // processCommand

// ---- 1) Incoming messages (any user or subadmin) ----
client.on('message', async msg => {
  const body = (msg.body || '').trim();
  if (!body) return;

  // If command, process
  if (body.startsWith('/')) {
    const handled = await processCommand(msg);
    if (handled) return; // handled or silently ignored
  }

  const chat = await msg.getChat();
  const chatId = chat.id._serialized;

  // /vote handling
  if (body.toLowerCase().startsWith('/vote ')) {
    const num = parseInt(body.split(' ')[1], 10);
    const poll = pollMap.get(chatId);
    if (!poll) return msg.reply('⚠️ No poll active.');
    if (isNaN(num) || num < 1 || num > poll.options.length) return msg.reply(`❗ Choose 1–${poll.options.length}.`);
    const voter = msg.from;
    for (const voters of poll.votes.values()) voters.delete(voter);
    poll.votes.get(num-1).add(voter);
    return msg.reply(`✅ Your vote for option ${num} recorded.`);
  }

  // target-slide reactive replies
  if (!body.toLowerCase().startsWith('/targetslide')) {
    const st = slideState.get(chatId);
    if (st) {
      const sender = chat.isGroup ? msg.author : msg.from;
      if (sender === st.targetJid) return msg.reply(st.slideText);
    }
  }

  if (!body.startsWith('/') && !msg.fromMe) {           // skip commands and bot messages
    const emoji = reactEmojiMap.get(chatId);            // /react stores emoji keyed by chatId
    if (emoji) {
      try {
        await msg.react(emoji);
      } catch (err) {
        console.error('Auto-react failed (incoming):', err);
      }
    }
  }

  // spam auto-reply (by chat)
  const auto = spamReplyTextMap.get(chatId);
  if (auto) await msg.reply(auto);
});

// ---- 2) Owner outgoing messages & owner commands ----
client.on('message_create', async msg => {
  if (!msg.fromMe) return;
  if (msg.body && typeof msg.body === 'string' && msg.body.trim().startsWith('/')) {
    const handled = await processCommand(msg);
    if (handled) return;
  }

  // auto-react for owner outgoing non-command messages
  if (!msg.body || typeof msg.body !== 'string') return;
  if (msg.body.startsWith('/')) return;
  const emoji = reactEmojiMap.get(msg.to);
  if (emoji) {
    try { await msg.react(emoji); } catch (e) { console.error('React failed', e); }
  }
});

// ---- Start Bot ----
client.initialize();

