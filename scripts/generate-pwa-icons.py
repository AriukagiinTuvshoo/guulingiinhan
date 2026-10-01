"""Generate the two install icons from the same simple heritage-tree geometry."""

from pathlib import Path

from PIL import Image, ImageDraw


root = Path(__file__).resolve().parents[1] / "public"
for size in (192, 512):
    image = Image.new("RGB", (size, size), "#143c2d")
    draw = ImageDraw.Draw(image)

    def box(coords):
        return tuple(round(value * size) for value in coords)

    draw.ellipse(box((0.17, 0.16, 0.83, 0.82)), outline="#c7a866", width=max(3, size // 72))
    draw.line(box((0.5, 0.67, 0.5, 0.87)), fill="#e4d5ad", width=max(7, size // 24))
    draw.line(box((0.5, 0.68, 0.29, 0.48)), fill="#e4d5ad", width=max(6, size // 35))
    draw.line(box((0.5, 0.65, 0.71, 0.42)), fill="#e4d5ad", width=max(6, size // 35))
    for x, y, radius in ((0.29, 0.43, 0.105), (0.43, 0.31, 0.13), (0.6, 0.32, 0.13),
                         (0.72, 0.45, 0.1), (0.5, 0.47, 0.16)):
        draw.ellipse(box((x-radius, y-radius, x+radius, y+radius)), fill="#dfd8b9")
    image.save(root / f"icon-{size}.png", optimize=True)
