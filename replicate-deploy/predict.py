# predict.py
# Cog predictor for FASHN VTON v1.5 (Apache-2.0, https://github.com/fashn-AI/fashn-vton-1.5).
# Deployed as a private Replicate model so inference is billed at raw GPU-seconds
# instead of a per-run product markup.

import os
from cog import BasePredictor, Input, Path
from PIL import Image

WEIGHTS_DIR = "/src/fashn-vton-1.5/weights"


class Predictor(BasePredictor):
    def setup(self):
        """Load the pipeline once per container start, not per request."""
        from fashn_vton import TryOnPipeline

        if not os.path.isdir(WEIGHTS_DIR):
            raise RuntimeError(
                f"Weights not found at {WEIGHTS_DIR}. The cog.yaml build step should have "
                "downloaded them — check the build logs if this container was built manually."
            )

        self.pipeline = TryOnPipeline(weights_dir=WEIGHTS_DIR)

    def predict(
        self,
        person_image: Path = Input(description="Photo of the person (selfie / model image)"),
        garment_image: Path = Input(description="Photo of the garment (flat-lay or on-model)"),
        category: str = Input(
            description="Garment category",
            choices=["tops", "bottoms", "one-pieces"],
            default="tops",
        ),
    ) -> Path:
        person = Image.open(str(person_image)).convert("RGB")
        garment = Image.open(str(garment_image)).convert("RGB")

        result = self.pipeline(
            person_image=person,
            garment_image=garment,
            category=category,
        )

        output_path = "/tmp/output.png"
        result.images[0].save(output_path)
        return Path(output_path)
