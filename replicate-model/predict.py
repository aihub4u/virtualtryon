# predict.py
import os

os.environ.setdefault("HF_HOME", "/src/hf-cache")

from cog import BasePredictor, Input, Path
from PIL import Image
from fashn_vton import TryOnPipeline


class Predictor(BasePredictor):
    def setup(self):
        """Loads model weights into memory once, when the container boots
        (or first receives traffic after scaling from zero) — not per request."""
        self.pipeline = TryOnPipeline(weights_dir="/src/weights")

    def predict(
        self,
        person_image: Path = Input(description="Photo of the person (selfie or full-body shot)"),
        garment_image: Path = Input(description="Photo of the garment — flat-lay or on-model"),
        category: str = Input(
            description="Garment type",
            choices=["tops", "bottoms", "one-pieces"],
            default="tops",
        ),
    ) -> Path:
        person = Image.open(person_image).convert("RGB")
        garment = Image.open(garment_image).convert("RGB")

        result = self.pipeline(
            person_image=person,
            garment_image=garment,
            category=category,
        )

        out_path = "/tmp/output.png"
        result.images[0].save(out_path)
        return Path(out_path)
