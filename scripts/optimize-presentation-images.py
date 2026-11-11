#!/usr/bin/env python3
"""Rebuild the responsive artwork from the retained PNG originals (Pillow)."""
from pathlib import Path
import json
from PIL import Image

root = Path(__file__).resolve().parents[1]
manifest = root / 'scripts/presentation-images.json'
images = json.loads(manifest.read_text())
for item in images:
    source = root / 'public' / item['source']
    with Image.open(source) as original:
        item.update(bytes=source.stat().st_size, width=original.width, height=original.height)
        for variant in item['variants']:
            image = original.copy()
            image.thumbnail((variant['width'], 10000), Image.Resampling.LANCZOS)
            output = root / 'public' / variant['path']
            image.save(output, 'WEBP', quality=82, method=6)
            variant.update(width=image.width, height=image.height, bytes=output.stat().st_size)
manifest.write_text(json.dumps(images, indent=2) + '\n')
print('Rebuilt responsive artwork and measured byte sizes; original PNGs retained.')
