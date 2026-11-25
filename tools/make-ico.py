#!/usr/bin/env python3
"""把 assets/icon.png 转成 Windows 的 .ico（Vista+ 用 PNG 压缩的单帧即可）"""
import os
import struct
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'icon.png')
OUT = os.path.join(ROOT, 'assets', 'AppIcon.ico')
SIZES = [16, 24, 32, 48, 64, 128, 256]


def resize(size):
    tmp = tempfile.mktemp(suffix=f'_{size}.png')
    subprocess.run(['sips', '-z', str(size), str(size), SRC, '--out', tmp],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    with open(tmp, 'rb') as f:
        data = f.read()
    os.unlink(tmp)
    return data


def main():
    if not os.path.exists(SRC):
        sys.exit(f'缺少源图 {SRC}，先跑 npm run icon')

    frames = [(s, resize(s)) for s in SIZES]

    header = struct.pack('<HHH', 0, 1, len(frames))
    offset = 6 + 16 * len(frames)
    entries, blobs = b'', b''
    for size, data in frames:
        dim = 0 if size >= 256 else size
        entries += struct.pack('<BBBBHHII', dim, dim, 0, 0, 1, 32, len(data), offset)
        blobs += data
        offset += len(data)

    with open(OUT, 'wb') as f:
        f.write(header + entries + blobs)
    print(f'{OUT}  ({os.path.getsize(OUT)} bytes, {len(frames)} 帧)')


if __name__ == '__main__':
    main()
