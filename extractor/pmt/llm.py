"""LLM provider abstraction (Anthropic API by default, Amazon Bedrock optional)."""

from __future__ import annotations

import base64
import json
import logging
import os
from dataclasses import dataclass, field

import anthropic

from .pdf import Chunk
from .schema import EXTRACTION_JSON_SCHEMA, RawExtraction

log = logging.getLogger(__name__)

# USD per 1M tokens: (input, output, cache_read, cache_write_5m)
PRICING = {
    "claude-opus-5-5": (4.00, 20.00, 0.20, 5.00),
    "claude-sonnet-5-5": (2.00, 10.00, 0.10, 2.50),
    "claude-haiku-5-5": (0.10, 0.50, 0.01, 0.125),
}


@dataclass
class LLMConfig:
    provider: str = field(default_factory=lambda: os.environ.get("PMT_PROVIDER", "anthropic"))
    model: str = field(default_factory=lambda: os.environ.get("PMT_MODEL", "claude-opus-5-5"))
    effort: str = field(default_factory=lambda: os.environ.get("PMT_EFFORT", "medium"))
    aws_region: str = field(default_factory=lambda: os.environ.get("AWS_REGION", "us-east-1"))
    max_tokens: int = 64000


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_input_tokens: int = 0
    cache_creation_input_tokens: int = 0

    def add(self, u) -> None:
        self.input_tokens += getattr(u, "input_tokens", 0) or 0
        self.output_tokens += getattr(u, "output_tokens", 0) or 0
        self.cache_read_input_tokens += getattr(u, "cache_read_input_tokens", 0) or 0
        self.cache_creation_input_tokens += getattr(u, "cache_creation_input_tokens", 0) or 0

    def cost(self, model: str) -> float | None:
        p = PRICING.get(model.removeprefix("anthropic."))
        if not p:
            return None
        i, o, cr, cw = p
        return round(
            (self.input_tokens * i + self.output_tokens * o + self.cache_read_input_tokens * cr
             + self.cache_creation_input_tokens * cw) / 1e6,
            4,
        )

    def as_dict(self) -> dict:
        return dict(self.__dict__)


class ExtractionError(RuntimeError):
    pass


class Extractor:
    def __init__(self, system_prompt: str, cfg: LLMConfig | None = None):
        self.cfg = cfg or LLMConfig()
        self.system = [{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}]
        if self.cfg.provider == "bedrock":
            self.client = anthropic.AnthropicBedrockMantle(aws_region=self.cfg.aws_region)
            self.model = self.cfg.model if self.cfg.model.startswith("anthropic.") else f"anthropic.{self.cfg.model}"
        else:
            self.client = anthropic.Anthropic(max_retries=4)
            self.model = self.cfg.model

    def _content(self, chunk: Chunk) -> list[dict]:
        b64 = base64.standard_b64encode(chunk.data).decode("ascii")
        if chunk.media_type == "application/pdf":
            block = {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": b64}}
        else:
            block = {"type": "image", "source": {"type": "base64", "media_type": chunk.media_type, "data": b64}}
        note = (
            f"This chunk has {chunk.n_pages} page(s): original pages {chunk.first_page}–"
            f"{chunk.first_page + chunk.n_pages - 1}. Transcribe it."
        )
        return [block, {"type": "text", "text": note}]

    def extract(self, chunk: Chunk, usage: Usage) -> RawExtraction:
        kwargs = dict(
            model=self.model,
            max_tokens=self.cfg.max_tokens,
            system=self.system,
            messages=[{"role": "user", "content": self._content(chunk)}],
            output_config={
                "effort": self.cfg.effort,
                "format": {"type": "json_schema", "schema": EXTRACTION_JSON_SCHEMA},
            },
        )
        if self.cfg.provider == "anthropic":
            # Server-side refusal fallback (routes by refusal category; no model list to maintain).
            kwargs.update(betas=["server-side-fallback-2026-07-01"], fallbacks="default")
            stream_ctx = self.client.beta.messages.stream(**kwargs)
        else:
            stream_ctx = self.client.messages.stream(**kwargs)
        with stream_ctx as stream:
            msg = stream.get_final_message()
        usage.add(msg.usage)
        if msg.stop_reason == "refusal":
            raise ExtractionError(f"model declined pages {chunk.first_page}+ ({getattr(msg, 'stop_details', None)})")
        if msg.stop_reason == "max_tokens":
            raise ExtractionError(f"output truncated for pages {chunk.first_page}+; use smaller chunks")
        text = next((b.text for b in msg.content if b.type == "text"), None)
        if not text:
            raise ExtractionError("empty model response")
        raw = RawExtraction.model_validate(json.loads(text))
        # chunk-relative → document page numbers
        off = chunk.first_page - 1
        for coll in (raw.pages, raw.results, raw.findings):
            for item in coll:
                item.page = min(max(item.page, 1), chunk.n_pages) + off
        return raw
