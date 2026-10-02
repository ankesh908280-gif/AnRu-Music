# 🎵 Anru Music (AR Studio) - Pro Web App & Offline Music Player

Anru Focus ke premium glassmorphism dark theme aur neon aurora design se inspired ek high-performance music web app (PWA). Isme aap **Bhojpuri, Bollywood, Punjabi, English** aur sabhi regional gaane high-quality me stream kar sakte hain aur **in-app offline download** karke bina internet ke sun sakte hain.

---

## 💎 Naye Features Aur Improvements (V2 Update)

1. **Anru Focus Theme & Glassmorphism**:
   - Deep cosmic background (`#0f0c29` se `#302b63`), ambient floating glowing orbs, aur glassmorphic panels.
   - **Theme Selector**: Top-right palette icon se aap 5 premium themes choose kar sakte hain:
     - 🟣 **Aurora Purple** (Default Anru Focus signature)
     - 🔴 **Cyber Neon**
     - 🔵 **Ocean Blue**
     - 🟢 **Matrix Green**
     - 🟠 **Sunset Gold**
2. **FontAwesome 6 Icons (Zero Emojis)**:
   - Sabhi emojis ko hata kar modern, sharp FontAwesome vector icons aur Google 'Outfit' typography ka use kiya gaya hai.
3. **Resilient Multi-Source Search**:
   - Search kabhi fail na ho iske liye JioSaavn ke multiple live mirrors + CORS proxy fallbacks + iTunes HD catalog + instant local cache add kiya gaya hai.
4. **Offline Download Engine (IndexedDB)**:
   - Gaane sidha phone ki internal memory me save hote hain aur airplane mode / no-internet me 100% offline play hote hain.
5. **Background & Lock Screen Controls (MediaSession API)**:
   - Phone lock hone par ya background me hone par album art, title, artist, aur play/pause/seek controls notification bar me dikhte hain.

---

## 🖼️ Icon Replacement Guide (Aapki Bheji Hui Image Ke Liye)

Humne app me aapke naye icon ka structure bilkul ready kar diya hai:
* App header, PWA manifest, aur browser tab me icon ka main path: **`icons/icon-512.png`** hai.
* **Aapko kya karna hai**:
  1. Jo image aapne upload ki thi, uska naam rename karke **`icon-512.png`** rakh dein.
  2. Us file ko `icons/` folder ke andar paste/replace kar dein (aur chahein to wahi photo `icons/icon-512.png` aur `icons/icon-192.png` me bhi paste kar sakte hain).
  3. GitHub par upload karte samay yeh automatically app logo aur phone icon ban jayega!

---

## 📱 Mobile Se GitHub Par Upload Aur Free Host Kaise Karein

Aapke paas laptop nahi hai, to apne **Mobile Chrome Browser** se 2 minute me live karein:

### Step 1: GitHub Par Repository Banayein
1. Apne phone browser me **[github.com](https://github.com)** kholein aur account login karein.
2. Top right me **`+`** icon daba kar **New repository** chunein.
3. Repository name me `anru-music` (ya koi bhi manchaha naam) likhein.
4. Isse **Public** select karein aur **Create repository** par tap karein.

### Step 2: Code Upload Karein
1. Drive se mili hui `music app.zip` file ko apne phone me unzip (extract) karein.
2. GitHub repository me **"uploading an existing file"** option par click karein.
3. Saari files select karke upload kar dein:
   - `index.html`
   - `style.css`
   - `app.js`
   - `manifest.json`
   - `sw.js`
   - `README.md`
   - `icons/` folder (jisme aapka `icon-512.png`, `icon-192.png`, `icon-512.png`, `favicon.png` hai)
4. Neeche **Commit changes** button dabayein.

### Step 3: GitHub Pages Enable Karein
1. Repository ke upar **Settings** tab me jayein.
2. Left side menu me **Pages** par tap karein.
3. **Branch** me `None` ki jagah **`main`** select karein aur `/ (root)` chunein, fir **Save** dabayein.
4. 1 minute me aapki live link active ho jayegi:
   `https://<your-username>.github.io/anru-music/`

### Step 4: Phone Me App Install Karein
1. Is live link ko apne mobile ke Google Chrome me kholein.
2. Browser ke 3-dots (Menu) par tap karke **"Install app"** ya **"Add to Home screen"** dabayein.
3. Ab aapke mobile par bina laptop ke aapka apna music app install ho jayega!
