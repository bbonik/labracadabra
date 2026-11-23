"""Split inputs into page chunks that fit comfortably in one request."""

from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass

from pypdf import PdfReader, PdfWriter

IMAGE_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}

MAX_CHUNK_BYTES = 24 * 1024 * 1024  # request limit is 32 MB incl. base64 overhead (×1.33)


@dataclass
class Chunk:
    first_page: int  # 1-based page number in the original document
    n_pages: int
    data: bytes
    media_type: str  # application/pdf | image/*


def media_type_for(filename: str, data: bytes) -> str:
    name = filename.lower()
    for ext, mt in IMAGE_TYPES.items():
        if name.endswith(ext):
            return mt
    if data[:5] == b"%PDF-":
        return "application/pdf"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    raise ValueError(f"unsupported file type: {filename}")


def _reader(data: bytes) -> PdfReader:
    """Open a PDF; labs often 'protect' reports with an empty user password (AES), which we can open."""
    r = PdfReader(io.BytesIO(data))
    if r.is_encrypted and not r.decrypt(""):
        raise ValueError("PDF is password-protected; please upload an unprotected copy")
    return r


def page_count(data: bytes, media_type: str) -> int:
    if media_type != "application/pdf":
        return 1
    return len(_reader(data).pages)


def content_fingerprint(data: bytes, media_type: str) -> str:
    """Identity of a document's *content*: the same report re-downloaded or re-saved (new metadata, new bytes)
    gets the same fingerprint, so it is not paid for twice. Falls back to the bytes for scans and images."""
    if media_type == "application/pdf":
        try:
            r = _reader(data)
            text = "\f".join((p.extract_text() or "").strip() for p in r.pages)
            if len("".join(text.split())) >= 200 * max(1, len(r.pages)) ** 0.5:
                return "text:" + hashlib.sha256(f"{len(r.pages)}|{text}".encode()).hexdigest()
        except Exception:  # noqa: BLE001 - fingerprinting must never block an upload
            pass
    return "bytes:" + hashlib.sha256(data).hexdigest()


def split(data: bytes, media_type: str, pages_per_chunk: int = 8) -> list[Chunk]:
    if media_type != "application/pdf":
        return [Chunk(1, 1, data, media_type)]
    reader = _reader(data)
    n = len(reader.pages)
    chunks: list[Chunk] = []
    start = 0
    while start < n:
        size = min(pages_per_chunk, n - start)
        while True:
            w = PdfWriter()
            for i in range(start, start + size):
                w.add_page(reader.pages[i])
            buf = io.BytesIO()
            w.write(buf)
            blob = buf.getvalue()
            if len(blob) <= MAX_CHUNK_BYTES or size == 1:
                break
            size = max(1, size // 2)
        chunks.append(Chunk(start + 1, size, blob, "application/pdf"))
        start += size
    return chunks
