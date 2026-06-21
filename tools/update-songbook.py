import sqlite3
import urllib.request
import re
import html
import ssl
import threading
import shutil
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor

db_path = "/Users/mandinu/Documents/New project/recovered.sqlite"
db_downloads = "/Users/mandinu/Downloads/recovered.sqlite"
tools_dir = "/Users/mandinu/Documents/New project/tools"

ssl_context = ssl._create_unverified_context()

def get_live_song_ids():
    url = "https://chordslankalk.com/sitemap.xml"
    print("Fetching live sitemap from chordslankalk.com...", flush=True)
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, context=ssl_context, timeout=20) as response:
            sitemap = response.read().decode('utf-8', errors='replace')
        # Extract song_id from song_view.php?song_id=XXX
        found_ids = re.findall(r'song_view\.php\?song_id=(\d+)', sitemap)
        unique_ids = sorted(list(set(int(x) for x in found_ids)))
        print(f"Discovered {len(unique_ids)} song URLs on the live website sitemap.", flush=True)
        return unique_ids
    except Exception as e:
        print(f"Error fetching live sitemap: {e}. Falling back to default range.", flush=True)
        return []

def clean_name(val):
    if not val:
        return ""
    val = html.unescape(val)
    val = re.sub(r'\s+', ' ', val)
    return val.strip()

