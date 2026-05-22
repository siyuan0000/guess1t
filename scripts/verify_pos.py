"""
verify_pos.py — Verify and correct POS tags in words.json using Merriam-Webster.

For each word:
  1. Fetch the Merriam-Webster dictionary page
  2. Extract POS from HTML (<span class="fl"> tag)
  3. If ambiguous, call ollama deepseek-R1 to classify
  4. Compare with existing tag, flag mismatches
  5. Output corrected words.json + pos_corrections.csv

Usage:
  python3 scripts/verify_pos.py
"""

import json
import csv
import re
import time
import subprocess
import sys
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import HTTPError, URLError
from html.parser import HTMLParser


# ── POS Mapping ──
# Merriam-Webster uses full POS names; we map to our short format
MW_POS_MAP = {
    'noun': 'noun',
    'verb': 'verb',
    'adjective': 'adj',
    'adverb': 'adv',
    'transitive verb': 'verb',
    'intransitive verb': 'verb',
    'auxiliary verb': 'verb',
    'phrasal verb': 'verb',
    'linking verb': 'verb',
    'modal verb': 'verb',
    'adverb': 'adv',
    'preposition': 'adj',   # rare in our pool
    'conjunction': 'adj',   # rare in our pool
    'pronoun': 'noun',      # rare in our pool
}


class MWPOSParser(HTMLParser):
    """Parse Merriam-Webster HTML to extract POS from <span class="fl"> tags."""

    def __init__(self):
        super().__init__()
        self._in_fl = False
        self._pos_tags = []

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        # MW puts POS in <span class="fl"> or <a class="important-blue-link">
        if tag == 'span' and attrs_dict.get('class', '') == 'fl':
            self._in_fl = True
        elif tag == 'a' and 'important-blue-link' in attrs_dict.get('class', ''):
            self._in_fl = True

    def handle_endtag(self, tag):
        if tag in ('span', 'a'):
            self._in_fl = False

    def handle_data(self, data):
        if self._in_fl:
            text = data.strip().lower()
            if text:
                self._pos_tags.append(text)

    def get_pos_tags(self):
        return self._pos_tags


def fetch_mw_page(word, retries=3):
    """Fetch Merriam-Webster dictionary page for a word."""
    url = f"https://www.merriam-webster.com/dictionary/{word}"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                       'AppleWebKit/537.36 (KHTML, like Gecko) '
                       'Chrome/120.0.0.0 Safari/537.36'
    }
    for attempt in range(retries):
        try:
            req = Request(url, headers=headers)
            with urlopen(req, timeout=15) as resp:
                return resp.read().decode('utf-8', errors='replace')
        except HTTPError as e:
            if e.code == 404:
                return None  # Word not found on MW
            if attempt < retries - 1:
                time.sleep(2 * (attempt + 1))
        except (URLError, OSError) as e:
            if attempt < retries - 1:
                time.sleep(2 * (attempt + 1))
    return None


def extract_pos_from_html(html):
    """Extract POS tags from MW HTML."""
    parser = MWPOSParser()
    parser.feed(html)
    raw_tags = parser.get_pos_tags()

    # Normalize and deduplicate
    normalized = []
    for tag in raw_tags:
        # Clean up MW formatting artifacts
        tag = tag.strip().rstrip(' /')
        if tag in MW_POS_MAP:
            mapped = MW_POS_MAP[tag]
            if mapped not in normalized:
                normalized.append(mapped)

    return normalized


def ask_ollama_pos(word, definition):
    """Use ollama deepseek-R1 to determine POS from word + definition."""
    prompt = (
        f'What is the part of speech of the English word "{word}"? '
        f'Its definition is: "{definition}". '
        f'Reply with ONLY one of: noun, verb, adj, adv. '
        f'Nothing else.'
    )

    try:
        result = subprocess.run(
            ['ollama', 'run', 'deepseek-R1:latest'],
            input=prompt,
            capture_output=True,
            text=True,
            timeout=60
        )
        output = result.stdout.strip().lower()
        # Extract the POS from the output (deepseek may be verbose)
        # Look for our target labels
        for label in ['adj', 'adv', 'verb', 'noun']:
            if label in output.split('\n')[-1]:  # Check last line
                return label
        # Broader search
        for label in ['adjective', 'adverb', 'verb', 'noun']:
            if label in output:
                return MW_POS_MAP.get(label, label)
        return None
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None


def verify_all_words(words_path, output_path, report_path):
    """Main verification loop."""
    with open(words_path) as f:
        words = json.load(f)

    corrections = []
    updated_words = []
    total = len(words)

    print(f"Verifying POS tags for {total} words against Merriam-Webster...")
    print("=" * 70)

    for i, entry in enumerate(words):
        word = entry['word']
        current_pos = entry.get('pos', '')
        definition = entry.get('definition', '')

        print(f"[{i+1}/{total}] {word:20s}  current={current_pos:6s}", end="  ", flush=True)

        # Step 1: Fetch MW page
        html = fetch_mw_page(word)

        if html is None:
            print("⚠ MW not found, keeping current")
            updated_words.append(entry)
            continue

        # Step 2: Extract POS from HTML
        mw_pos_list = extract_pos_from_html(html)

        if not mw_pos_list:
            # Step 3: Fallback to ollama
            print("→ ollama fallback...", end=" ", flush=True)
            ollama_pos = ask_ollama_pos(word, definition)
            if ollama_pos:
                mw_pos_list = [ollama_pos]
                print(f"ollama={ollama_pos}", end="  ")
            else:
                print("⚠ No POS found, keeping current")
                updated_words.append(entry)
                continue

        # Step 4: Determine the correct POS
        # If current POS is in the MW list, it's fine
        # Otherwise, use the first (primary) MW POS
        true_pos = mw_pos_list[0]

        if current_pos == true_pos or current_pos in mw_pos_list:
            print(f"✓ MW={','.join(mw_pos_list)}")
            updated_words.append(entry)
        else:
            print(f"✗ MW={','.join(mw_pos_list)}  → {true_pos}")
            corrections.append({
                'word': word,
                'old_pos': current_pos,
                'new_pos': true_pos,
                'mw_all_pos': ','.join(mw_pos_list),
                'definition': definition
            })
            corrected_entry = dict(entry)
            corrected_entry['pos'] = true_pos
            updated_words.append(corrected_entry)

        # Rate limit: be polite to MW
        time.sleep(0.5)

    # Save corrected words.json
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(updated_words, f, indent=2, ensure_ascii=False)
    print(f"\n✓ Saved corrected words to {output_path}")

    # Save correction report
    if corrections:
        with open(report_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=['word', 'old_pos', 'new_pos', 'mw_all_pos', 'definition'])
            writer.writeheader()
            writer.writerows(corrections)
        print(f"✓ Found {len(corrections)} corrections — saved to {report_path}")
    else:
        print("✓ No corrections needed — all POS tags are accurate!")

    print(f"\nSummary: {total} words checked, {len(corrections)} corrected")
    return corrections


def main():
    root = Path(__file__).resolve().parent.parent
    words_path = root / 'data' / 'words.json'
    output_path = root / 'data' / 'words.json'  # Overwrite in place
    report_path = root / 'data' / 'pos_corrections.csv'

    verify_all_words(words_path, output_path, report_path)


if __name__ == '__main__':
    main()
