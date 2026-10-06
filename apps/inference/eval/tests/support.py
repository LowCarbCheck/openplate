"""Shared helpers for the eval harness tests: the real contract, valid answers, a fake HTTP client."""

from __future__ import annotations

import copy
import io
import json
from pathlib import Path

from harness import providers
from harness.contract import DEFAULT_CONTRACT_PATH, Contract, load_contract

EVAL_ROOT = Path(__file__).resolve().parent.parent


def real_contract() -> Contract:
    return load_contract(EVAL_ROOT / DEFAULT_CONTRACT_PATH)


def tiny_jpeg_bytes(width: int = 40, height: int = 30) -> bytes:
    """A real JPEG, made with Pillow (a test dependency only when Pillow exists)."""
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (200, 120, 40)).save(buffer, format="JPEG")
    return buffer.getvalue()


def valid_plate_answer() -> dict:
    return {
        "foods": [
            {
                "name": "scrambled eggs",
                "estimatedGrams": 120,
                "confidence": "high",
                "portionHint": None,
                "macrosPer100g": {"carbs": 1.5, "fiber": 0, "sugars": 1, "polyols": None, "protein": 10, "fat": 11, "kcal": 150},
                "macroSource": "estimated",
                "brand": None,
                "servingSize": None,
                "carbBasis": None,
                "flags": {"pregnancy": ["raw-egg"], "allergens": ["eggs"], "mayContain": []},
                "translations": {"en": "scrambled eggs", "de": "Rührei", "fr": "oeufs brouillés", "it": "uova strapazzate", "es": "huevos revueltos", "tr": "çırpılmış yumurta"},
            }
        ],
        "unreadable": False,
        "unreadableReason": None,
        "notes": None,
    }


def valid_pantry_answer() -> dict:
    return {
        "items": [
            {
                "name": "eggs",
                "amount": 6,
                "unit": "piece",
                "category": "egg",
                "confidence": "high",
                "translations": {"en": "eggs", "de": "Eier", "fr": "oeufs", "it": "uova", "es": "huevos", "tr": "yumurta"},
            }
        ],
        "notes": None,
    }


def valid_recipe_answer() -> dict:
    return {
        "recipes": [
            {
                "title": "Spinach omelette",
                "servings": 1,
                "servingGrams": 250,
                "ingredients": [
                    {"name": "eggs", "amount": 3, "unit": "piece", "fromPantry": True},
                    {"name": "salt", "amount": None, "unit": None, "fromPantry": False},
                ],
                "steps": ["Whisk the eggs.", "Cook."],
                "perServing": {"kcal": 400, "proteinG": 28, "carbsG": 4, "fiberG": 2, "fatG": 30},
                "whyItFits": "High in protein, low in carbs.",
                "prepMinutes": 10,
            }
        ]
    }


def deep(value):
    return copy.deepcopy(value)


class FakeClient:
    """Stands in for `ChatClient`: records every body it is given and answers from a script."""

    def __init__(self, answer: dict | str | None = None, *, status: int = 200, envelope: dict | None = None):
        self.base_url = "https://fake.invalid/api/v1"
        self.bodies: list[dict] = []
        self._status = status
        self._answer = answer
        self._envelope = envelope

    def post_raw(self, body: dict) -> providers.RawResponse:
        self.bodies.append(copy.deepcopy(body))
        if self._envelope is not None:
            text = json.dumps(self._envelope)
        else:
            content = self._answer if isinstance(self._answer, str) else json.dumps(self._answer)
            text = json.dumps(
                {
                    "model": "fake/model-001",
                    "provider": "FakeVertex",
                    "choices": [{"message": {"role": "assistant", "content": content}, "finish_reason": "stop"}],
                    "usage": {
                        "prompt_tokens": 1000,
                        "completion_tokens": 200,
                        "completion_tokens_details": {"reasoning_tokens": 30},
                        "cost": 0.00123,
                    },
                }
            )
        return providers.RawResponse(status=self._status, body_text=text, latency_ms=12.5, attempts=1)