def run_update():
    # 1. Fetch live song list
    live_ids = get_live_song_ids()
    if not live_ids:
        print("Could not retrieve song URLs. Update canceled.", flush=True)
        return

    # 2. Connect to database and read existing data
    if not os.path.exists(db_path):
        print(f"Database not found at {db_path}!", flush=True)
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Load existing artists
    cursor.execute("SELECT c0, c1 FROM lost_and_found WHERE nfield=9")
    artists = {}
    for row in cursor.fetchall():
        if row[0] and row[1]:
            name_clean = re.sub(r'\s+', ' ', row[1]).strip().lower()
            artists[name_clean] = str(row[0]).strip()

    # Load existing song IDs
    cursor.execute("SELECT c0 FROM lost_and_found WHERE nfield=11")
    existing_song_ids = {str(row[0]).strip() for row in cursor.fetchall() if row[0] is not None}

    # Find max artist ID
    cursor.execute("SELECT MAX(CAST(c0 AS INTEGER)) FROM lost_and_found WHERE nfield=9")
    max_artist_id = cursor.fetchone()[0] or 10000

    conn.close()

    print(f"Database currently contains {len(existing_song_ids)} songs.", flush=True)

    # 3. Identify missing IDs
    missing_ids = [sid for sid in live_ids if str(sid) not in existing_song_ids]
    if not missing_ids:
        print("Your songbook is already up to date! No new songs found.", flush=True)
        return

    print(f"Found {len(missing_ids)} new songs to download. Starting crawl...", flush=True)

    # 4. Perform crawl
    db_lock = threading.Lock()
    id_lock = threading.Lock()
    
    current_artist_id = max_artist_id + 1
    
    stats = {
        "scraped": 0,
        "inserted_artists": 0,
        "inserted_songs": 0,
        "errors": 0
    }
    stats_lock = threading.Lock()

    def scrape_and_insert(song_id):
        nonlocal current_artist_id
        url = f"https://chordslankalk.com/song_view.php?song_id={song_id}"
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, context=ssl_context, timeout=5) as response:
                html_content = response.read().decode('utf-8', errors='replace')
        except Exception as e:
            with stats_lock:
                stats["errors"] += 1
            return

        # Parse Title & Artist
        title_match = re.search(r'<title>(.*?) Chords and Lyrics By Artist (.*?)<\/title>', html_content, re.IGNORECASE)
        if not title_match:
            title_match = re.search(r'<title>(.*?)<\/title>', html_content, re.IGNORECASE)
            if not title_match:
                return
            title_str = clean_name(title_match.group(1))
            artist_str = "Various Artists"
        else:
            title_str = clean_name(title_match.group(1))
            artist_str = clean_name(title_match.group(2))

        if "Chords and Lyrics" in title_str:
            title_str = title_str.replace("Chords and Lyrics", "").strip()

        if not title_str or any(word in title_str for word in ["Index", "Contributors", "Register", "Login"]):
            return

        artist_key = artist_str.lower()

        # Parse Key & Beat
        key_match = re.search(r'<td[^>]*>Key:<\/td>\s*<td[^>]*>([^<]+)<\/td>', html_content, re.IGNORECASE)
        beat_match = re.search(r'<td[^>]*>Beat:<\/td>\s*<td[^>]*>([^<]+)<\/td>', html_content, re.IGNORECASE)
        key = clean_name(key_match.group(1)) if key_match else "-"
        beat = clean_name(beat_match.group(1)) if beat_match else "-"

        # Parse Chords
        chords_match = re.search(r'<pre[^>]*transpose-ref="[^"]*"[^>]*>([\s\S]*?)<\/pre>', html_content, re.IGNORECASE)
        if not chords_match:
            chords_match = re.search(r'<pre[^>]*>([\s\S]*?)<\/pre>', html_content, re.IGNORECASE)
            if not chords_match:
                return

        chords_text = html.unescape(chords_match.group(1).strip())
        if not chords_text:
            return

        # Insert to database
        with db_lock:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()

            # Process artist
            art_id = artists.get(artist_key)
            if not art_id:
                art_id = str(current_artist_id)
                current_artist_id += 1
                try:
                    cursor.execute("""
                        INSERT INTO lost_and_found (rootpgno, pgno, nfield, id, c0, c1, c2, c3, c8)
                        VALUES (0, 0, 9, ?, ?, ?, '1', '2026-06-21', '0')
                    """, (int(art_id), art_id, artist_str))
                    artists[artist_key] = art_id
                    with stats_lock:
                        stats["inserted_artists"] += 1
                except Exception:
                    pass

            # Process song
            song_html = f"""<table>
	<tbody>
		<tr>
			<td>Artist</td>
			<td>&nbsp; - &nbsp;{artist_str}&nbsp;</td>
		</tr>
		<tr>
			<td>Song</td>
			<td>&nbsp; - &nbsp;{title_str}</td>
		</tr>
		<tr>
			<td>Key</td>
			<td>&nbsp; - &nbsp;{key}</td>
		</tr>
		<tr>
			<td>Beat</td>
			<td>&nbsp; - &nbsp;{beat}</td>
		</tr>
	</tbody>
</table>

<pre>
{chords_text}
</pre>"""

            s_id = str(song_id)
            try:
                cursor.execute("""
                    INSERT INTO lost_and_found (rootpgno, pgno, nfield, id, c0, c1, c2, c3, c4, c5, c6, c9)
                    VALUES (0, 0, 11, ?, ?, ?, '1', '2026-06-21', ?, ?, 3, '0')
                """, (int(s_id), s_id, title_str, art_id, song_html))
                with stats_lock:
                    stats["inserted_songs"] += 1
            except Exception:
                pass

            conn.commit()
            conn.close()

        with stats_lock:
            stats["scraped"] += 1
            if stats["scraped"] % 20 == 0 or stats["scraped"] == len(missing_ids):
                print(f"Progress: Processed {stats['scraped']}/{len(missing_ids)}... Added {stats['inserted_songs']} new songs, {stats['inserted_artists']} new artists", flush=True)

    with ThreadPoolExecutor(max_workers=10) as executor:
        executor.map(scrape_and_insert, missing_ids)

    print("\n--- Download Complete ---", flush=True)
    print(f"Songs fetched: {stats['scraped']}", flush=True)
    print(f"Songs added to database: {stats['inserted_songs']}", flush=True)
    print(f"Artists added to database: {stats['inserted_artists']}", flush=True)
    print(f"Failures: {stats['errors']}", flush=True)

    # 5. Automatically run the JSON manifest generator
    if stats["inserted_songs"] > 0:
        print("\nRegenerating JSON manifest data.js...", flush=True)
        gen_script = os.path.join(tools_dir, "generate-data.mjs")
        try:
            output = subprocess.check_output(["node", gen_script], text=True, stderr=subprocess.STDOUT)
            print(output.strip(), flush=True)
        except Exception as e:
            print(f"Error running generate-data.mjs: {e}", flush=True)

        # 6. Copy database to Downloads folder to keep synchronized
        print(f"\nSynchronizing database copy to {db_downloads}...", flush=True)
        try:
            shutil.copy2(db_path, db_downloads)
            print("Database successfully synchronized.", flush=True)
        except Exception as e:
            print(f"Error copying database: {e}", flush=True)
    else:
        print("\nNo new songs were added. Manifest update skipped.", flush=True)

if __name__ == "__main__":
    run_update()
