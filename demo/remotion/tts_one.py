"""edge-tts for one line: writes the mp3, prints word boundaries as JSON (seconds).
usage: python tts_one.py VOICE RATE TEXTFILE OUT.mp3"""
import asyncio, json, sys
import edge_tts

async def main(voice, rate, text_file, out):
    text = open(text_file, encoding="utf-8").read()
    words = []
    with open(out, "wb") as f:
        async for ch in edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary").stream():
            if ch["type"] == "audio":
                f.write(ch["data"])
            elif ch["type"] == "WordBoundary":
                words.append({"t": ch["offset"] / 1e7, "d": ch["duration"] / 1e7, "w": ch["text"]})
    print(json.dumps(words))

asyncio.run(main(*sys.argv[1:5]))
