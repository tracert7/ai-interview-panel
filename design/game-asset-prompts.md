# Game dialogue art · 2026-10-19

Mode: built-in image generation and reference editing. No external image API or API key. Reference: `docs/assets/interview-room-v2.png`, viewed before generation. Original generated canvases are preserved outside the repository. UI lettering and bubbles are runtime HTML/CSS, not baked into the art.

## Assets and processing

| Final file in docs/assets | Purpose | Generated source ID |
| --- | --- | --- |
| interview-room-empty-v1.png | Same room with the three interviewers removed | exec-51bc3d2f-60c3-478f-9ce5-a96e5d96117c |
| hr-dialogue-v1.png | Black-haired HR NPC, six poses | exec-aa701396-bf9d-4359-b084-ea8f51b6d8ba |
| lead-dialogue-v1.png | Gray-haired lead NPC, six poses | exec-59b94f50-653e-43b5-99bb-fd8cb44d556c |
| practitioner-dialogue-v1.png | Brown-haired practitioner NPC, six poses | exec-f29326c1-3f2f-49b1-a389-ee44a01fc00e |

Each raw NPC sheet has three rows and two columns. The local generate2dsprite processor removes magenta, selects the attached body component, uses one shared scale and bottom-aligns six 256px cells. Final sheets are 512×768 transparent PNGs. Frames: neutral, blink, speak, ponder, note, nod. They are one seated conversation/reaction family, not locomotion.

QC: no empty frame, source/output edge touches or clamping; body scale CV below 0.08. HR and lead pass source-anchor std ≤0.05. Practitioner source-anchor std is 0.0604 because row margins differ. The per-asset source gate is explicitly 0.07 for this waist-up NPC after visual inspection: all six **processed** bottom bounds are y=236 and scale CV is 0.00205. This exception does not apply to feet-grounded sprites or global defaults. A trim-border value of zero preserves HR's real hair margin; no raw content was clipped. Largest-component extraction removes detached decorative marks from the lead sheet.

## Exact generation prompts

### Clean room

Use case: precise-object-edit. Image 1 is the exact existing pixel-art interview-room background to edit. Remove ONLY the three seated interviewers behind the long wooden table: remove their hair, faces, torsos, hands, and any remaining human pixels. Restore the empty chair backs, floor and wood/papers where they were. Keep the three black chairs, table, three papers, recorders, wall screen, clock, bookshelf, plants, windows, and the back-facing candidate at the bottom. Preserve original camera, exact 1448:1086 framing and scene geometry, pixel-art outlines and palette. Do not zoom, reposition the furniture, or redesign the room. This clean empty-interviewer background will be used underneath animated character sprites. No speech bubbles, text, labels, UI, or watermark.

### HR

Use the image just shown as the visual reference for the LEFT interviewer only: young adult with black tousled hair, navy suit, white shirt, blue necktie, chibi pixel-art proportions and crisp dark outlines. Generate an animation asset, NOT a room image. Exactly 6 equally sized invisible cells, TWO COLUMNS by THREE ROWS, read left-to-right then next row. Each cell contains the SAME waist-up seated character (entire visible torso, head and both attached hands), no chair/table/background props. One coherent in-place seated conversation reaction sequence: frame 1 neutral attentive eyes open; frame 2 same pose blink eyes closed; frame 3 speaking with small open mouth and slight hand gesture; frame 4 quietly thinking with hand near chin; frame 5 looking slightly down making a tiny note gesture with hands close to body; frame 6 small affirmative nod and gentle smile, returning toward neutral. Keep exact identity, head size, camera distance, body scale and front/slightly-above view across all cells; character occupies central 60-70% safe area in each cell with stable shared bottom/waist line. No limbs/hair/props cross edges. Entire canvas background must be 100% solid flat magenta #FF00FF with no gradients/shadows. NO text, labels, panel borders, UI or speech bubbles. Match the reference's game pixel-art style, not a realistic portrait.

### Lead

Use the image just shown as the visual reference for the CENTER interviewer only: silver-gray hair, black rectangular eyeglasses, navy jacket, white shirt, dark red tie, chibi pixel-art proportions, crisp dark outlines. Produce exactly 6 animation frames in TWO COLUMNS by THREE ROWS of equal invisible cells, read left-to-right row by row. One continuous in-place seated conversation/reaction cycle, same waist-up character with full head, torso and both attached hands, no chair/table: 1 neutral attentive; 2 blink eyes; 3 speaking open mouth with subtle palm gesture; 4 thinking hand close to chin; 5 looking slightly down making a compact note-taking gesture; 6 mild affirmative nod/smile, settle toward neutral. Fixed camera distance, exact head and body scale, face/outfit identity across all cells; stable shared bottom/waist anchor. Keep whole visible body in central 60-70% safe area with generous magenta margin on ALL sides, nothing crossing any cell edge. Pixel-art style must match the reference. Entire canvas background 100% solid flat #FF00FF magenta, no gradients or cast shadows. NO text, labels, panel borders, UI or speech bubbles.

### Practitioner

Use the image just shown as the visual reference for the RIGHT interviewer only: young adult with chestnut-brown shoulder-length hair, navy blazer, pale gray shirt, chibi pixel-art proportions and crisp dark outlines. Create an animation asset sheet, exactly TWO COLUMNS by THREE ROWS, six equal invisible cells read left-to-right row by row. Same waist-up seated character with full head, torso and both attached hands in every cell, no chair/table. One coherent in-place seated conversation/reaction cycle: frame 1 neutral attentive, frame 2 blink, frame 3 small open mouth speaking with subtle hand gesture, frame 4 quietly thinking hand close to chin, frame 5 looking slightly down making a compact note-taking gesture, frame 6 affirmative nod and gentle smile returning toward neutral. Same camera distance and anatomical scale, identity, outfit, silhouette, fixed bottom/waist anchor in all frames. Central 60-70% safe area with generous magenta margin on ALL sides; no hair, hands or props crossing cell edges. Match existing reference game pixel art, not a realistic portrait. Background MUST be 100% solid flat magenta #FF00FF, no gradients or cast shadows. NO text, labels, grid borders, UI or speech bubbles.
