# thorax_skeleton.glb

Bony thorax (ribs, costal cartilages, sternum, vertebrae C5 to L3, clavicles, scapulae) used only to render the landing page video
(`web/scripts/render_hero.mjs`). It is not served by the app.

Derived from "Z-Anatomy - The libre 3D atlas of anatomy" (CC BY-SA 4.0, https://github.com/Z-Anatomy/Models-of-human-anatomy), which is based on
"BodyParts3D, (c) The Database Center for Life Science" (CC BY-SA 2.1 Japan). Obtained via @authorod/svitylo-3d-anatomy-data 1.1.0.
Changes: extracted the listed bones, recentred and rescaled them into the frame of `web/public/models3d/heart.glb`
(`web/scripts/source/extract_skeleton_from_svitylo.mjs`), one named node per bone, neutral material.

This file is licensed under CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/). The rendered video that uses it carries the same attribution.
