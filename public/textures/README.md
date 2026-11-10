# Textures

Drop PBR texture maps here, organized by material name. Each subfolder needs three files:

```
public/textures/
  grass/
    color.jpg
    normal.jpg
    roughness.jpg
  stone/
    color.jpg
    normal.jpg
    roughness.jpg
  plaster/
    ...
  wood/
    ...
  thatch/
    ...
  brick/
    ...
  dirt/
    ...
```

Any missing file is silently skipped — the material falls back to its base color.

## Where to get them

Free CC0 textures from **[polyhaven.com/textures](https://polyhaven.com/textures)**.

Recommended slugs (search bar on Polyhaven):

| Folder    | Search term            | Suggested texture            |
| --------- | ---------------------- | ---------------------------- |
| `grass`   | "grass"                | "Grass 003" / "Aerial Grass" |
| `stone`   | "stone floor"          | "Stone Floor 02"             |
| `plaster` | "plaster wall"         | "Painted Plaster Wall"       |
| `wood`    | "wood planks"          | "Wood Planks 02"             |
| `thatch`  | "thatch"               | "Thatch Roof 01"             |
| `brick`   | "brick"                | "Red Brick 03"               |
| `dirt`    | "dirt" or "forest"     | "Forest Ground 03"           |

## Download steps (per texture)

1. Click the texture on Polyhaven.
2. Click **Download** on the right side.
3. Choose **1K** resolution, format **JPG**. (Higher res is overkill for this project.)
4. Extract the zip — you'll see files like:
   - `grass_*_diff_1k.jpg`     (color / albedo)
   - `grass_*_nor_gl_1k.jpg`   (normal map, OpenGL convention)
   - `grass_*_rough_1k.jpg`    (roughness)
   - plus other maps you can ignore (AO, displacement, ARM)
5. Rename them:
   - `*_diff_*.jpg` → `color.jpg`
   - `*_nor_gl_*.jpg` → `normal.jpg`
   - `*_rough_*.jpg` → `roughness.jpg`
6. Drop into `public/textures/<folder-name>/`.
7. Refresh the browser. Each surface picks up its texture automatically.

You can install only the textures you want — missing ones don't break anything.
